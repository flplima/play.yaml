'use strict';

/**
 * generate.ts — deterministic generators that expand to ordinary measure
 * strings before compilation: `spread:` (euclidean rhythms), `arp:`
 * (arpeggios), `walk:` (seeded random walks), plus the seeded hash all
 * stochastic features draw from.
 *
 * Design rules (docs/syntax-differentiation.md): generators are named YAML
 * items, never in-string operators; every random choice is a pure function
 * of (seed, position), so a score always compiles to the same MIDI.
 */

import { chordToScale, degreeToMidi, letterSpelling, midiToName, noteToMidi, parseScale } from './theory';

// ---------------------------------------------------------------------------
// Seeded determinism
// ---------------------------------------------------------------------------

/**
 * Deterministic hash of a few integers → [0, 1). Same inputs, same output,
 * on every platform (32-bit integer math only) — never Math.random, so
 * compiled songs and golden digests stay reproducible.
 */
export function hash01(...values: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const v of values) {
    h = Math.imul(h ^ (Math.trunc(v) | 0), 0x01000193);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

export const DEFAULT_SEED = 1;

// ---------------------------------------------------------------------------
// Euclidean rhythms — `spread:`
// ---------------------------------------------------------------------------

/**
 * Distribute `pulses` onsets as evenly as possible over `steps` slots
 * (Toussaint 2005). Implemented from the definition via the ratio test —
 * step i is an onset when the line of slope pulses/steps crosses an integer
 * inside it — which yields the maximally even pattern starting on a hit:
 * bjorklund(3, 8) → x..x..x. (the tresillo). `rotate` advances the starting
 * point: rotate 2 begins the same cycle two steps later.
 */
export function bjorklund(pulses: number, steps: number, rotate = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < steps; i++) {
    const j = (((i + rotate) % steps) + steps) % steps;
    out.push((j * pulses) % steps < pulses);
  }
  return out;
}

/**
 * A `spread:` play item — one generated measure of euclidean rhythms.
 * `steps` sets the grid; every other key is a measure token (drum name,
 * note, degree) with its pulse count, or [pulses, rotate]:
 *
 *   - spread: {steps: 16, bd: 5, hh: [13, 2], sd: [2, 4]}
 *
 * Layers landing on the same step merge into a chord; empty steps rest.
 */
export interface SpreadSpec {
  steps: number;
  [layer: string]: number | [number, number];
}

export function expandSpread(spec: SpreadSpec): string {
  const steps = spec.steps;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error('"spread:" needs "steps:" — the grid size, a positive whole number.');
  }
  const layers = Object.entries(spec).filter(([key]) => key !== 'steps');
  if (layers.length === 0) {
    throw new Error('"spread:" needs at least one layer — a token with its pulse count, e.g. {steps: 8, bd: 3}.');
  }
  const grid: string[][] = Array.from({ length: steps }, () => []);
  for (const [token, value] of layers) {
    const [pulses, rotate] = Array.isArray(value) ? value : [value, 0];
    if (!Number.isInteger(pulses) || pulses < 0 || !Number.isInteger(rotate)) {
      throw new Error(
        `"spread:" layer "${token}" — expected pulses or [pulses, rotate] as whole numbers, got ${JSON.stringify(value)}.`,
      );
    }
    if (pulses > steps) {
      throw new Error(`"spread:" layer "${token}" has ${pulses} pulses over ${steps} steps — pulses can't exceed steps.`);
    }
    const mask = bjorklund(pulses, steps, rotate);
    for (let i = 0; i < steps; i++) if (mask[i]) grid[i].push(token);
  }
  return grid
    .map((hits) => (hits.length === 0 ? '~' : hits.length === 1 ? hits[0] : `[${hits.join(' ')}]`))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Arpeggios — `arp:`
// ---------------------------------------------------------------------------

/**
 * An `arp:` play item — one generated measure of chord tones:
 *
 *   - arp: {chord: Dm7, mode: updown, steps: 8}
 *   - arp: {notes: [d3, f3, a3, c4], mode: converge, steps: 8, octaves: 2}
 *
 * `chord:` resolves tones through the chord-scale machinery (Dm7 → D dorian
 * → 1-3-5-7; plain triads give 1-3-5); `notes:` lists them explicitly;
 * `tones:` overrides the degrees picked from the chord. Modes: up, down,
 * updown, downup, converge, diverge, random (seeded).
 */
export interface ArpSpec {
  chord?: string;
  notes?: string[];
  tones?: number[];
  mode?: string;
  steps?: number;
  octave?: number;
  octaves?: number;
  seed?: number;
}

const ARP_MODES = ['up', 'down', 'updown', 'downup', 'converge', 'diverge', 'random'] as const;

export function expandArp(spec: ArpSpec): string {
  const steps = spec.steps ?? 8;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error('"arp:" — "steps:" must be a positive whole number.');
  }
  const mode = spec.mode ?? 'up';
  if (!(ARP_MODES as readonly string[]).includes(mode)) {
    throw new Error(`"arp:" — unknown mode "${mode}" (use ${ARP_MODES.join(', ')}).`);
  }

  let pool: number[];
  // How each pitch class is written, so sheet music spells the arpeggio the
  // way its notes or its chord are written (Gm7: G Bb D F, not G A# D F).
  const spelled = new Map<number, { letter: string; alter: number }>();
  if (spec.notes) {
    pool = spec.notes.map((n) => {
      const midi = noteToMidi(String(n));
      if (midi === null) throw new Error(`"arp:" — "${n}" is not a note.`);
      const spelling = letterSpelling(String(n), midi);
      if (spelling) spelled.set(((midi % 12) + 12) % 12, spelling);
      return midi;
    });
  } else if (spec.chord) {
    const scale = chordToScale(spec.chord) ?? parseScale(spec.chord);
    const quality = /^[a-gA-G](?:#|b)?([^/\s]*)/.exec(spec.chord.trim())?.[1] ?? '';
    const tones = spec.tones ??
      (/6/.test(quality) ? [1, 3, 5, 6] : /7|9|11|13/.test(quality) ? [1, 3, 5, 7] : [1, 3, 5]);
    const octave = spec.octave ?? 4;
    pool = tones.map((t) => degreeToMidi(String(t), scale, octave)!);
    // A chord's nth degree takes the letter n - 1 steps above its root's.
    const root = LETTERS.indexOf(spec.chord.trim()[0].toUpperCase());
    tones.forEach((t, i) => {
      const letter = LETTERS[(root + Math.max(0, Number(t) - 1)) % 7];
      const pc = ((pool[i] % 12) + 12) % 12;
      let alter = (((pc - NATURAL_PC[letter]) % 12) + 12) % 12;
      if (alter > 6) alter -= 12;
      if (root >= 0 && Math.abs(alter) <= 1 && !spelled.has(pc)) spelled.set(pc, { letter, alter });
    });
  } else {
    throw new Error('"arp:" needs a "chord:" (e.g. Dm7) or explicit "notes:".');
  }
  const name = (midi: number): string => {
    const s = spelled.get(((midi % 12) + 12) % 12);
    if (!s) return midiToName(midi);
    return `${s.letter}${s.alter > 0 ? '#' : s.alter < 0 ? 'b' : ''}${Math.floor((midi - s.alter) / 12) - 1}`;
  };
  const octaves = spec.octaves ?? 1;
  const base = [...pool];
  for (let o = 1; o < octaves; o++) pool.push(...base.map((m) => m + 12 * o));

  const asc = [...new Set(pool)].sort((a, b) => a - b);
  let seq: number[];
  switch (mode) {
    case 'up': seq = asc; break;
    case 'down': seq = [...asc].reverse(); break;
    // Ends don't repeat at the turnaround: c e g e → c e g e c e g e…
    case 'updown': seq = [...asc, ...asc.slice(1, -1).reverse()]; break;
    case 'downup': { const desc = [...asc].reverse(); seq = [...desc, ...desc.slice(1, -1).reverse()]; break; }
    case 'converge': {
      seq = [];
      for (let lo = 0, hi = asc.length - 1; lo <= hi; lo++, hi--) {
        seq.push(asc[lo]);
        if (hi !== lo) seq.push(asc[hi]);
      }
      break;
    }
    case 'diverge': {
      seq = [];
      for (let lo = 0, hi = asc.length - 1; lo <= hi; lo++, hi--) {
        seq.push(asc[lo]);
        if (hi !== lo) seq.push(asc[hi]);
      }
      seq.reverse();
      break;
    }
    default: { // random — seeded pick per step
      const seed = spec.seed ?? DEFAULT_SEED;
      return Array.from({ length: steps }, (_, i) =>
        name(asc[Math.floor(hash01(seed, i, 6151) * asc.length)])).join(' ');
    }
  }
  return Array.from({ length: steps }, (_, i) => name(seq[i % seq.length])).join(' ');
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// ---------------------------------------------------------------------------
// Random walks — `walk:`
// ---------------------------------------------------------------------------

/**
 * A `walk:` play item — one generated measure of scale degrees from a seeded
 * drunk walk (the degrees re-key with `scale:` and inline `==chords==`, like
 * hand-written degrees):
 *
 *   - walk: {steps: 8, start: 1, span: [-3, 10]}
 *   - walk: {steps: 8, moves: [-2, -1, 1, 2], weights: [1, 3, 3, 1], seed: 12}
 *
 * Later `walk:` items in the same play list continue where the previous one
 * left off; declaring `start:` begins anew. Bounds reflect.
 */
export interface WalkSpec {
  steps?: number;
  start?: number;
  moves?: number[];
  weights?: number[];
  span?: [number, number];
  seed?: number;
}

/** Walk continuity across the items of one play list. */
export interface WalkState {
  degree?: number;
  count: number;
}

export function expandWalk(spec: WalkSpec, state: WalkState): string {
  const steps = spec.steps ?? 8;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error('"walk:" — "steps:" must be a positive whole number.');
  }
  const moves = spec.moves ?? [-2, -1, 1, 2];
  const weights = spec.weights ?? moves.map(() => 1);
  if (moves.length === 0 || weights.length !== moves.length) {
    throw new Error('"walk:" — "weights:" must pair one weight with each entry of "moves:".');
  }
  const [min, max] = spec.span ?? [-3, 10];
  if (!(min < max)) throw new Error('"walk:" — "span:" must be [low, high] with low < high.');
  const seed = spec.seed ?? DEFAULT_SEED;
  const total = weights.reduce((a, b) => a + b, 0);

  let current = spec.start !== undefined || state.degree === undefined
    ? (spec.start ?? 1)
    : state.degree;
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    // The very first note of a fresh walk is the starting degree itself.
    if (i > 0 || state.degree !== undefined && spec.start === undefined) {
      let r = hash01(seed, state.count++, 24593) * total;
      let move = moves[moves.length - 1];
      for (let k = 0; k < moves.length; k++) {
        r -= weights[k];
        if (r < 0) { move = moves[k]; break; }
      }
      current += move;
      // Reflect off the span's edges.
      while (current < min || current > max) {
        if (current > max) current = 2 * max - current;
        if (current < min) current = 2 * min - current;
      }
    }
    out.push(String(current));
  }
  state.degree = current;
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// Humanize
// ---------------------------------------------------------------------------

export interface HumanizeSpec {
  /** Max timing offset, in beats (events shift ±time). */
  time: number;
  /** Max velocity offset, in steps (velocities shift ±velocity). */
  velocity: number;
}

/**
 * `humanize: 0.5` — intensity preset (1 ≈ ±0.03 beats, ±10 velocity) — or
 * `humanize: {time: 0.02, velocity: 6}` explicit.
 */
export function normalizeHumanize(
  value: number | { time?: number; velocity?: number } | undefined,
): HumanizeSpec | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    return value > 0 ? { time: 0.03 * value, velocity: 10 * value } : undefined;
  }
  return { time: value.time ?? 0, velocity: value.velocity ?? 0 };
}
