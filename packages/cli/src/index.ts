import { AudioContext } from 'webaudio-node';
import {
  CompiledSong, beatsToSeconds, detectPreset, playDrum, playNote, tempoSegments,
} from '@play.yaml/core';

/**
 * Play a compiled song through the speakers, rendering with the core synth
 * presets via webaudio-node. Honours the song's tempo map (ramps stepped the
 * same way the .mid export steps them).
 */
export async function playSong(song: CompiledSong): Promise<void> {
  const ctx = new AudioContext() as any;
  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const lead = 0.2; // scheduling offset to prevent clicks/jitter
  const now: number = ctx.currentTime;

  console.log(`Starting playback of "${song.title || 'Untitled'}" at ${song.bpm} BPM...`);

  let end = now;
  for (const track of song.tracks) {
    const preset = track.kit ? null : detectPreset(track);
    console.log(`  Track: "${track.name}" | ${track.kit ? `Kit: [${track.kit}]` : `Preset: [${preset}]`} | ${track.timeline.length} notes`);
    for (const note of track.timeline) {
      const startSec = now + lead + beatsToSeconds(segments, note.time);
      const endSec = now + lead + beatsToSeconds(segments, note.time + note.duration);
      end = Math.max(end, endSec);
      if (preset) {
        playNote(ctx, ctx.destination, preset, note.midi, note.velocity, startSec, endSec - startSec);
      } else {
        playDrum(ctx, ctx.destination, note.midi, note.velocity, startSec);
      }
    }
  }

  await new Promise<void>((resolve) => setTimeout(resolve, (end - now) * 1000 + 500));
  console.log('Playback finished.');
  try {
    await ctx.close?.();
  } catch {
    // Context already closed.
  }
}

interface MidiMessage {
  ms: number;
  /** Tie-break at the same instant: note-offs, then CCs, then note-ons. */
  order: number;
  kind: 'noteon' | 'noteoff' | 'cc';
  payload: Record<string, number>;
}

/**
 * Play a compiled song by streaming real-time MIDI to an output port. Every
 * compiled event goes out: notes, the score's control changes (expression
 * ramps, technique CCs) and the tempo map, on each track's compiled channel.
 */
export async function playSongMidi(song: CompiledSong, portName = 'play.yaml Output'): Promise<void> {
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
  const ms = (beat: number) => beatsToSeconds(segments, beat) * 1000;
  const events: MidiMessage[] = [];

  for (const track of song.tracks) {
    const channel = ((track.channel || 1) - 1) & 0x0f;
    console.log(`  Track: "${track.name}" | Channel ${channel + 1} | ${track.timeline.length} notes, ${track.controls.length} CCs`);

    // Open the channel before anything sounds: volume, plus expression and
    // modulation defaults for physical models that stay silent without them.
    // The score's own time-0 controls are sent after these and win.
    for (const [controller, value] of [[7, 100], [11, 100], [1, 64]]) {
      events.push({ ms: -1, order: 1, kind: 'cc', payload: { controller, value, channel } });
    }
    for (const c of track.controls) {
      events.push({
        ms: ms(c.time), order: 1, kind: 'cc',
        payload: { controller: c.cc & 0x7f, value: c.value & 0x7f, channel },
      });
    }
    for (const n of track.timeline) {
      events.push({ ms: ms(n.time), order: 2, kind: 'noteon', payload: { note: n.midi, velocity: n.velocity, channel } });
      events.push({ ms: ms(n.time + n.duration), order: 0, kind: 'noteoff', payload: { note: n.midi, velocity: 0, channel } });
    }
  }
  events.sort((a, b) => a.ms - b.ms || a.order - b.order);

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
        for (let channel = 0; channel < 16; channel++) {
          output.send('cc', { controller: 123, value: 0, channel } as any);
          output.send('cc', { controller: 120, value: 0, channel } as any);
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
