import {
  CompiledSong, beatsToSeconds, decodeReadiness, detectPreset, panicMessages, patchMessage,
  readinessRequest, tempoSegments,
} from '@play.yaml/core';
import { audioRenderingAvailable, createChunkedRender, playChunks } from '@play.yaml/node-audio';

/**
 * Play a compiled song through the speakers.
 *
 * Rendered offline and streamed to a system audio sink by @play.yaml/node-audio
 * — the same engine the studio's server-side mode uses, and for the same
 * reason: a realtime Web Audio context in Node either drops every AudioParam
 * automation (so notes came out as rectangles with no attack or decay, and the
 * score's expression, bow and sordino never sounded) or does not keep time.
 * See that package's header for the full list of trade-offs.
 */
export async function playSong(song: CompiledSong, opts: { fromBeat?: number } = {}): Promise<void> {
  if (!(await audioRenderingAvailable())) {
    throw new Error('node-web-audio-api is not available — cannot render audio on this machine');
  }

  console.log(`Starting playback of "${song.title || 'Untitled'}" at ${song.bpm} BPM...`);
  for (const track of song.tracks) {
    const preset = track.kit ? null : detectPreset(track);
    console.log(`  Track: "${track.name}" | ${track.kit ? `Kit: [${track.kit}]` : `Preset: [${preset}]`} | ${track.timeline.length} notes, ${track.controls.length} CCs`);
  }

  const render = await createChunkedRender(song, { fromBeat: opts.fromBeat ?? 0 });
  const playback = playChunks(render, { startAtMs: Date.now() });

  // Ctrl-C should silence the speakers rather than leave a chunk playing out.
  const onSignal = () => {
    playback.stop();
    process.exit(0);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  await playback.done;
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  console.log('Playback finished.');
}

interface MidiMessage {
  ms: number;
  /** Tie-break at the same instant: note-offs, then CCs, then note-ons. */
  order: number;
  kind: 'noteon' | 'noteoff' | 'cc';
  payload: Record<string, number>;
}

/** How long a bridged plugin may take to come up before we stop waiting. */
const WARM_TIMEOUT_MS = 45_000;

/**
 * Get a jukebox rack ready for the score: switch each channel to its declared
 * patch, ask the rack to load every channel the score plays (CC 119 = 100),
 * and wait for the readiness reports (CC 119 = 127) on the rack's status
 * port. A lazy rack swallows the notes played while an instrument loads, so
 * this is what makes the first bar audible.
 *
 * Nothing to listen on — no `jukebox-status` port, so no rack — means there
 * is nothing to wait for, and the score plays at once.
 */
async function warmRack(
  easymidi: typeof import('easymidi'),
  output: InstanceType<typeof easymidi.Output>,
  channels: Map<number, number | null>,
): Promise<void> {
  const statusPort = easymidi.getInputs().find((name) => /jukebox-status/i.test(name));
  for (const [channel, patch] of channels) {
    if (patch !== null) {
      const [status, program] = patchMessage(channel, patch);
      output.send('program', { number: program, channel: status & 0x0f } as any);
    }
  }
  if (!statusPort) return;

  const input = new easymidi.Input(statusPort);
  const pending = new Set(channels.keys());
  const ready = new Map<number, boolean>();
  input.on('cc', (msg: { controller: number; value: number; channel: number }) => {
    const report = decodeReadiness([0xb0 | msg.channel, msg.controller, msg.value]);
    if (report) ready.set(report.channel, report.ready);
  });
  for (const channel of pending) {
    const [status, controller, value] = readinessRequest(channel, true);
    output.send('cc', { controller, value, channel: status & 0x0f } as any);
  }
  console.log(`Warming rack channel${pending.size > 1 ? 's' : ''} ${[...pending].sort((a, b) => a - b).join(', ')}…`);
  const started = Date.now();
  while (pending.size && Date.now() - started < WARM_TIMEOUT_MS) {
    for (const channel of pending) {
      if (ready.get(channel)) {
        pending.delete(channel);
        console.log(`  ch ${channel} ready`);
      }
    }
    if (pending.size) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  input.close();
  if (pending.size) {
    console.warn(`  the rack did not report ch ${[...pending].join(', ')} ready in time — playing anyway`);
  }
}

/**
 * Play a compiled song by streaming real-time MIDI to an output port. Every
 * compiled event goes out: notes, the score's control changes (expression
 * ramps, technique CCs) and the tempo map, on each track's compiled channel.
 */
export async function playSongMidi(
  song: CompiledSong,
  portName = 'play.yaml Output',
  opts: { fromBeat?: number } = {},
): Promise<void> {
  const easymidi = (await import('easymidi')).default;

  let output: InstanceType<typeof easymidi.Output>;
  if (easymidi.getOutputs().includes(portName)) {
    console.log(`Connecting to existing MIDI output port: "${portName}"`);
    output = new easymidi.Output(portName, false);
  } else {
    console.log(`Creating virtual MIDI output port: "${portName}"`);
    try {
      output = new easymidi.Output(portName, true);
    } catch (err: any) {
      console.warn(`Could not create virtual port "${portName}": ${err.message}. Trying to connect to existing port...`);
      output = new easymidi.Output(portName, false);
    }
  }

  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const fromBeat = opts.fromBeat ?? 0;
  const skipMs = beatsToSeconds(segments, fromBeat) * 1000;
  const ms = (beat: number) => beatsToSeconds(segments, beat) * 1000 - skipMs;
  const events: MidiMessage[] = [];
  /** Rack channels the pass plays, with the patch each should switch to. */
  const rackChannels = new Map<number, number | null>();

  for (const track of song.tracks) {
    const channel = ((track.channel || 1) - 1) & 0x0f;
    console.log(`  Track: "${track.name}" | Channel ${channel + 1}${track.patch != null ? ` | patch ${track.patch}` : ''} | ${track.timeline.length} notes, ${track.controls.length} CCs`);
    if (track.patch != null || !rackChannels.has(channel + 1)) rackChannels.set(channel + 1, track.patch ?? null);

    // Open the channel before anything sounds: volume, plus expression and
    // modulation defaults for physical models that stay silent without them.
    // The score's own time-0 controls are sent after these and win.
    for (const [controller, value] of [[7, 100], [11, 100], [1, 64]]) {
      events.push({ ms: -1, order: 1, kind: 'cc', payload: { controller, value, channel } });
    }
    // When starting mid-song (loop pass), replay the latest value of every CC
    // set before the entry point, so the instrument state carries over.
    const carried = new Map<number, number>();
    for (const c of track.controls) {
      if (c.time < fromBeat) {
        carried.set(c.cc & 0x7f, c.value & 0x7f);
        continue;
      }
      events.push({
        ms: ms(c.time), order: 1, kind: 'cc',
        payload: { controller: c.cc & 0x7f, value: c.value & 0x7f, channel },
      });
    }
    for (const [controller, value] of carried) {
      events.push({ ms: -1, order: 2, kind: 'cc', payload: { controller, value, channel } });
    }
    for (const n of track.timeline) {
      if (n.time < fromBeat) continue;
      events.push({ ms: ms(n.time), order: 2, kind: 'noteon', payload: { note: n.midi, velocity: n.velocity, channel } });
      events.push({ ms: ms(n.time + n.duration), order: 0, kind: 'noteoff', payload: { note: n.midi, velocity: 0, channel } });
    }
  }
  events.sort((a, b) => a.ms - b.ms || a.order - b.order);

  // Only on the first pass: a loop's later passes find the rack still warm.
  if (fromBeat === 0) await warmRack(easymidi, output, rackChannels);

  const activeNotes = new Set<string>(); // "channel,note"
  let timer: NodeJS.Timeout | undefined;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      try {
        output.close();
      } catch {
        // Port already closed.
      }
      resolve();
    };

    // Release anything still sounding, then panic (All Notes/Sound Off).
    const panic = () => {
      try {
        for (const key of activeNotes) {
          const [channel, note] = key.split(',').map(Number);
          output.send('noteoff', { note, velocity: 0, channel } as any);
        }
        // Pedals down, then the blanket kills — see core's midiPanic.
        for (const msg of panicMessages()) {
          output.send('cc', { controller: msg.controller, value: msg.value, channel: msg.channel } as any);
        }
      } catch {
        // Best effort — the port may already be gone.
      }
      activeNotes.clear();
    };

    const onSignal = () => {
      console.log('\nStopping MIDI playback and cleaning up...');
      if (timer) clearTimeout(timer);
      panic();
      finish();
      process.exit(0);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    // One stepping timer walks the sorted queue, re-anchoring to wall clock
    // each step so long songs don't accumulate drift.
    const startedAt = Date.now();
    let i = 0;
    const step = () => {
      const elapsed = Date.now() - startedAt;
      while (i < events.length && events[i].ms <= elapsed + 1) {
        const e = events[i++];
        try {
          output.send(e.kind as any, e.payload as any);
          const key = `${e.payload.channel},${e.payload.note}`;
          if (e.kind === 'noteon') activeNotes.add(key);
          else if (e.kind === 'noteoff') activeNotes.delete(key);
        } catch {
          // Device vanished mid-playback — keep going, panic on finish.
        }
      }
      if (i >= events.length) {
        timer = setTimeout(() => {
          console.log('Playback finished.');
          finish();
        }, 300);
        return;
      }
      timer = setTimeout(step, Math.max(1, events[i].ms - (Date.now() - startedAt)));
    };
    step();
  });
}
