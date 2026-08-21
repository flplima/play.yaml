'use strict';

/**
 * exporter.ts — compiled timelines → Standard MIDI File bytes. Pure and
 * environment-free: returns a Uint8Array, so it runs in Node and browsers.
 */

import {
  nameToMidi, TimelineEvent, CompiledSong, CompiledTrack, ControlEvent, TempoEvent,
} from './parser';

const DEFAULT_TPQN = 480;
const DEFAULT_BPM = 120;

/** MIDI variable-length quantity (used for delta-times). */
export function writeVarLen(value: number): number[] {
  const bytes = [];
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

/** 32-bit big-endian, for chunk lengths. */
function uint32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

interface BuildTrackOptions {
  tpqn: number;
  bpm: number;
  channel: number;
  tempo: boolean;
  name?: string;
  program?: number;
  controls?: ControlEvent[];
  /** Tempo changes for the conductor track, in beats. */
  tempoMap?: TempoEvent[];
  /** Forever-loop start, in beats — written as a "loopStart" marker. */
  loopStartBeats?: number;
  /** Measure length in quarter-note beats — written as a time signature. */
  measureBeats?: number;
  /** The meter as notated, when a beat count alone would lose it (12/8). */
  measureSig?: string;
}

/** A ramped tempo change becomes this many stepped meta-events in the file. */
const RAMP_STEPS = 16;

/** Tempo meta-event bytes for a bpm value. */
function tempoMeta(bpm: number): number[] {
  const mpq = Math.round(60000000 / Math.max(1, bpm));
  return [0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff];
}

/**
 * Time-signature meta-event for a measure length in quarter-note beats.
 *
 * Compilation keeps only the length (`measure: 9/8` → 4.5 beats), so the
 * denominator is inferred as the smallest one that makes the numerator whole:
 * 4.5 → 9/8, 3.5 → 7/8, 4 → 4/4. That is exact except where two notations
 * share a beat count (12/8 vs 6/4), which is what `notated` carries.
 */
function timeSigMeta(measureBeats: number, notated?: string): number[] {
  let numerator: number;
  let denominator: number;
  const m = notated ? /^(\d+)\/(\d+)$/.exec(notated) : null;
  if (m) {
    numerator = parseInt(m[1], 10);
    denominator = parseInt(m[2], 10);
  } else {
    denominator = 4;
    while (denominator < 32 && Math.abs(measureBeats * (denominator / 4) % 1) > 1e-9) denominator *= 2;
    numerator = Math.max(1, Math.round(measureBeats * (denominator / 4)));
  }
  return [0xff, 0x58, 0x04, numerator & 0xff, Math.round(Math.log2(denominator)), 24, 8];
}

interface MidiInternalEvent {
  tick: number;
  order: number;
  data: number[];
}

/**
 * Build the MTrk payload (events only, no chunk header) from a timeline.
 * Optionally prepends a tempo meta-event and/or a track-name / program-change.
 */
function buildTrackBytes(
  timeline: TimelineEvent[],
  { tpqn, bpm, channel, tempo, name, program, controls, tempoMap, loopStartBeats, measureBeats, measureSig }: BuildTrackOptions,
): number[] {
  const events: MidiInternalEvent[] = [];

  if (tempo) {
    // Tempo meta at the very start (conductor / single-track use).
    events.push({ tick: 0, order: 0, data: tempoMeta(bpm) });
    if (measureBeats && measureBeats > 0) {
      events.push({ tick: 0, order: 0, data: timeSigMeta(measureBeats, measureSig) });
    }

    if (loopStartBeats != null) {
      // SMF has no loop notion — a "loopStart" marker is the widespread
      // convention (samplers, trackers, game engines).
      const bytes = [...new TextEncoder().encode('loopStart')];
      events.push({
        tick: Math.round(loopStartBeats * tpqn),
        order: 0,
        data: [0xff, 0x06, bytes.length, ...bytes],
      });
    }

    // Later changes; ramps become a staircase, since SMF has no tempo glide.
    let running = bpm;
    for (const change of tempoMap ?? []) {
      const startTick = Math.round(change.time * tpqn);
      if (change.rampBeats > 0) {
        const spanTicks = change.rampBeats * tpqn;
        for (let step = 1; step <= RAMP_STEPS; step++) {
          const ratio = step / RAMP_STEPS;
          events.push({
            tick: Math.round(startTick + spanTicks * ratio),
            order: 0,
            data: tempoMeta(running + (change.bpm - running) * ratio),
          });
        }
      } else {
        events.push({ tick: startTick, order: 0, data: tempoMeta(change.bpm) });
      }
      running = change.bpm;
    }
  }

  for (const control of controls ?? []) {
    events.push({
      tick: Math.round(control.time * tpqn),
      order: 0, // ahead of any note at the same tick
      data: [0xb0 | channel, control.cc & 0x7f, control.value & 0x7f],
    });
  }
  if (name) {
    const bytes = [...new TextEncoder().encode(String(name))];
    events.push({ tick: 0, order: 0, data: [0xff, 0x03, bytes.length, ...bytes] });
  }
  if (program != null) {
    events.push({ tick: 0, order: 1, data: [0xc0 | channel, program & 0x7f] });
  }

  for (const note of timeline) {
    const midi = note.midi != null ? note.midi : nameToMidi(note.pitch);
    if (midi == null) continue;
    const onTick = Math.round(note.time * tpqn);
    const offTick = Math.round((note.time + note.duration) * tpqn);
    // note-off ordered before note-on at the same tick so re-triggered pitches
    // don't get their tail chopped by the new attack.
    events.push({ tick: offTick, order: 1, data: [0x80 | channel, midi, 0] });
    events.push({ tick: onTick, order: 2, data: [0x90 | channel, midi, note.velocity] });
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const bytes: number[] = [];
  let prevTick = 0;
  for (const e of events) {
    bytes.push(...writeVarLen(e.tick - prevTick));
    bytes.push(...e.data);
    prevTick = e.tick;
  }
  bytes.push(...writeVarLen(0), 0xff, 0x2f, 0x00); // end of track
  return bytes;
}

function mtrk(bytes: number[]): number[] {
  return [0x4d, 0x54, 0x72, 0x6b, ...uint32be(bytes.length), ...bytes]; // "MTrk"
}

function mthd(format: number, ntrks: number, tpqn: number): number[] {
  return [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...uint32be(6),
    (format >> 8) & 0xff, format & 0xff,
    (ntrks >> 8) & 0xff, ntrks & 0xff,
    (tpqn >> 8) & 0xff, tpqn & 0xff, // division
  ];
}

export interface EncodeMidiOptions {
  bpm?: number;
  tpqn?: number;
  channel?: number;
}

export type EncodeMidiInput = TimelineEvent[] | CompiledSong | CompiledTrack[];

/** Accept a flat timeline, a track list, or a whole song — normalize to a song. */
function normalizeInput(input: EncodeMidiInput, opts: EncodeMidiOptions): {
  tracks: CompiledTrack[];
  bpm: number;
  tempoMap: TempoEvent[];
  loopStartBeats?: number;
  measureBeats?: number;
  measureSig?: string;
} {
  if (!Array.isArray(input)) {
    return {
      tracks: input.tracks ?? [],
      bpm: opts.bpm || input.bpm || DEFAULT_BPM,
      tempoMap: input.tempoMap ?? [],
      loopStartBeats: input.loopStartBeats,
      measureBeats: input.measureBeats,
      measureSig: input.measureSig,
    };
  }
  const bpm = opts.bpm || DEFAULT_BPM;
  const isTimeline = input.length === 0 || (input[0] as TimelineEvent).pitch !== undefined;
  if (isTimeline) {
    return {
      tracks: [{
        name: 'Track 1',
        channel: opts.channel || 1,
        timeline: input as TimelineEvent[],
        controls: [],
        patches: [],
      }],
      bpm,
      tempoMap: [],
    };
  }
  return { tracks: input as CompiledTrack[], bpm, tempoMap: [] };
}

/**
 * Encode into a complete .mid byte buffer. Accepts either a single flat
 * timeline (→ format 0) or a multitrack song (→ format 1 with a conductor
 * track carrying the tempo, then one MTrk per song track on its own channel).
 */
export function encodeMidi(input: EncodeMidiInput, opts: EncodeMidiOptions = {}): Uint8Array {
  const tpqn = opts.tpqn || DEFAULT_TPQN;
  const { tracks, bpm, tempoMap, loopStartBeats, measureBeats, measureSig } = normalizeInput(input, opts);

  if (tracks.length <= 1) {
    const t = tracks[0] || { name: 'Track 1', channel: 1, timeline: [], controls: [] };
    const bytes = buildTrackBytes(t.timeline, {
      tpqn,
      bpm,
      tempo: true,
      tempoMap,
      loopStartBeats,
      measureBeats,
      measureSig,
      controls: t.controls,
      name: t.name,
      program: t.program,
      channel: ((t.channel || 1) - 1) & 0x0f,
    });
    return Uint8Array.from([...mthd(0, 1, tpqn), ...mtrk(bytes)]);
  }

  // Format 1: conductor track (tempo) + one MTrk per song track.
  const chunks = [
    mtrk(buildTrackBytes([], {
      tpqn, bpm, tempo: true, tempoMap, loopStartBeats, measureBeats, measureSig, channel: 0, name: 'Conductor',
    })),
  ];
  for (const t of tracks) {
    chunks.push(
      mtrk(
        buildTrackBytes(t.timeline, {
          tpqn,
          bpm,
          tempo: false,
          controls: t.controls,
          name: t.name,
          program: t.program,
          channel: ((t.channel || 1) - 1) & 0x0f,
        }),
      ),
    );
  }
  return Uint8Array.from([...mthd(1, tracks.length + 1, tpqn), ...chunks.flat()]);
}
