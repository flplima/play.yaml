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
}

/** A ramped tempo change becomes this many stepped meta-events in the file. */
const RAMP_STEPS = 16;

/** Tempo meta-event bytes for a bpm value. */
function tempoMeta(bpm: number): number[] {
  const mpq = Math.round(60000000 / Math.max(1, bpm));
  return [0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff];
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
  { tpqn, bpm, channel, tempo, name, program, controls, tempoMap }: BuildTrackOptions,
): number[] {
  const events: MidiInternalEvent[] = [];

  if (tempo) {
    // Tempo meta at the very start (conductor / single-track use).
    events.push({ tick: 0, order: 0, data: tempoMeta(bpm) });

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
} {
  if (!Array.isArray(input)) {
    return {
      tracks: input.tracks ?? [],
      bpm: opts.bpm || input.bpm || DEFAULT_BPM,
      tempoMap: input.tempoMap ?? [],
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
  const { tracks, bpm, tempoMap } = normalizeInput(input, opts);

  if (tracks.length <= 1) {
    const t = tracks[0] || { name: 'Track 1', channel: 1, timeline: [], controls: [] };
    const bytes = buildTrackBytes(t.timeline, {
      tpqn,
      bpm,
      tempo: true,
      tempoMap,
      controls: t.controls,
      name: t.name,
      program: t.program,
      channel: ((t.channel || 1) - 1) & 0x0f,
    });
    return Uint8Array.from([...mthd(0, 1, tpqn), ...mtrk(bytes)]);
  }

  // Format 1: conductor track (tempo) + one MTrk per song track.
  const chunks = [
    mtrk(buildTrackBytes([], { tpqn, bpm, tempo: true, tempoMap, channel: 0, name: 'Conductor' })),
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
