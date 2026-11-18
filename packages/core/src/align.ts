'use strict';

/**
 * align.ts: follow a performer through a score, by pitch class.
 *
 * `compareMidi` (fidelity.ts) lays two files on a common beat grid, which is
 * right for a cover or an arrangement and wrong for a recording: nobody plays
 * at the score's tempo, so every onset lands off its slot. This module aligns
 * in *seconds* instead. Both note lists become chroma vectors (12 pitch
 * classes per 0.25 s frame) and a DTW path pairs each recording frame with a
 * score frame, so rubato and a different overall tempo are followed, and what
 * the path says is the answer:
 *
 *   - the tempo ratio (our seconds per recording second), overall and per
 *     ~20 s chunk: recording bpm = our bpm × ratio;
 *   - how close the pitch classes stay (mean distance, % of frames under 0.25);
 *   - jumps: a section the performer skipped (score bar a → b), took again
 *     (b → a) or added (extra recording material), each as a penalised move
 *     in the path rather than a smear across it;
 *   - the worst bars, and the key the recording is in (-6..+5 semitones off).
 *
 * What it cannot see: it works on pitch classes, so one wrong note is the same
 * size as transcription noise, an octave error is invisible, and a run of
 * identical bars (an ostinato) cannot be counted, only the span it covers.
 *
 * Zero dependencies, like the rest of core.
 */

import type { CompiledSong } from './song';
import { tempoSegments, beatsToSeconds } from './time';

/** A note in seconds. */
export interface AlignNote {
  pitch: number; // MIDI number
  start: number; // seconds
  dur: number; // seconds
}

export interface AlignInput {
  notes: AlignNote[];
  /** Start time of each bar, in seconds, bar 1 first. */
  barStarts: number[];
}

export interface AlignOptions {
  /** frame length in seconds (default 0.25). Grows by itself on very long input. */
  hop?: number;
  /** cost of a jump in the path (default 5, in units of one frame's distance). */
  jumpPenalty?: number;
  /** semitones to try, as "recording is this much above the score" (default -6..+5). */
  transposes?: number[];
  /** seconds per tempo chunk (default 20). */
  chunkSeconds?: number;
  /** how many worst bars to list (default 12). */
  worstCount?: number;
}

export interface AlignJump {
  /** skip: the performer left out bars; repeat: went back; extra: material the score does not have. */
  kind: 'skip' | 'repeat' | 'extra';
  /** score bar before the jump, and after it (equal for `extra`). */
  fromBar: number;
  toBar: number;
  /** where in the recording it happens, seconds. */
  recSec: number;
  /** for `extra`: how many seconds of recording have no counterpart. */
  extraSec?: number;
}

export interface AlignChunk {
  recSec: number;
  /** the score bar the chunk starts at. */
  bar: number;
  /** our seconds per recording second over the chunk. */
  ratio: number;
}

export interface AlignReport {
  /** semitones the recording sits above the score (the best of the search). */
  transpose: number;
  /** mean distance at transposition 0, for comparison with `meanDistance`. */
  distanceAt0: number;
  /** mean chroma distance over all recording frames: 0 = same pitch classes, ~0.7 = nothing matches;
   *  a frame the path discarded counts 0.7. */
  meanDistance: number;
  /** fraction of recording frames with distance < 0.25 (frames the path discarded count as bad). */
  goodFraction: number;
  /** seconds of the recording the path matched to the score (not lead-in, tail or extra material). */
  matchedSec: number;
  /** where in the recording the path starts and ends, seconds (before/after: talk, silence, applause). */
  startSec: number;
  endSec: number;
  /** our seconds per recording second, over the whole path (jumps excluded). */
  ratio: number;
  /**
   * Whether enough of the recording matched closely for `ratio` to be its
   * tempo: at least 15 s of frames under 0.25, or a quarter of the score when
   * the score is shorter than a minute. A two-bar match in a noisy
   * transcription still yields a ratio, and it means nothing.
   */
  tempoReliable: boolean;
  /** seconds of recording frames under 0.25 (what `tempoReliable` counts). */
  goodSec: number;
  chunks: AlignChunk[];
  jumps: AlignJump[];
  /** weakest bars first, smoothed over neighbours. */
  worstBars: { bar: number; distance: number }[];
  /** lowest and highest score bar the path matched. */
  barsCovered: [number, number];
  recSeconds: number;
  scoreSeconds: number;
}

/** A frame with no notes against one with notes: neither match nor perfect miss. */
const SILENT_VS_NOTES = 0.7;
const GOOD = 0.25;
/**
 * Seconds of close frames (under GOOD) below which the tempo is not reported.
 * Close frames, not matched ones: a path can follow loosely related material
 * (a pentatonic cluster fits most tonal music in some key) at distance ~0.4
 * for its whole length. Real transcriptions that failed had about 4 s of
 * close frames; one that worked, of a free stride version of the piece, 26 s.
 */
const MIN_TEMPO_SEC = 15;
/** Bound on frames^2; beyond it the hop grows. */
const MAX_CELLS = 36_000_000;

interface Chroma {
  v: Float32Array; // frames × 12, unit length
  empty: Uint8Array;
  n: number;
}

function chromaOf(notes: AlignNote[], hop: number, shift: number, n: number): Chroma {
  const v = new Float32Array(n * 12);
  for (const note of notes) {
    const a = Math.floor(note.start / hop);
    const b = Math.floor((note.start + Math.min(Math.max(note.dur, 0.15), 2)) / hop);
    const pc = (((Math.round(note.pitch) + shift) % 12) + 12) % 12;
    for (let i = Math.max(0, a); i <= b && i < n; i++) v[i * 12 + pc] += 1;
  }
  const empty = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 12; k++) s += v[i * 12 + k] ** 2;
    s = Math.sqrt(s);
    if (s === 0) empty[i] = 1;
    else for (let k = 0; k < 12; k++) v[i * 12 + k] /= s;
  }
  return { v, empty, n };
}

function endOf(notes: AlignNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + Math.min(Math.max(n.dur, 0.15), 2));
  return end;
}

interface Path {
  /** matched (recording frame, score frame) pairs in order. */
  rec: number[];
  sc: number[];
  cost: number[]; // per pair
  /** the DP's own total: matched costs, jump penalties, 0.3 per discarded frame (lead-in and tail too). */
  total: number;
}

/** Cost of a recording frame the path throws away (extra material, lead-in, tail). */
const EXTRA = 0.3;

/**
 * The DP. D[i][j] = best total cost of a path that pairs recording frame i
 * with score frame j, starting anywhere in the score and ending anywhere.
 * Moves: (1,1) (1,2) (2,1) cost a small tempo penalty; a skip forward in the
 * score (≥3 frames) or a step back costs `penalty`; and recording frames with
 * no score counterpart cost `penalty` plus 0.3 each. The path may also start after
 * skipping leading recording frames and end before trailing ones (talk, silence,
 * applause), at 0.3 each and no penalty. `total` is the cost of the whole
 * recording, discarded frames included, so keys can be compared by it.
 */
function dtw(R: Chroma, S: Chroma, penalty: number): Path | null {
  const n = R.n;
  const m = S.n;
  if (n < 2 || m < 2) return null;
  const INF = 1e9;
  const D = new Float32Array(n * m).fill(INF);
  const P = new Int32Array(n * m).fill(-1);
  const cost = (i: number, j: number): number => {
    const e = R.empty[i] + S.empty[j];
    if (e === 2) return 0;
    if (e === 1) return SILENT_VS_NOTES;
    let dot = 0;
    for (let k = 0; k < 12; k++) dot += R.v[i * 12 + k] * S.v[j * 12 + k];
    return 1 - dot;
  };
  const cc = new Float32Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) cc[i * m + j] = cost(i, j);

  for (let j = 0; j < m; j++) D[j] = cc[j];
  // Starting at row i means skipping i leading frames: 0.3 each, no jump.

  // best D[i'][j] - 0.3 i' over rows i' ≤ i-3, per column: the "extra material" move.
  const colBest = new Float32Array(m).fill(INF);
  const colArg = new Int32Array(m).fill(-1);
  const sufBest = new Float32Array(m + 1);
  const sufArg = new Int32Array(m + 1);

  for (let i = 1; i < n; i++) {
    if (i >= 3) {
      const r = (i - 3) * m;
      for (let j = 0; j < m; j++) {
        const v = D[r + j] - EXTRA * (i - 3);
        if (v < colBest[j]) {
          colBest[j] = v;
          colArg[j] = r + j;
        }
      }
    }
    const pr = (i - 1) * m;
    // suffix minimum of the previous row: a step back in the score.
    sufBest[m] = INF;
    sufArg[m] = -1;
    for (let j = m - 1; j >= 0; j--) {
      const v = D[pr + j];
      if (v < sufBest[j + 1]) {
        sufBest[j] = v;
        sufArg[j] = pr + j;
      } else {
        sufBest[j] = sufBest[j + 1];
        sufArg[j] = sufArg[j + 1];
      }
    }
    let preBest = INF;
    let preArg = -1;
    for (let j = 1; j < m; j++) {
      if (j >= 3) {
        const v = D[pr + j - 3];
        if (v < preBest) {
          preBest = v;
          preArg = pr + j - 3;
        }
      }
      const c = cc[i * m + j];
      let best = INF;
      let arg = -1;
      let v = D[pr + j - 1] + c;
      if (v < best) { best = v; arg = pr + j - 1; }
      if (j >= 2) {
        v = D[pr + j - 2] + 1.1 * c + 0.05;
        if (v < best) { best = v; arg = pr + j - 2; }
      }
      if (i >= 2) {
        v = D[(i - 2) * m + j - 1] + 1.1 * c + 0.05;
        if (v < best) { best = v; arg = (i - 2) * m + j - 1; }
      }
      if (preArg >= 0) {
        v = preBest + penalty + c; // the performer skipped ahead
        if (v < best) { best = v; arg = preArg; }
      }
      if (sufArg[j] >= 0) {
        v = sufBest[j] + penalty + c; // the performer went back (or stayed on a frame)
        if (v < best) { best = v; arg = sufArg[j]; }
      }
      if (colArg[j - 1] >= 0) {
        v = colBest[j - 1] + EXTRA * i + penalty + c; // recording has extra material
        if (v < best) { best = v; arg = colArg[j - 1]; }
      }
      if (EXTRA * i + c < best) { best = EXTRA * i + c; arg = -1; }
      D[i * m + j] = best;
      P[i * m + j] = arg;
    }
  }

  // End anywhere: trailing frames cost 0.3 each.
  let bi = n - 1;
  let bj = 0;
  let bv = INF;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const v = D[i * m + j] + EXTRA * (n - 1 - i);
      if (v < bv) { bv = v; bi = i; bj = j; }
    }
  }
  const rec: number[] = [];
  const sc: number[] = [];
  const cost2: number[] = [];
  for (let cur = bi * m + bj; cur >= 0; cur = P[cur]) {
    rec.push(Math.floor(cur / m));
    sc.push(cur % m);
    cost2.push(cc[cur]);
  }
  rec.reverse(); sc.reverse(); cost2.reverse();
  return { rec, sc, cost: cost2, total: bv };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 1-based bar holding `sec`: the last bar that starts at or before it. */
export function barAt(barStarts: number[], sec: number): number {
  let lo = 0;
  let hi = barStarts.length - 1;
  if (hi < 0) return 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (barStarts[mid] <= sec + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Follow `rec` (a performance, or a transcription of one) through `score`.
 * Returns null when either side has too little music to align.
 */
export function alignPerformance(
  rec: AlignInput,
  score: AlignInput,
  opts: AlignOptions = {},
): AlignReport | null {
  if (rec.notes.length < 2 || score.notes.length < 2) return null;
  const penalty = opts.jumpPenalty ?? 5;
  const chunkSeconds = opts.chunkSeconds ?? 20;
  const transposes = opts.transposes ?? Array.from({ length: 12 }, (_, k) => k - 6);

  const recEnd = endOf(rec.notes);
  const scEnd = endOf(score.notes);
  let hop = opts.hop ?? 0.25;
  while ((recEnd / hop) * (scEnd / hop) > MAX_CELLS) hop *= 1.25;

  const frames = (end: number, h: number) => Math.ceil(end / h) + 1;
  const S = chromaOf(score.notes, hop, 0, frames(scEnd, hop));

  // The key search runs at twice the hop: a quarter of the work per try.
  const coarse = hop * 2;
  const scoreCoarse = chromaOf(score.notes, coarse, 0, frames(scEnd, coarse));
  const dist = new Map<number, number>();
  const coarseFrames = frames(recEnd, coarse);
  for (const t of new Set([0, ...transposes])) {
    const path = dtw(chromaOf(rec.notes, coarse, -t, coarseFrames), scoreCoarse, penalty);
    // Rank by the whole recording's cost, not the matched cells': a path that matches
    // two bars and discards the rest must not look best.
    if (path) dist.set(t, path.total / coarseFrames);
  }
  // Leave key 0 unless another key is clearly better: noise should not move it.
  let transpose = 0;
  for (const [t, d] of dist) if (d < (dist.get(transpose) ?? Infinity)) transpose = t;
  if ((dist.get(transpose) ?? 0) > (dist.get(0) ?? Infinity) - 0.02) transpose = 0;

  const R = chromaOf(rec.notes, hop, -transpose, frames(recEnd, hop));
  const path = dtw(R, S, penalty);
  if (!path) return null;
  const at0 = transpose === 0 ? path : dtw(chromaOf(rec.notes, hop, 0, frames(recEnd, hop)), S, penalty);

  const barOf = (frame: number) => barAt(score.barStarts, frame * hop);
  const L = path.rec.length;
  const nRec = R.n;
  // Quality over recording frames: a frame the path left out is a miss, not absent.
  // A (2,1) step is a slower performer, not a lost frame; only lead-in, tail and gaps of 3+ count.
  const w = (p: Path, k: number) => (k > 0 && p.rec[k] - p.rec[k - 1] <= 2 ? p.rec[k] - p.rec[k - 1] : 1);
  const quality = (p: Path) => {
    let unpaired = p.rec[0] + (nRec - 1 - p.rec[p.rec.length - 1]);
    for (let k = 1; k < p.rec.length; k++) if (p.rec[k] - p.rec[k - 1] > 2) unpaired += p.rec[k] - p.rec[k - 1] - 1;
    return {
      mean: (p.cost.reduce((a, c, k) => a + c * w(p, k), 0) + SILENT_VS_NOTES * unpaired) / nRec,
      good: p.cost.reduce(
        (a, c, k) => a + (c < GOOD ? w(p, k) : 0), 0) / nRec,
    };
  };
  const q = quality(path);
  let matchedFrames = 1;
  let lowBar = Infinity;
  let highBar = 0;
  for (let k = 0; k < L; k++) {
    const b = barOf(path.sc[k]);
    if (b < lowBar) lowBar = b;
    if (b > highBar) highBar = b;
    if (k > 0 && path.rec[k] - path.rec[k - 1] <= 2) matchedFrames += path.rec[k] - path.rec[k - 1];
  }

  // Steps: regular (di,dj both ≤ 2, dj ≥ 1) or a jump.
  const jumps: AlignJump[] = [];
  const regular: boolean[] = [];
  for (let k = 1; k < L; k++) {
    const di = path.rec[k] - path.rec[k - 1];
    const dj = path.sc[k] - path.sc[k - 1];
    const ok = di <= 2 && dj >= 1 && dj <= 2;
    regular[k] = ok;
    if (ok) continue;
    const from = barOf(path.sc[k - 1]);
    const to = barOf(path.sc[k]);
    const recSec = path.rec[k] * hop;
    if (di >= 3) {
      jumps.push({ kind: 'extra', fromBar: from, toBar: from, recSec, extraSec: di * hop });
    } else if (dj >= 3) {
      if (to !== from) jumps.push({ kind: 'skip', fromBar: from, toBar: to, recSec });
    } else if (to !== from) {
      jumps.push({ kind: 'repeat', fromBar: from, toBar: to, recSec });
    }
  }

  // Tempo: score seconds per recording second over regular steps only.
  const ratioOver = (a: number, b: number): number | null => {
    let di = 0;
    let dj = 0;
    for (let k = a + 1; k <= b; k++) {
      if (!regular[k]) continue;
      di += path.rec[k] - path.rec[k - 1];
      dj += path.sc[k] - path.sc[k - 1];
    }
    return di > 0 ? dj / di : null;
  };
  const overall = ratioOver(0, L - 1);
  const ratio = overall ?? 1;
  const matchedSec = matchedFrames * hop;
  const goodSec = q.good * nRec * hop;
  const tempoReliable = overall != null && goodSec >= Math.min(MIN_TEMPO_SEC, scEnd / 4);
  const chunks: AlignChunk[] = [];
  const per = Math.max(1, Math.round(chunkSeconds / hop));
  for (let a = 0; a + per < L; ) {
    // advance by `per` recording frames, not path steps
    let b = a;
    while (b < L - 1 && path.rec[b] - path.rec[a] < per) b++;
    if (path.rec[b] - path.rec[a] < per) break;
    const r = ratioOver(a, b);
    if (r != null) chunks.push({ recSec: path.rec[a] * hop, bar: barOf(path.sc[a]), ratio: r });
    a = b;
  }

  // Bars: mean cost per bar, smoothed over its neighbours, with enough frames.
  const perBar = new Map<number, number[]>();
  for (let k = 0; k < L; k++) {
    const b = barOf(path.sc[k]);
    (perBar.get(b) ?? perBar.set(b, []).get(b)!).push(path.cost[k]);
  }
  const bars = [...perBar.entries()].filter(([, v]) => v.length >= 4).map(([b, v]) => ({ b, c: mean(v) }));
  const smooth = bars.map((x) => ({
    bar: x.b,
    distance: mean(bars.filter((y) => Math.abs(y.b - x.b) <= 1).map((y) => y.c)),
  }));
  smooth.sort((a, b) => b.distance - a.distance);

  return {
    transpose,
    distanceAt0: quality(at0 ?? path).mean,
    meanDistance: q.mean,
    goodFraction: q.good,
    matchedSec,
    startSec: path.rec[0] * hop,
    endSec: path.rec[L - 1] * hop,
    ratio,
    tempoReliable,
    goodSec,
    chunks,
    jumps,
    worstBars: smooth.slice(0, opts.worstCount ?? 12),
    barsCovered: [lowBar, highBar],
    recSeconds: recEnd,
    scoreSeconds: scEnd,
  };
}

/** The musical content of a compiled song as an alignment input, in seconds. */
export function songAlignInput(song: CompiledSong): AlignInput & { meanBpm: number } {
  const segs = tempoSegments(song.bpm, song.tempoMap);
  const sec = (beat: number) => beatsToSeconds(segs, beat);
  const notes: AlignNote[] = [];
  for (const t of song.tracks) {
    if (t.kit || t.channel === 10) continue;
    for (const e of t.timeline) {
      if (e.midi == null) continue;
      const start = sec(e.time);
      notes.push({ pitch: e.midi, start, dur: sec(e.time + e.duration) - start });
    }
  }
  notes.sort((a, b) => a.start - b.start);

  // Bar lines: the compile's own when it kept them, else a uniform grid.
  const written = song.tracks.find((t) => t.bars?.length)?.bars;
  const beats: number[] = [];
  if (written) for (const b of written) beats.push(b.start);
  else for (let b = 0; b < song.lengthBeats - 1e-6; b += song.measureBeats) beats.push(b);
  if (!beats.length) beats.push(0);
  const end = Math.max(song.lengthBeats, 1e-9);
  return {
    notes,
    barStarts: beats.map(sec),
    meanBpm: (end * 60) / Math.max(sec(end), 1e-9),
  };
}
