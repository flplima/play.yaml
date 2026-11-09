'use strict';

/**
 * exporter.ts — a compiled song → Standard MIDI File bytes. Pure and
 * environment-free: returns a Uint8Array, so it runs in Node and browsers.
 */

import type { CompiledSong, CompiledTrack } from './song';
import { tempoSegments } from './time';

const DEFAULT_TPQN = 480;

/** MIDI variable-length quantity (used for delta-times). */
function writeVarLen(value: number): number[] {
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

function uint32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

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

function textMeta(type: number, text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  return [0xff, type, bytes.length, ...bytes];
}

/** `order` breaks ties at the same tick: metas and CCs, then program and note-offs, then note-ons. */
interface MidiInternalEvent {
  tick: number;
  order: number;
  data: number[];
}

/** The song-wide events: tempo (ramps as the same staircase playback uses), meter, loop marker. */
function conductorEvents(song: CompiledSong, tpqn: number, bpm: number): MidiInternalEvent[] {
  const events: MidiInternalEvent[] = [
    { tick: 0, order: 0, data: tempoMeta(bpm) },
    { tick: 0, order: 0, data: timeSigMeta(song.measureBeats, song.measureSig) },
  ];
  if (song.loopStartBeats != null) {
    // SMF has no loop notion — a "loopStart" marker is the widespread
    // convention (samplers, trackers, game engines).
    events.push({ tick: Math.round(song.loopStartBeats * tpqn), order: 0, data: textMeta(0x06, 'loopStart') });
  }
  for (const segment of tempoSegments(bpm, song.tempoMap).slice(1)) {
    events.push({ tick: Math.round(segment.beat * tpqn), order: 0, data: tempoMeta(segment.bpm) });
  }
  return events;
}

/** One track's notes, controls, name and program. */
function trackEvents(track: CompiledTrack, tpqn: number): MidiInternalEvent[] {
  const channel = (track.channel - 1) & 0x0f;
  const events: MidiInternalEvent[] = [{ tick: 0, order: 0, data: textMeta(0x03, track.name) }];
  if (track.program != null) {
    events.push({ tick: 0, order: 1, data: [0xc0 | channel, track.program & 0x7f] });
  }
  for (const control of track.controls) {
    events.push({
      tick: Math.round(control.time * tpqn),
      order: 0,
      data: [0xb0 | channel, control.cc & 0x7f, control.value & 0x7f],
    });
  }
  for (const note of track.timeline) {
    const onTick = Math.round(note.time * tpqn);
    const offTick = Math.round((note.time + note.duration) * tpqn);
    // note-off ordered before note-on at the same tick so re-triggered pitches
    // don't get their tail chopped by the new attack.
    events.push({ tick: offTick, order: 1, data: [0x80 | channel, note.midi, 0] });
    events.push({ tick: onTick, order: 2, data: [0x90 | channel, note.midi, note.velocity] });
  }
  return events;
}

function mtrk(events: MidiInternalEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes: number[] = [];
  let prevTick = 0;
  for (const e of events) {
    bytes.push(...writeVarLen(e.tick - prevTick));
    bytes.push(...e.data);
    prevTick = e.tick;
  }
  bytes.push(...writeVarLen(0), 0xff, 0x2f, 0x00); // end of track
  return [0x4d, 0x54, 0x72, 0x6b, ...uint32be(bytes.length), ...bytes]; // "MTrk"
}

function mthd(format: number, ntrks: number, tpqn: number): number[] {
  return [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...uint32be(6),
    (format >> 8) & 0xff, format & 0xff,
    (ntrks >> 8) & 0xff, ntrks & 0xff,
    (tpqn >> 8) & 0xff, tpqn & 0xff,
  ];
}

export interface EncodeMidiOptions {
  /** Override the song's tempo. */
  bpm?: number;
  tpqn?: number;
}

/**
 * Encode a compiled song into a complete .mid byte buffer: format 0 for a
 * single track, otherwise format 1 with a conductor track carrying the tempo
 * and one MTrk per song track on its own channel.
 */
export function encodeMidi(song: CompiledSong, opts: EncodeMidiOptions = {}): Uint8Array {
  const tpqn = opts.tpqn || DEFAULT_TPQN;
  const bpm = opts.bpm || song.bpm;
  const conductor = conductorEvents(song, tpqn, bpm);

  if (song.tracks.length === 1) {
    return Uint8Array.from([...mthd(0, 1, tpqn), ...mtrk([...conductor, ...trackEvents(song.tracks[0], tpqn)])]);
  }
  const chunks = [mtrk([...conductor, { tick: 0, order: 0, data: textMeta(0x03, 'Conductor') }])];
  for (const track of song.tracks) chunks.push(mtrk(trackEvents(track, tpqn)));
  return Uint8Array.from([...mthd(1, song.tracks.length + 1, tpqn), ...chunks.flat()]);
}
