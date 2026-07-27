'use strict';

/**
 * fidelity.ts — decode a Standard MIDI File and score how faithfully one MIDI
 * reproduces another's music. Pure and environment-free (it works on bytes),
 * so it runs in Node and the browser like the rest of core.
 *
 * The comparison is deliberately *musical*, not byte-exact:
 *   - it works in quarter-note beat space, so two performances at different
 *     tempi still line up (tempo is scored separately, on the side);
 *   - the harmony score folds octaves, so an arrangement that doubles a line
 *     8vb — as ours does with the cellos — still matches;
 *   - the whole-song key-transposition that best matches is found and reported,
 *     so a cover in another key is aligned, not penalized;
 *   - alignment is *windowed and local*: each bar-sized window finds its own
 *     best position in the original around a running anchor, re-acquiring over a
 *     wide band when it loses the thread — so meter changes, rubato and cut
 *     sections are followed rather than punished (a global offset can't).
 *
 * The headline is a 0..100 fidelity blended from five sub-scores (harmony,
 * register, rhythm, coverage, tempo), and every window carries its own harmony
 * score so the weakest passages can be flagged.
 */

export interface MidiNote {
  startBeat: number;
  durBeat: number;
  pitch: number; // 0..127
  velocity: number; // 1..127
  channel: number;
}

export interface ParsedMidi {
  tpqn: number;
  notes: MidiNote[];
  /** tempo changes sorted by beat; always carries an entry at beat 0. */
  tempoMap: { beat: number; bpm: number }[];
  /** total length in quarter-note beats (last note-off). */
  lengthBeats: number;
}

/** MIDI variable-length quantity read from `bytes` at `pos`. */
function readVarLen(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let p = pos;
  for (;;) {
    const b = bytes[p++];
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { value, next: p };
}

/**
 * Parse Standard MIDI File bytes (format 0 or 1) into notes + a tempo map,
 * both measured in quarter-note beats. Running status, meta events and sysex
 * are handled; SMPTE time division is rejected (we only speak ticks-per-beat).
 */
export function decodeMidi(bytes: Uint8Array): ParsedMidi {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  if (bytes.length < 14 || tag(0) !== 'MThd') throw new Error('not a MIDI file (missing MThd header)');
  const headerLen = dv.getUint32(4);
  const ntrks = dv.getUint16(10);
  const division = dv.getInt16(12);
  if (division <= 0) throw new Error('SMPTE time division is not supported');
  const tpqn = division;

  const notes: MidiNote[] = [];
  const tempos: { tick: number; bpm: number }[] = [];
  let p = 8 + headerLen;

  for (let t = 0; t < ntrks && p + 8 <= bytes.length; t++) {
    if (tag(p) !== 'MTrk') break; // tolerate junk/padding after the tracks
    const len = dv.getUint32(p + 4);
    let end = p + 8 + len;
    if (end > bytes.length) end = bytes.length;
    p += 8;

    let tick = 0;
    let status = 0;
    // active note-ons keyed by (channel<<8)|pitch, oldest-first, so repeated
    // pitches nest correctly.
    const active = new Map<number, number[]>();

    while (p < end) {
      const vl = readVarLen(bytes, p);
      tick += vl.value;
      p = vl.next;

      let b = bytes[p];
      if (b & 0x80) {
        status = b;
        p++;
      } // else running status: reuse `status`, leave the data byte for below
      const hi = status & 0xf0;
      const ch = status & 0x0f;

      if (hi === 0x90 || hi === 0x80) {
        const pitch = bytes[p++];
        const vel = bytes[p++];
        const key = (ch << 8) | pitch;
        if (hi === 0x90 && vel > 0) {
          let stk = active.get(key);
          if (!stk) active.set(key, (stk = []));
          stk.push(tick * 1000 + vel); // pack onset tick + velocity (vel < 128)
        } else {
          const stk = active.get(key);
          if (stk && stk.length) {
            const packed = stk.shift() as number;
            const onTick = Math.floor(packed / 1000);
            const vel0 = packed % 1000;
            notes.push({
              startBeat: onTick / tpqn,
              durBeat: Math.max(0, tick - onTick) / tpqn,
              pitch,
              velocity: vel0,
              channel: ch,
            });
          }
        }
      } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
        p += 2; // 2-byte channel messages
      } else if (hi === 0xc0 || hi === 0xd0) {
        p += 1; // 1-byte channel messages
      } else if (status === 0xff) {
        const type = bytes[p++];
        const ml = readVarLen(bytes, p);
        p = ml.next;
        if (type === 0x51 && ml.value === 3) {
          const mpq = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
          if (mpq > 0) tempos.push({ tick, bpm: 60000000 / mpq });
        }
        p += ml.value;
      } else if (status === 0xf0 || status === 0xf7) {
        const sl = readVarLen(bytes, p);
        p = sl.next + sl.value;
      } else {
        break; // unrecognized status — abandon this track rather than misread
      }
    }

    // Close any notes left hanging at end of track.
    for (const [key, stk] of active) {
      const pitch = key & 0xff;
      const chn = key >> 8;
      for (const packed of stk) {
        const onTick = Math.floor(packed / 1000);
        notes.push({ startBeat: onTick / tpqn, durBeat: 0, pitch, velocity: packed % 1000, channel: chn });
      }
    }
    p = end;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  const tempoMap = tempos.map((t) => ({ beat: t.tick / tpqn, bpm: t.bpm }));
  if (!tempoMap.length || tempoMap[0].beat > 0) tempoMap.unshift({ beat: 0, bpm: 120 });

  let lengthBeats = 0;
  for (const n of notes) lengthBeats = Math.max(lengthBeats, n.startBeat + n.durBeat);

  return { tpqn, notes, tempoMap, lengthBeats };
}

/** Median bpm across a tempo map, weighted by how long each tempo holds. */
function medianBpm(m: ParsedMidi): number {
  if (m.tempoMap.length === 1) return m.tempoMap[0].bpm;
  const end = Math.max(m.lengthBeats, m.tempoMap[m.tempoMap.length - 1].beat + 1);
  const spans: { bpm: number; beats: number }[] = [];
  for (let i = 0; i < m.tempoMap.length; i++) {
    const from = m.tempoMap[i].beat;
    const to = i + 1 < m.tempoMap.length ? m.tempoMap[i + 1].beat : end;
    spans.push({ bpm: m.tempoMap[i].bpm, beats: Math.max(0, to - from) });
  }
  spans.sort((a, b) => a.bpm - b.bpm);
  const total = spans.reduce((s, x) => s + x.beats, 0) || 1;
  let acc = 0;
  for (const s of spans) {
    acc += s.beats;
    if (acc >= total / 2) return s.bpm;
  }
  return spans[spans.length - 1].bpm;
}

/** beat → seconds via a tempo map (piecewise-constant, ignores ramps). */
function beatToSec(m: ParsedMidi, beat: number): number {
  let sec = 0;
  const map = m.tempoMap;
  for (let i = 0; i < map.length; i++) {
    const from = map[i].beat;
    if (beat <= from) break;
    const to = i + 1 < map.length ? Math.min(map[i + 1].beat, beat) : beat;
    sec += ((to - from) * 60) / map[i].bpm;
    if (i + 1 >= map.length || map[i + 1].beat >= beat) break;
  }
  return sec;
}

export interface FidelityWindow {
  index: number;
  startBeat: number;
  endBeat: number;
  startSec: number;
  /** octave-folded pitch-class match in this window, 0..1 */
  harmony: number;
  /** where this window matched in the original, in beats (for note-level diffs) */
  origStartBeat: number;
  genActive: boolean;
  origActive: boolean;
}

export interface FidelityReport {
  /** headline fidelity, 0..100 */
  score: number;
  /** octave-folded pitch-class match over the notes we actually play, 0..1 */
  harmony: number;
  /** exact-register match (no octave folding), 0..1 */
  pitch: number;
  /** how well note onsets line up in time, 0..1 */
  rhythm: number;
  /** tempo closeness of the two files, 0..1 */
  tempo: number;
  /** fraction of the original's music our arrangement spans at all, 0..1 */
  coverage: number;
  /** semitones the original was shifted by to best match (its key vs ours) */
  transpose: number;
  /** beats the original was shifted by to best match (pickup / intro offset) */
  offsetBeats: number;
  genBpm: number;
  origBpm: number;
  genLengthBeats: number;
  origLengthBeats: number;
  windows: FidelityWindow[];
  /** lowest-scoring windows we actually play, worst first */
  worst: FidelityWindow[];
}

export interface CompareOptions {
  /** grid resolution in steps per quarter-note beat (default 4 = sixteenths). */
  stepsPerBeat?: number;
  /** window size in beats for the per-passage breakdown (default 4). */
  windowBeats?: number;
  /** how many semitones up/down to search for the best key match (default 7). */
  transposeRange?: number;
  /** max |beats| of time-offset to search when (re)acquiring alignment (default 48). */
  maxOffsetBeats?: number;
  /** beats a window may drift from the running anchor before re-acquiring (default 4). */
  localBandBeats?: number;
  /** how many weakest windows to surface in `worst` (default 10). */
  worstCount?: number;
}

interface Roll {
  steps: number;
  spb: number;
  /** 12 pitch-class energies per step (row-major: step*12 + pc). */
  chroma: Float64Array;
  /** L2 norm of each step's chroma column. */
  chromaNorm: Float64Array;
  /** 128 pitch energies per step, used for the strict-register score. */
  pitches: Float64Array;
  pitchNorm: Float64Array;
  /** onset energy per step (velocity sum of notes starting there). */
  onset: Float64Array;
  /** whether any note sustains through each step. */
  active: Uint8Array;
}

/** Rasterize notes onto a beat grid: chroma, full-pitch, onset and activity. */
function buildRoll(m: ParsedMidi, spb: number): Roll {
  const steps = Math.max(1, Math.ceil(m.lengthBeats * spb) + 1);
  const chroma = new Float64Array(steps * 12);
  const pitches = new Float64Array(steps * 128);
  const onset = new Float64Array(steps);
  const active = new Uint8Array(steps);

  for (const n of m.notes) {
    const w = n.velocity / 127;
    const s0 = Math.floor(n.startBeat * spb);
    const s1 = Math.max(s0 + 1, Math.ceil((n.startBeat + n.durBeat) * spb));
    const pc = ((n.pitch % 12) + 12) % 12;
    if (s0 >= 0 && s0 < steps) onset[s0] += w;
    for (let s = Math.max(0, s0); s < Math.min(steps, s1); s++) {
      chroma[s * 12 + pc] += w;
      pitches[s * 128 + n.pitch] += w;
      active[s] = 1;
    }
  }

  const chromaNorm = new Float64Array(steps);
  const pitchNorm = new Float64Array(steps);
  for (let s = 0; s < steps; s++) {
    let cn = 0;
    for (let k = 0; k < 12; k++) cn += chroma[s * 12 + k] ** 2;
    chromaNorm[s] = Math.sqrt(cn);
    let pn = 0;
    for (let k = 0; k < 128; k++) pn += pitches[s * 128 + k] ** 2;
    pitchNorm[s] = Math.sqrt(pn);
  }
  return { steps, spb, chroma, chromaNorm, pitches, pitchNorm, onset, active };
}

/** Per-frame prefix sums so any window aggregate is an O(width) subtraction. */
interface Prefixes {
  chroma: Float64Array; // (steps+1)*12
  pitches: Float64Array; // (steps+1)*128
  onset: Float64Array; // (steps+1)
  active: Float64Array; // (steps+1) — running count of active frames
}

function prefixes(r: Roll): Prefixes {
  const s = r.steps;
  const chroma = new Float64Array((s + 1) * 12);
  const pitches = new Float64Array((s + 1) * 128);
  const onset = new Float64Array(s + 1);
  const active = new Float64Array(s + 1);
  for (let i = 0; i < s; i++) {
    for (let k = 0; k < 12; k++) chroma[(i + 1) * 12 + k] = chroma[i * 12 + k] + r.chroma[i * 12 + k];
    for (let k = 0; k < 128; k++) pitches[(i + 1) * 128 + k] = pitches[i * 128 + k] + r.pitches[i * 128 + k];
    onset[i + 1] = onset[i] + r.onset[i];
    active[i + 1] = active[i] + (r.active[i] ? 1 : 0);
  }
  return { chroma, pitches, onset, active };
}

/** Aggregate chroma over frames [i0,i1) into `out` (clamped to the roll). */
function aggChroma(P: Prefixes, steps: number, i0: number, i1: number, out: Float64Array): void {
  const a = Math.max(0, Math.min(steps, i0));
  const b = Math.max(0, Math.min(steps, i1));
  for (let k = 0; k < 12; k++) out[k] = P.chroma[b * 12 + k] - P.chroma[a * 12 + k];
}
function aggPitch(P: Prefixes, steps: number, i0: number, i1: number, out: Float64Array): void {
  const a = Math.max(0, Math.min(steps, i0));
  const b = Math.max(0, Math.min(steps, i1));
  for (let k = 0; k < 128; k++) out[k] = P.pitches[b * 128 + k] - P.pitches[a * 128 + k];
}
function sumRange(pre: Float64Array, steps: number, i0: number, i1: number): number {
  const a = Math.max(0, Math.min(steps, i0));
  const b = Math.max(0, Math.min(steps, i1));
  return pre[b] - pre[a];
}

/** cosine of two chroma vectors, the second cyclically transposed by `t`. */
function cos12(a: Float64Array, b: Float64Array, t: number): number {
  let na = 0;
  let nb = 0;
  let dot = 0;
  for (let k = 0; k < 12; k++) {
    na += a[k] * a[k];
    nb += b[k] * b[k];
    dot += a[k] * b[(((k - t) % 12) + 12) % 12];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** cosine of two 128-pitch vectors, the second shifted by `t` semitones. */
function cos128(a: Float64Array, b: Float64Array, t: number): number {
  let na = 0;
  let nb = 0;
  let dot = 0;
  for (let k = 0; k < 128; k++) {
    na += a[k] * a[k];
    nb += b[k] * b[k];
    const j = k - t;
    if (j >= 0 && j < 128) dot += a[k] * b[j];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

interface Alignment {
  harmony: number;
  pitch: number;
  coverage: number;
  rhythm: number;
  transpose: number;
  offsetLag: number; // frames: first window's matched (orig - gen) offset
  windows: FidelityWindow[];
}

/**
 * Align every generated window to its best local position in the original at a
 * fixed transposition `t`, tracking a running anchor so the match follows tempo
 * drift and re-acquires (over a wide band) whenever it loses the thread — which
 * is how it copes with meter changes and cut sections.
 */
function alignAt(
  g: ParsedMidi,
  G: Roll,
  O: Roll,
  Pg: Prefixes,
  Po: Prefixes,
  t: number,
  spb: number,
  stepPerWin: number,
  band: number,
  wide: number,
): Alignment {
  const covered = new Uint8Array(O.steps);
  const gChroma = new Float64Array(12);
  const oChroma = new Float64Array(12);
  const gPitch = new Float64Array(128);
  const oPitch = new Float64Array(128);
  const windows: FidelityWindow[] = [];

  let anchor = 0; // running (orig - gen) offset in frames
  let firstLag: number | null = null;
  let lastActiveHarmony = 1; // harmony of the last window we actually scored
  let harmSum = 0;
  let pitchSum = 0;
  let rhythmSum = 0;
  let active = 0;

  for (let w = 0, i0 = 0; i0 < G.steps; w++, i0 += stepPerWin) {
    const i1 = Math.min(G.steps, i0 + stepPerWin);
    const genActive = sumRange(Pg.active, G.steps, i0, i1) > 0;
    const win: FidelityWindow = {
      index: w,
      startBeat: i0 / spb,
      endBeat: i1 / spb,
      startSec: beatToSec(g, i0 / spb),
      harmony: 0,
      origStartBeat: (i0 + anchor) / spb,
      genActive,
      origActive: false,
    };
    if (!genActive) {
      windows.push(win);
      continue;
    }

    aggChroma(Pg, G.steps, i0, i1, gChroma);
    // A weak previous lock (or the very first window) re-acquires over the wide
    // band; otherwise search a narrow band around the running anchor.
    const reacquire = firstLag === null || lastActiveHarmony < 0.4;
    const radius = reacquire ? wide : band;
    let bestLag = anchor;
    let bestCos = -1;
    for (let lag = anchor - radius; lag <= anchor + radius; lag++) {
      aggChroma(Po, O.steps, i0 + lag, i1 + lag, oChroma);
      const c = cos12(gChroma, oChroma, t);
      if (c > bestCos) {
        bestCos = c;
        bestLag = lag;
      }
    }
    anchor = bestLag;
    if (firstLag === null) firstLag = bestLag;
    lastActiveHarmony = Math.max(0, bestCos);

    const j0 = i0 + bestLag;
    const j1 = i1 + bestLag;
    const oActiveFrames = sumRange(Po.active, O.steps, j0, j1);
    win.origActive = oActiveFrames > 0;
    win.harmony = Math.max(0, bestCos);
    win.origStartBeat = j0 / spb;

    aggPitch(Pg, G.steps, i0, i1, gPitch);
    aggPitch(Po, O.steps, j0, j1, oPitch);
    const pc = Math.max(0, cos128(gPitch, oPitch, t));

    // onset-density agreement in the matched window (velocity sums).
    const gOn = sumRange(Pg.onset, G.steps, i0, i1) + 0.5;
    const oOn = sumRange(Po.onset, O.steps, j0, j1) + 0.5;
    const dens = Math.min(gOn, oOn) / Math.max(gOn, oOn);

    harmSum += win.harmony;
    pitchSum += pc;
    rhythmSum += dens;
    active++;

    // Mark genuinely-reproduced original frames for coverage.
    if (win.harmony > 0.5) {
      for (let j = Math.max(0, j0); j < Math.min(O.steps, j1); j++) covered[j] = 1;
    }
    windows.push(win);
  }

  let origActiveFrames = 0;
  let coveredFrames = 0;
  for (let j = 0; j < O.steps; j++) {
    if (!O.active[j]) continue;
    origActiveFrames++;
    if (covered[j]) coveredFrames++;
  }

  return {
    harmony: active ? harmSum / active : 0,
    pitch: active ? pitchSum / active : 0,
    rhythm: active ? rhythmSum / active : 0,
    coverage: origActiveFrames ? coveredFrames / origActiveFrames : 0,
    transpose: t,
    offsetLag: firstLag ?? 0,
    windows,
  };
}

/**
 * Compare two MIDI byte buffers and score how faithfully `gen` reproduces
 * `orig`. `gen` is the arrangement under test: harmony/register ask "when we
 * play, does the original agree?", so cutting a section lowers coverage rather
 * than harmony. Alignment is windowed and local, so meter changes, rubato and
 * cut sections are followed rather than penalized; the best global key is found
 * automatically and reported as `transpose`.
 */
export function compareMidi(
  gen: Uint8Array,
  orig: Uint8Array,
  opts: CompareOptions = {},
): FidelityReport {
  const spb = opts.stepsPerBeat ?? 4;
  const windowBeats = opts.windowBeats ?? 4;
  const tRange = opts.transposeRange ?? 7;
  const wide = Math.round((opts.maxOffsetBeats ?? 48) * spb);
  const band = Math.round((opts.localBandBeats ?? 4) * spb);
  const worstCount = opts.worstCount ?? 10;

  const g = decodeMidi(gen);
  const o = decodeMidi(orig);
  const G = buildRoll(g, spb);
  const O = buildRoll(o, spb);
  const Pg = prefixes(G);
  const Po = prefixes(O);
  const stepPerWin = Math.max(1, Math.round(windowBeats * spb));

  // Try every transposition; keep the key whose windowed harmony is best.
  let best: Alignment | null = null;
  for (let t = -tRange; t <= tRange; t++) {
    const a = alignAt(g, G, O, Pg, Po, t, spb, stepPerWin, band, wide);
    if (!best || a.harmony > best.harmony) best = a;
  }
  const A = best as Alignment;

  const genBpm = medianBpm(g);
  const origBpm = medianBpm(o);
  const tempo = Math.max(0, 1 - Math.abs(Math.log2(genBpm / origBpm)));

  const worst = A.windows
    .filter((x) => x.genActive)
    .sort((a, b) => a.harmony - b.harmony)
    .slice(0, worstCount);

  const score =
    100 * (0.5 * A.harmony + 0.18 * A.pitch + 0.15 * A.rhythm + 0.1 * A.coverage + 0.07 * tempo);

  return {
    score,
    harmony: A.harmony,
    pitch: A.pitch,
    rhythm: A.rhythm,
    tempo,
    coverage: A.coverage,
    transpose: A.transpose,
    offsetBeats: A.offsetLag / spb,
    genBpm,
    origBpm,
    genLengthBeats: g.lengthBeats,
    origLengthBeats: o.lengthBeats,
    windows: A.windows,
    worst,
  };
}
