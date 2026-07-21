import * as Tone from 'tone';
import type { CompiledSong } from '@play.yaml/core';
import { detectPreset, metronomeClick, playDrum, playNote } from '@play.yaml/core';
import {
  createTrackBus, DRUM_LIBRARY, loadInstrument, Sampler, SAMPLED_INSTRUMENTS, TrackBus,
} from './sampler';

/** Where a sample (the DSL's instrument name) should be routed. */
export interface MidiRoute {
  outputId: string;
  channel: number; // 1-16
}

/** Keyed by sample name — "cello", "piano", … */
export type RouteMap = Record<string, MidiRoute | undefined>;

/** The routing key for a compiled track: its kit, else its sample. */
export function routeKey(track: { sample?: string; kit?: string }): string {
  return track.kit ?? track.sample ?? 'piano';
}

export interface PlaybackHandle {
  stop: () => void;
  /** Resolves when playback finishes (or is stopped). */
  done: Promise<void>;
  /** Current transport position in beats (quarter notes). */
  getPositionBeats: () => number;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xb0;
const CC_BREATH = 2;
const CC_EXPRESSION = 11;

/**
 * Physical-modeling instruments (SWAM and friends) take their loudness from
 * the expression controller rather than from note velocity: a bowed or blown
 * voice with expression at zero has zero bow speed / breath pressure, so it
 * stays silent however many notes arrive. Send expression alongside the notes.
 * CC11 is the default mapping in keyboard mode and CC2 in wind-controller
 * mode, so both go out; instruments that use neither simply ignore them.
 */
function sendExpression(output: MIDIOutput, channel: number, value: number): void {
  const v = Math.max(0, Math.min(127, Math.round(value)));
  output.send([CC | channel, CC_EXPRESSION, v]);
  output.send([CC | channel, CC_BREATH, v]);
}

function allNotesOff(output: MIDIOutput) {
  try {
    // Drop any timestamped messages still queued. In the spec but missing
    // from TS's lib.dom, and optional in some implementations.
    (output as MIDIOutput & { clear?: () => void }).clear?.();
  } catch {
    // Ignore.
  }
  for (let ch = 0; ch < 16; ch++) {
    try {
      output.send([CC | ch, 123, 0]); // All Notes Off
      output.send([CC | ch, 120, 0]); // All Sound Off
    } catch {
      // Ignore — the device may have been unplugged mid-playback.
    }
  }
}

/** Send a short middle-C blip so the user can verify a device/channel mapping. */
export function sendTestNote(output: MIDIOutput, channel: number, note = 60): void {
  const ch = (channel - 1) & 0x0f;
  sendExpression(output, ch, 100); // else bowed/blown instruments test silently
  output.send([NOTE_ON | ch, note, 100]);
  // Held open by a timer rather than a send() timestamp — see playSong().
  window.setTimeout(() => output.send([NOTE_OFF | ch, note, 0]), 400);
}

/**
 * Play a compiled song on the Tone.js Transport. Tracks with a MIDI route go
 * out through WebMIDI (timestamped sends); everything else is rendered by the
 * built-in Web Audio synth at transport-accurate times.
 */
export async function playSong(
  song: CompiledSong,
  routes: RouteMap,
  midiOutputs: Map<string, MIDIOutput>,
  opts: {
    loop?: boolean;
    /** Live switch, checked on every beat, so it can be toggled mid-playback. */
    metronome?: () => boolean;
  } = {},
): Promise<PlaybackHandle> {
  await Tone.start(); // Resume the audio context (requires a user gesture).

  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.position = 0;

  const bpm = song.bpm || 120;
  transport.bpm.value = bpm;
  const secPerBeat = 60 / bpm;
  const ppq = transport.PPQ;
  const atBeat = (beat: number) => `${Math.round(beat * ppq)}i`;

  const ctx = Tone.getContext().rawContext as AudioContext;
  // Per-playback master gain: lets stop() cut ringing synth tails instantly
  // without touching Tone's shared context.
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  const usedOutputs = new Set<MIDIOutput>();
  const noteTimers = new Set<number>();
  const activeNotes = new Set<string>(); // "outputId,channel,note"
  const expressionByChannel = new Map<string, number>(); // "outputId,channel" → last CC value
  const buses: TrackBus[] = [];
  let endBeat = 0;

  // Sampled instruments load once (a few MB each, then browser-cached) before
  // the transport starts, so first notes aren't fallback oscillators. Every
  // sampled kit shares the drum library; the 808 kit is always synthesized.
  const wanted = new Set<string>();
  for (const track of song.tracks) {
    const route = routes[routeKey(track)];
    if (route && midiOutputs.get(route.outputId)) continue;
    if (track.kit) {
      if (track.kit !== '808') wanted.add(DRUM_LIBRARY);
    } else {
      const sample = track.sample?.toLowerCase();
      if (sample && SAMPLED_INSTRUMENTS.includes(sample)) wanted.add(sample);
    }
  }
  const samplers = new Map<string, Sampler | null>();
  await Promise.all([...wanted].map(async (name) => {
    samplers.set(name, await loadInstrument(ctx, name));
  }));

  for (const track of song.tracks) {
    const route = routes[routeKey(track)];
    const output = route && midiOutputs.get(route.outputId);

    if (output) {
      usedOutputs.add(output);
      const ch = (route.channel - 1) & 0x0f;
      const key = (midi: number) => `${route.outputId},${ch},${midi}`;

      // Open the channel up front so the instrument has expression before the
      // first note (SWAM otherwise warns "Expression controller not received").
      const firstVelocity = track.timeline[0]?.velocity ?? 90;
      sendExpression(output, ch, firstVelocity);
      expressionByChannel.set(`${route.outputId},${ch}`, firstVelocity);

      // Never pass a timestamp to send(): Chromium ignores it on several
      // platforms ("we ignore timestamps and just throw stuff over"), which
      // would collapse every note to zero length — silent on any sustained
      // instrument. Instead each message gets its own transport event (so
      // tempo changes stretch it correctly) and we wait out the transport's
      // lookahead with a timer before sending.
      const sendAt = (time: number, emit: () => void) => {
        const delay = Math.max(0, (time - ctx.currentTime) * 1000);
        const timer = window.setTimeout(() => {
          noteTimers.delete(timer);
          emit();
        }, delay);
        noteTimers.add(timer);
      };

      for (const control of track.controls ?? []) {
        transport.schedule((time) => {
          sendAt(time, () => output.send([CC | ch, control.cc & 0x7f, control.value & 0x7f]));
        }, atBeat(control.time));
      }

      for (const note of track.timeline) {
        endBeat = Math.max(endBeat, note.time + note.duration);
        transport.schedule((time) => {
          sendAt(time, () => {
            // Track the score's dynamics with expression, so velocity means
            // something on instruments that ignore it. Only resend on change.
            const chKey = `${route.outputId},${ch}`;
            if (expressionByChannel.get(chKey) !== note.velocity) {
              expressionByChannel.set(chKey, note.velocity);
              sendExpression(output, ch, note.velocity);
            }
            output.send([NOTE_ON | ch, note.midi, note.velocity]);
            activeNotes.add(key(note.midi));
          });
        }, atBeat(note.time));

        // Scheduled separately in ticks so a gate over 1 overlaps the next note
        // (which is how a slur is signalled) and tempo changes still apply.
        transport.schedule((time) => {
          sendAt(time, () => {
            output.send([NOTE_OFF | ch, note.midi, 0]);
            activeNotes.delete(key(note.midi));
          });
        }, atBeat(note.time + note.duration));
      }
    } else {
      // Built-in rendering: every track gets a control bus so the score's CC
      // stream (expression swells, bow-position drifts, vibrato, pizzicato)
      // shapes the sound, whether sampled or synthesized.
      const preset = track.kit ? null : detectPreset(track);
      const bus = createTrackBus(ctx, masterGain, {
        hasExpression: (track.controls ?? []).some((c) => c.cc === 11),
      });
      buses.push(bus);
      const sampled = track.kit
        ? (track.kit !== '808' ? samplers.get(DRUM_LIBRARY) : null)
        : (track.sample && samplers.get(track.sample.toLowerCase())) || null;

      for (const control of track.controls ?? []) {
        // Scheduled ahead of the notes at the same beat (insertion order), so
        // articulation switches land before the note that needs them.
        transport.schedule((time) => {
          bus.applyCC(control.cc, control.value, time);
        }, atBeat(control.time));
      }

      for (const note of track.timeline) {
        endBeat = Math.max(endBeat, note.time + note.duration);
        transport.schedule((time) => {
          if (track.kit) {
            if (sampled?.kind === 'drums') sampled.play(bus, note.midi, note.velocity, time);
            else playDrum(ctx, bus.input, note.midi, note.velocity, time);
          } else if (sampled?.kind === 'melodic') {
            sampled.play(bus, note.midi, note.velocity, time, note.duration * secPerBeat);
          } else {
            playNote(ctx, bus.input, preset!, note.midi, note.velocity, time, note.duration * secPerBeat);
          }
        }, atBeat(note.time));
      }
    }
  }

  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  let stopped = false;
  let tailTimer = 0;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(tailTimer);
    transport.stop();
    transport.cancel(0);
    for (const timer of noteTimers) window.clearTimeout(timer);
    noteTimers.clear();
    // Release anything still sounding before the panic messages.
    for (const entry of activeNotes) {
      const [outputId, channel, midi] = entry.split(',');
      midiOutputs.get(outputId)?.send([NOTE_OFF | Number(channel), Number(midi), 0]);
    }
    activeNotes.clear();
    for (const output of usedOutputs) allNotesOff(output);
    // Fade the master bus out fast, then detach it.
    masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    window.setTimeout(() => {
      masterGain.disconnect();
      for (const bus of buses) bus.dispose();
    }, 300);
    finished();
  };

  // Tempo map: everything above is scheduled in ticks, so changing the
  // transport's bpm stretches notes, controls and highlighting together.
  let runningBpm = bpm;
  for (const change of song.tempoMap ?? []) {
    const from = runningBpm;
    transport.schedule((time) => {
      // transport.bpm is a TickSignal backing transport.ticks; every change is
      // scheduled strictly later than the last, so there is nothing to cancel.
      if (change.rampBeats > 0) {
        // Ramp length in seconds, using the average of the two tempi.
        const seconds = (change.rampBeats * 60) / ((from + change.bpm) / 2);
        transport.bpm.setValueAtTime(from, time);
        transport.bpm.linearRampToValueAtTime(change.bpm, time + seconds);
      } else {
        transport.bpm.setValueAtTime(change.bpm, time);
      }
    }, atBeat(change.time));
    runningBpm = change.bpm;
  }

  // Metronome: one click per beat on the transport grid. The grid runs at the
  // song's root tempo — child-track tempo overrides never reach the transport.
  const metronomeOn = opts.metronome ?? (() => false);
  const clicksPerMeasure = Math.max(1, Math.round(song.measureBeats || 4));
  transport.scheduleRepeat((time) => {
    if (!metronomeOn()) return;
    const ticks = transport.getTicksAtTime(time);
    const beat = Math.round(ticks / ppq) % clicksPerMeasure;
    metronomeClick(ctx, masterGain, time, beat === 0);
  }, `${ppq}i`, 0);

  // Loop over whole measures (falling back to the last note when a track
  // overhangs); otherwise let the final release ring briefly, then clean up.
  const songEnd = Math.max(song.lengthBeats || 0, endBeat);
  if (opts.loop && songEnd > 0) {
    transport.loopStart = 0;
    transport.loopEnd = atBeat(songEnd);
    transport.loop = true;
  } else {
    transport.loop = false;
    transport.schedule(() => {
      tailTimer = window.setTimeout(cleanup, 600);
    }, atBeat(songEnd));
  }

  transport.start();

  return {
    stop: cleanup,
    done,
    getPositionBeats: () => (stopped ? 0 : transport.ticks / ppq),
  };
}
