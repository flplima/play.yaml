'use strict';

/**
 * notate.ts — note events (beats + MIDI numbers) → play.yaml measure lines.
 *
 * The inverse of the compiler: given *when* and *what*, write the measure
 * tokens that compile back to exactly that. Pure and environment-free, so the
 * CLI importer, the studio and tests all share one implementation.
 *
 * ── How a measure is written ──────────────────────────────────────────────
 *
 * A measure line is `slots` equal top-level tokens (one per beat of the
 * meter — six for 6/8). Each slot is laid out on the *finest grid its own
 * notes need*: the gcd of the onsets and offsets falling inside it. That is
 * what keeps a bar of quarters written as `c d e f` instead of dragging the
 * whole bar down to the resolution of one 32nd somewhere in it.
 *
 * Within a slot: co-onset notes become a `[c e g]` stack, a note still
 * sounding from earlier is `_`, silence is `~`, and a slot needing more than
 * one step becomes a `{}` group. This is the same algorithm
 * `scripts/musicxml-to-play.py` uses — ported so MIDI import needs no Python.
 *
 * ── Why integer divisions ────────────────────────────────────────────────
 *
 * All arithmetic happens in integer ticks — 1/2520 quarter note by default.
 * 2520 is LCM(1..10), so every grid a score actually uses — halves, triplets,
 * quintuplets, septuplets, 16ths, 9-tuplets — lands on a whole tick and the
 * gcd that picks each slot's grid is exact. Floating-point beats would make
 * `gcd` meaningless.
 *
 * An imported file's own resolution has to divide the grid too, and 2520/480
 * is 5.25 — so importers raise it to lcm(2520, tpqn) via `ticks`. Without
 * that, notes on odd ticks of a 480-per-quarter file land *between* grid
 * points and come out a fraction of a tick early.
 */

import { midiToName } from './theory';

/** Ticks per quarter note used for all internal arithmetic. LCM(1..10). */
export const NOTATE_TICKS = 2520;

/** One note to be written: position and length in quarter-note beats. */
export interface NotateNote {
  start: number;
  duration: number;
  midi: number;
}

export interface NotateOptions {
  /** Measure length in quarter-note beats (4/4 → 4, 6/8 → 3). */
  measureBeats: number;
  /** Top-level tokens per measure — the meter's numerator (6/8 → 6). */
  slots: number;
  /**
   * Quantize onsets and offsets to 1/`snap` of a quarter note before writing.
   * Leave unset for material already on a grid (the result is then exact);
   * set it for a recorded performance, and read `maxShift` to see the price.
   */
  snap?: number;
  /** Spell black keys as flats (from a flat key signature). */
  preferFlat?: boolean;
  /**
   * Ignore how long notes were actually held and run each one into the next
   * onset. Recorded MIDI releases keys early (a "quarter note" lasts 0.42
   * beats), and writing that literally litters the bar with 32nd rests. The
   * cost is that genuine short rests become holds, so onsets and pitches
   * survive but articulation does not.
   */
  legato?: boolean;
  /** Emit at least this many measures, padding with rests. */
  minMeasures?: number;
  /**
   * Most steps one top-level slot may be divided into before the emitter
   * stops honouring where notes were *released*. A recorded release lands on
   * an arbitrary tick, and one of them is enough to drag a whole beat onto a
   * 120-step grid; past this cap the slot is written from its onsets alone and
   * notes run into each other. Onsets and pitches are unaffected either way.
   */
  maxSteps?: number;
  /**
   * Ticks per quarter note for the internal grid. The default handles every
   * grid a *written* score uses, but an imported file's own resolution has to
   * divide it exactly or its onsets land between ticks — a 480-tick MIDI file
   * needs lcm(2520, 480) = 10080, not 2520. Importers pass that; nothing else
   * needs to.
   */
  ticks?: number;
  /**
   * How a MIDI number is written. Defaults to a pitch name; a `kit:` track
   * passes the drum-token spelling instead, since those tracks read `bd`/`sd`
   * where others read `c4`.
   */
  spell?: (midi: number) => string;
}

export interface NotateResult {
  /** One measure token line per measure, in order. */
  lines: string[];
  /** Largest distance any onset moved when snapping, in quarter-note beats. */
  maxShift: number;
  /**
   * The notes as actually written — post-snap onsets in beats. Comparing this
   * against the source is what makes an import verifiable rather than hopeful.
   */
  placed: { start: number; midi: number }[];
}

const NAMES_FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

function gcd2(a: number, b: number): number {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function gcdAll(values: number[]): number {
  let g = 0;
  for (const v of values) if (v > 0) g = gcd2(g, v);
  return g || 1;
}

/** MIDI number → a token the parser reads back as the same pitch. */
export function midiToToken(midi: number, preferFlat = false): string {
  if (!preferFlat) return midiToName(midi).toLowerCase();
  const pc = ((midi % 12) + 12) % 12;
  return NAMES_FLAT[pc] + (Math.floor(midi / 12) - 1);
}

/** An onset with every pitch that starts on it. */
interface Chord {
  on: number; // ticks
  end: number; // ticks — the longest of the stacked notes
  midis: number[];
}

/**
 * Write one measure's worth of slots.
 *
 * `chords` must be every chord *overlapping* the measure, not only those
 * starting in it — a note held from the previous bar has to become `_` here.
 */
function emitMeasure(
  chords: Chord[],
  measureStart: number,
  slotTicks: number,
  slots: number,
  maxSteps: number,
): string {
  const out: string[] = [];
  for (let s = 0; s < slots; s++) {
    const w0 = measureStart + s * slotTicks;
    const w1 = w0 + slotTicks;

    /**
     * Lay out one slot. `withOffsets` decides whether a note *ending* mid-slot
     * cuts the grid: it must for written music (that is where rests come
     * from), but a recorded release lands on an arbitrary tick and would drag
     * the whole slot down to a 120-step grid, so the caller retries without.
     */
    const build = (withOffsets: boolean) => {
      const points = new Set<number>([w0, w1]);
      for (const c of chords) {
        if (c.on < w1 && c.end > w0) {
          if (c.on >= w0 && c.on < w1) points.add(c.on);
          if (withOffsets && c.end > w0 && c.end < w1) points.add(c.end);
        }
      }
      const cuts = [...points].sort((a, b) => a - b);

      const segments: { length: number; starts: Chord[]; sustained: boolean }[] = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const t0 = cuts[i];
        const starts = chords.filter((c) => c.on === t0);
        const sustained = chords.some((c) => c.on < t0 && c.end > t0);
        segments.push({ length: cuts[i + 1] - t0, starts, sustained });
      }

      const step = gcdAll(segments.map((sg) => sg.length));
      const tokens: string[] = [];
      for (const sg of segments) {
        const count = Math.max(1, Math.round(sg.length / step));
        if (sg.starts.length) {
          const midis = [...new Set(sg.starts.flatMap((c) => c.midis))].sort((a, b) => a - b);
          tokens.push(midis.length === 1 ? String(midis[0]) : `[${midis.join(' ')}]`);
          for (let i = 1; i < count; i++) tokens.push('_');
        } else {
          for (let i = 0; i < count; i++) tokens.push(sg.sustained ? '_' : '~');
        }
      }
      return tokens;
    };

    let tokens = build(true);
    if (tokens.length > maxSteps) tokens = build(false);
    out.push(tokens.length === 1 ? tokens[0] : `{${tokens.join(' ')}}`);
  }
  return out.join(' ');
}

export interface SeparateOptions {
  /**
   * Most voices to open before notes are made to share one. Four covers
   * SATB and two-hand piano writing; more than that and the lines stop
   * being readable as lines.
   */
  maxVoices?: number;
}

/**
 * Split overlapping notes into monophonic-with-chords voices.
 *
 * A play.yaml track can sound a chord but not two independent rhythms, so a
 * MIDI channel holding a held bass under running sixteenths has to become two
 * tracks — which is also what lets the bass keep ringing instead of being cut
 * by the next sixteenth.
 *
 * The split is the classic one: notes that share an onset *and* a length are
 * one chord and stay together; each chord then joins the free voice whose last
 * pitch is nearest (so lines keep their register instead of crossing), opening
 * a new voice when none is free. When every voice is busy — which real files
 * do produce — the chord goes to the voice that frees up soonest and that
 * voice's ringing note is shortened to make room, because a written score has
 * to choose.
 *
 * Voices come back ordered high to low, so `[0]` is the melody.
 */
export function separateVoices(notes: NotateNote[], opts: SeparateOptions = {}): NotateNote[][] {
  const maxVoices = Math.max(1, opts.maxVoices ?? 4);
  const EPS = 1e-6;

  // Notes sharing an onset and a length are one chord.
  const byKey = new Map<string, NotateNote[]>();
  for (const n of notes) {
    const key = `${n.start.toFixed(6)}:${Math.max(0, n.duration).toFixed(6)}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(n);
    else byKey.set(key, [n]);
  }
  const chords = [...byKey.values()].sort(
    (a, b) => a[0].start - b[0].start || b[0].midi - a[0].midi,
  );

  interface Voice { notes: NotateNote[]; end: number; pitch: number }
  const voices: Voice[] = [];

  for (const chord of chords) {
    const start = chord[0].start;
    const end = start + Math.max(0, chord[0].duration);
    const top = Math.max(...chord.map((n) => n.midi));

    const free = voices.filter((v) => v.end <= start + EPS);
    let target: Voice | undefined;
    if (free.length) {
      target = free.reduce((best, v) =>
        Math.abs(v.pitch - top) < Math.abs(best.pitch - top) ? v : best);
    } else if (voices.length < maxVoices) {
      target = { notes: [], end: -Infinity, pitch: top };
      voices.push(target);
    } else {
      // Nothing free: the voice that frees up soonest yields, and its ringing
      // note is cut back to this onset.
      target = voices.reduce((best, v) => (v.end < best.end ? v : best));
      for (const n of target.notes) {
        if (n.start + n.duration > start) n.duration = Math.max(0, start - n.start);
      }
    }

    for (const n of chord) target.notes.push({ ...n });
    target.end = end;
    target.pitch = top;
  }

  return voices
    .filter((v) => v.notes.length)
    .sort((a, b) => {
      const avg = (v: Voice) => v.notes.reduce((s, n) => s + n.midi, 0) / v.notes.length;
      return avg(b) - avg(a);
    })
    .map((v) => v.notes.sort((a, b) => a.start - b.start || a.midi - b.midi));
}

/**
 * Lay a stream of notes out as play.yaml measure lines.
 *
 * The input may be polyphonic only in the sense the DSL allows: notes sharing
 * an onset stack into a chord. Overlapping notes with *different* onsets need
 * splitting into separate tracks first — see `separateVoices`.
 */
export function notateMeasures(notes: NotateNote[], opts: NotateOptions): NotateResult {
  const { measureBeats, slots, snap, preferFlat, minMeasures, legato, spell } = opts;
  const TICKS = Math.max(1, Math.round(opts.ticks ?? NOTATE_TICKS));
  if (!(measureBeats > 0)) throw new Error('notateMeasures: measureBeats must be positive');
  if (!(slots > 0) || !Number.isInteger(slots)) throw new Error('notateMeasures: slots must be a positive integer');

  const measureTicks = Math.round(measureBeats * TICKS);
  const slotTicks = Math.round(measureTicks / slots);

  // Quantize first, in ticks, so the grid below is exact.
  const grid = snap && snap > 0 ? Math.max(1, Math.round(TICKS / snap)) : 0;
  let maxShift = 0;
  const events: Chord[] = [];
  for (const n of notes) {
    let on = Math.round(n.start * TICKS);
    let end = Math.round((n.start + Math.max(0, n.duration)) * TICKS);
    if (grid) {
      const snapped = Math.round(on / grid) * grid;
      maxShift = Math.max(maxShift, Math.abs(snapped - on) / TICKS);
      end = Math.round(end / grid) * grid;
      on = snapped;
    }
    if (end <= on) end = on + (grid || slotTicks); // a zero-length note still sounds
    events.push({ on, end, midis: [n.midi] });
  }

  // Merge co-onset notes into chords.
  events.sort((a, b) => a.on - b.on || a.midis[0] - b.midis[0]);
  const chords: Chord[] = [];
  for (const e of events) {
    const last = chords[chords.length - 1];
    if (last && last.on === e.on) {
      last.midis.push(e.midis[0]);
      last.end = Math.max(last.end, e.end);
    } else {
      chords.push(e);
    }
  }

  if (legato) {
    for (let i = 0; i < chords.length; i++) {
      const next = chords[i + 1];
      chords[i].end = next ? next.on : Math.max(chords[i].end, chords[i].on + slotTicks);
    }
  }

  const lastTick = chords.reduce((m, c) => Math.max(m, c.end), 0);
  const count = Math.max(minMeasures ?? 0, Math.ceil(lastTick / measureTicks) || 1);

  const lines: string[] = [];
  for (let m = 0; m < count; m++) {
    const start = m * measureTicks;
    const end = start + measureTicks;
    const overlapping = chords.filter((c) => c.on < end && c.end > start);
    lines.push(emitMeasure(overlapping, start, slotTicks, slots, Math.max(1, opts.maxSteps ?? 16)));
  }

  // Names go in last: emitMeasure works in MIDI numbers so chord ordering and
  // deduplication stay numeric, and spelling is a presentation choice.
  const write = spell ?? ((midi: number) => midiToToken(midi, preferFlat));
  const named = lines.map((line) => line.replace(/\d+/g, (d) => write(parseInt(d, 10))));

  return {
    lines: named,
    maxShift,
    placed: chords.flatMap((c) => c.midis.map((midi) => ({ start: c.on / TICKS, midi }))),
  };
}
