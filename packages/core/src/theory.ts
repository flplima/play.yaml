'use strict';

/**
 * theory.ts — pitch, scale and meter math. Pure functions, no DSL syntax:
 * everything here answers "what note is that?" rather than "how is it written?"
 */

export const DEFAULT_MEASURE = '4/4';
export const DEFAULT_SCALE = 'c major';
export const DEFAULT_OCTAVE = 4;

const PITCH_CLASSES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES: Record<string, number[]> = {
  // The seven Greek modes…
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  // …with the familiar aliases…
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
  // …and non-diatonic scales: these can hold pitch pairs no Greek mode can
  // (an augmented 2nd, or both forms of a degree side by side).
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  'harmonic major': [0, 2, 4, 5, 7, 8, 11],
  octatonic: [0, 1, 3, 4, 6, 7, 9, 10], // diminished, half-whole
  diminished: [0, 2, 3, 5, 6, 8, 9, 11], // whole-half — the scale of a °7 chord
  'whole tone': [0, 2, 4, 6, 8, 10],
  'bebop dominant': [0, 2, 4, 5, 7, 9, 10, 11],
  'bebop major': [0, 2, 4, 5, 7, 8, 9, 11],
};

/**
 * Chord quality → the scale it implies, in the chord-scale sense: the notes a
 * player would draw on while that chord sounds. Longest suffix wins, so "m7b5"
 * is matched before "m7" and "m".
 */
const CHORD_SCALES: [RegExp, string][] = [
  [/^(m7b5|min7b5|ø7?|halfdim)$/i, 'locrian'],
  [/^(dim7?|°7?|o7)$/i, 'diminished'],
  [/^(m|min|-)(maj|M)7$/i, 'harmonic minor'],
  [/^(m|min|-)(6|69|7|9|11|13)/i, 'dorian'], // m7 and m6 are dorian territory
  [/^(m|min|-)/i, 'aeolian'],
  [/^(maj|M|Δ)(7|9|13)?(#11)$/i, 'lydian'],
  [/^(maj|M|Δ)(7|9|13)/i, 'ionian'],
  [/^(aug|\+)/i, 'whole tone'],
  [/^(7|9|11|13|sus|7sus)/i, 'mixolydian'],
  [/^(6|69|add9|)$/i, 'ionian'], // plain triad or 6/add9
];

export interface ScaleInfo {
  rootPc: number;
  intervals: number[];
}

/** "g" + "#"/"b" → pitch class 0-11. */
function rootPitchClass(letter: string, accidental: string | undefined): number {
  let pc = PITCH_CLASSES[letter.toLowerCase()];
  if (accidental === '#') pc += 1;
  if (accidental === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/**
 * A chord symbol → the scale it implies ("Dm7" → D dorian, "A7" → A
 * mixolydian, "G#dim7" → G# diminished). A slash bass is accepted and
 * ignored: degrees stay measured from the chord's root.
 */
export function chordToScale(chord: string): ScaleInfo | null {
  const m = /^([a-gA-G])(#|b)?([^/\s]*)(?:\/[a-gA-G][#b]?)?$/.exec(chord.trim());
  if (!m) return null;
  const quality = m[3].replace(/[()]/g, '');
  const found = CHORD_SCALES.find(([re]) => re.test(quality));
  if (!found) return null;
  return { rootPc: rootPitchClass(m[1], m[2]), intervals: SCALES[found[1]] };
}

/**
 * "g major" / "eb minor" / "g lydian" / "a" (major implied) → root pitch
 * class + intervals. Any Greek mode name works alongside major/minor, and
 * unique prefixes of at least 3 letters abbreviate ("g mix", "c lyd").
 * A chord symbol works too — it implies its chord-scale.
 */
export function parseScale(scale: string | undefined): ScaleInfo {
  const text = String(scale ?? DEFAULT_SCALE).trim();
  const m = /^([a-gA-G])(#|b)?((?:\s+[a-z]+)*)$/i.exec(text);
  const mode = (m?.[3] || 'major').trim().toLowerCase().replace(/\s+/g, ' ');
  let intervals = m && SCALES[mode];
  if (m && !intervals) {
    // Word-wise abbreviation: each word (≥3 letters) prefixes the key's word,
    // e.g. "harm min" → "harmonic minor", "mix" → "mixolydian".
    const words = mode.split(' ');
    const matches = Object.keys(SCALES).filter((k) => {
      const kw = k.split(' ');
      return kw.length === words.length && words.every((w, i) => w.length >= 3 && kw[i].startsWith(w));
    });
    if (matches.length > 0 && new Set(matches.map((k) => SCALES[k].join(','))).size === 1) {
      intervals = SCALES[matches[0]];
    }
  }
  if (!m || !intervals) {
    // Not a scale name — it may be a chord symbol, which implies one.
    const fromChord = chordToScale(text);
    if (fromChord) return fromChord;
    throw new Error(
      `Invalid scale "${scale}" — expected a scale ("g major", "g lydian") or a ` +
        `chord symbol ("Dm7", "A7", "G#dim7").`,
    );
  }
  return { rootPc: rootPitchClass(m[1], m[2]), intervals };
}

/**
 * Scale-degree token ("1", "8", "4#", "7b", "0", "-1", "5^", "5-") → MIDI
 * number, or null if the token isn't a degree. Degree 1 is the scale root at
 * `baseOctave`; degrees past the scale length keep climbing (8 = root an
 * octave up), degrees at 0 or below step under the root (0 = one scale step
 * below 1), and trailing ^/+/- shift whole octaves.
 */
export function degreeToMidi(token: string, scale: ScaleInfo, baseOctave: number): number | null {
  const m = /^(-?\d+)(#|b)?([+^-]*)$/.exec(token.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10) - 1;
  const len = scale.intervals.length;
  const idx = ((n % len) + len) % len;
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (
    (baseOctave + 1) * 12 + scale.rootPc +
    scale.intervals[idx] + 12 * Math.floor(n / len) + shift +
    12 * octaveShift(m[3])
  );
}

/**
 * Trailing octave modifiers → net octave shift.
 * `^` and `+` each raise an octave, `-` lowers one; they stack (`^^` = +2).
 */
export function octaveShift(modifiers: string): number {
  let shift = 0;
  for (const ch of modifiers) {
    if (ch === '^' || ch === '+') shift += 1;
    else if (ch === '-') shift -= 1;
  }
  return shift;
}

/** "c" / "eb3" / "F#2" / "c^" / "g-" → MIDI number, or null if not a note. */
export function noteToMidi(token: string, defaultOctave: number = DEFAULT_OCTAVE): number | null {
  const m = /^([a-gA-G])(#{1,2}|b{1,2})?(-?\d)?([+^-]*)$/.exec(token.trim());
  if (!m) return null;
  let pc = PITCH_CLASSES[m[1].toLowerCase()];
  if (m[2]) pc += (m[2][0] === '#' ? 1 : -1) * m[2].length;
  const octave = m[3] !== undefined ? parseInt(m[3], 10) : defaultOctave;
  return (octave + 1) * 12 + pc + 12 * octaveShift(m[4]);
}

/** Back-compat helper: "C4" / "f#3" → MIDI number (octave required). */
export function nameToMidi(name: string): number | null {
  const m = /^([a-gA-G])(#|b)?(-?\d+)$/.exec(String(name).trim());
  if (!m) return null;
  let pc = PITCH_CLASSES[m[1].toLowerCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

/** MIDI number → canonical sharp name ("G3"). */
export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return NAMES_SHARP[pc] + (Math.floor(midi / 12) - 1);
}

/** "4/4" | "3/4" | 5 → measure length in quarter-note beats. */
export function measureToBeats(measure: string | number | undefined): number {
  if (measure == null) measure = DEFAULT_MEASURE;
  if (typeof measure === 'number') return measure;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(measure).trim());
  if (!m) {
    const n = Number(measure);
    if (Number.isFinite(n) && n > 0) return n;
    throw new Error(`Invalid measure "${measure}" — expected "4/4" or a beat count.`);
  }
  return parseInt(m[1], 10) * (4 / parseInt(m[2], 10));
}
