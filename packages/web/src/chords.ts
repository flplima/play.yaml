/**
 * chords.ts — the chord progression of a compiled song, for the harmony view.
 *
 * Naming the notes sounding at one instant fails on most real music: an
 * arpeggio is one note at a time, a melody adds passing notes, and a held note
 * from the last chord rings into the next. So this reads the song a window at
 * a time (a bar, or half a bar when the harmony moves faster) and asks which
 * chord explains most of the time spent in it, with the bass as the anchor.
 *
 * It reads the accompaniment, not the tune: every pitched track but the one
 * that sits highest. A song with one track is read whole, and a window the
 * accompaniment alone cannot name is read again with the tune in.
 */
import { DRUM_CHANNEL, type CompiledSong } from '@play.yaml/core';

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface Chord {
  root: number;
  /** The lowest pitch class in the window; a slash chord when it is not the root. */
  bass: number;
  quality: string;
  /** Text after the root name: "m", "7", "dim"… */
  suffix: string;
  triad: 'major' | 'minor' | null;
  /** Its pitch classes, root first. */
  tones: number[];
}

export interface ChordSpan {
  start: number;
  end: number;
  chord: Chord;
}

const CHORDS: { intervals: number[]; quality: string; suffix: string; triad: 'major' | 'minor' | null }[] = [
  { intervals: [0, 4, 7], quality: 'major', suffix: '', triad: 'major' },
  { intervals: [0, 3, 7], quality: 'minor', suffix: 'm', triad: 'minor' },
  { intervals: [0, 3, 6], quality: 'dim', suffix: 'dim', triad: null },
  { intervals: [0, 4, 8], quality: 'aug', suffix: 'aug', triad: null },
  { intervals: [0, 2, 7], quality: 'sus', suffix: 'sus2', triad: null },
  { intervals: [0, 5, 7], quality: 'sus', suffix: 'sus4', triad: null },
  { intervals: [0, 4, 7, 11], quality: 'major', suffix: 'maj7', triad: 'major' },
  { intervals: [0, 4, 7, 10], quality: 'major', suffix: '7', triad: 'major' },
  { intervals: [0, 3, 7, 10], quality: 'minor', suffix: 'm7', triad: 'minor' },
  { intervals: [0, 3, 7, 11], quality: 'minor', suffix: 'm(maj7)', triad: 'minor' },
  { intervals: [0, 3, 6, 10], quality: 'dim', suffix: 'm7b5', triad: null },
  { intervals: [0, 3, 6, 9], quality: 'dim', suffix: 'dim7', triad: null },
  { intervals: [0, 5, 7, 10], quality: 'sus', suffix: '7sus4', triad: null },
];

export function chordLabel(c: Chord): string {
  const name = SHARP_NAMES[c.root] + c.suffix;
  return c.bass === c.root ? name : `${name}/${SHARP_NAMES[c.bass]}`;
}

export const sameChord = (a: Chord, b: Chord) => a.root === b.root && a.suffix === b.suffix && a.bass === b.bass;

/** Exactly these pitch classes as a chord, preferring the bass as root. */
export function exactChord(held: number[], bass: number): Chord | null {
  if (held.length < 3) return null;
  const set = new Set(held);
  const roots = [bass, ...held.filter((p) => p !== bass)];
  for (const root of roots) {
    for (const c of CHORDS) {
      if (c.intervals.length !== set.size) continue;
      if (c.intervals.every((i) => set.has((root + i) % 12))) {
        return { root, bass, quality: c.quality, suffix: c.suffix, triad: c.triad, tones: c.intervals.map((i) => (root + i) % 12) };
      }
    }
  }
  return null;
}

interface Pitched {
  time: number;
  end: number;
  midi: number;
}

interface Fit {
  chord: Chord;
  /** Share of the window's sounding time the chord's notes account for. */
  coverage: number;
}

/**
 * The chord that best explains a window: the time each pitch class sounds in
 * it, against every chord on every root. A note outside the chord costs more
 * than one inside earns, a chord tone that never sounds costs too, and the
 * bass breaks ties as the root, so C E G with a passing D stays C.
 */
function fitWindow(notes: Pitched[], start: number, end: number): Fit | null {
  const weight = new Array(12).fill(0);
  let bassMidi = Infinity;
  for (const n of notes) {
    const d = Math.min(end, n.end) - Math.max(start, n.time);
    if (d <= 0) continue;
    weight[((n.midi % 12) + 12) % 12] += d;
    if (n.midi < bassMidi) bassMidi = n.midi;
  }
  const total = weight.reduce((a, b) => a + b, 0);
  if (!total || bassMidi === Infinity) return null;
  // A sliver, like the last bar's note ringing a moment into this one, is not
  // a chord tone.
  const present = (pc: number) => weight[pc] >= 0.05 * total;
  if (weight.filter((_, pc) => present(pc)).length < 3) return null;
  const bass = ((bassMidi % 12) + 12) % 12;

  let best: { score: number; inside: number; missing: number; chord: Chord } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const c of CHORDS) {
      const tones = c.intervals.map((i) => (root + i) % 12);
      const inside = tones.reduce((a, p) => a + weight[p], 0);
      const missing = tones.filter((p) => !present(p)).length;
      let score = inside - 1.5 * (total - inside) - missing * (total / tones.length);
      score -= (tones.length - 3) * 0.02 * total; // a triad, unless the 7th is really there
      if (root === bass) score += 0.05 * total;
      if (!tones.includes(bass)) score -= 0.1 * total;
      if (!best || score > best.score) {
        best = { score, inside, missing, chord: { root, bass, quality: c.quality, suffix: c.suffix, triad: c.triad, tones } };
      }
    }
  }
  // A triad needs all three notes; a seventh chord may leave one out (the
  // fifth, usually).
  if (!best || best.missing > (best.chord.tones.length > 3 ? 1 : 0)) return null;
  return { chord: best.chord, coverage: best.inside / total };
}

/** Fit with the accompaniment, falling back to every track when that is too thin. */
function fitBoth(accomp: Pitched[], all: Pitched[], start: number, end: number): Fit | null {
  const fit = fitWindow(accomp, start, end);
  if (fit && fit.coverage >= 0.7) return fit;
  if (accomp === all) return fit && fit.coverage >= 0.6 ? fit : null;
  const wide = fitWindow(all, start, end);
  const best = [fit, wide].filter((f): f is Fit => !!f).sort((a, b) => b.coverage - a.coverage)[0];
  return best && best.coverage >= 0.6 ? best : null;
}

/** The song's chords, in order, one span per change. */
export function chordProgression(song: CompiledSong | null): ChordSpan[] {
  if (!song) return [];
  const tracks = song.tracks
    .filter((t) => t.channel !== DRUM_CHANNEL && !t.kit && t.timeline.length)
    .map((t) => {
      const notes = t.timeline.map((n) => ({ time: n.time, end: n.time + n.duration, midi: n.midi }));
      const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
      return { notes, median: sorted[sorted.length >> 1] };
    });
  if (!tracks.length) return [];
  const all = tracks.flatMap((t) => t.notes);
  let accomp = all;
  if (tracks.length > 1) {
    const top = tracks.reduce((a, b) => (b.median > a.median ? b : a));
    accomp = tracks.filter((t) => t !== top).flatMap((t) => t.notes);
  }

  const bar = Math.max(1, song.measureBeats || 4);
  const endBeat = Math.max(...all.map((n) => n.end));
  const spans: ChordSpan[] = [];
  const push = (start: number, end: number, chord: Chord) => {
    const last = spans[spans.length - 1];
    if (last && sameChord(last.chord, chord) && Math.abs(last.end - start) < 1e-6) last.end = end;
    else spans.push({ start, end, chord });
  };
  for (let start = 0; start < endBeat - 1e-6; start += bar) {
    const end = Math.min(endBeat, start + bar);
    const whole = fitBoth(accomp, all, start, end);
    // Half bars, when the harmony moves faster than the bar and both halves
    // say so more clearly than the whole bar does.
    const mid = start + bar / 2;
    const a = end - start > bar / 2 ? fitBoth(accomp, all, start, mid) : null;
    const b = end - start > bar / 2 ? fitBoth(accomp, all, mid, end) : null;
    if (a && b && !sameChord(a.chord, b.chord) && a.coverage >= 0.85 && b.coverage >= 0.85 && (!whole || whole.coverage < 0.85)) {
      push(start, mid, a.chord);
      push(mid, end, b.chord);
    } else if (whole) {
      push(start, end, whole.chord);
    }
  }
  return spans;
}

/** The span sounding at `beat`, by binary search; -1 before the first. */
export function spanIndexAt(spans: ChordSpan[], beat: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start <= beat) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
