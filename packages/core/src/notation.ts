'use strict';

/**
 * notation.ts: a score as sheet music. Parts, measures, voices and notes with
 * written durations, ties, tuplets, clefs, keys and spelled pitches, built
 * from the *written* compile (`compileDoc(doc, { written: true })`) so gate,
 * humanize, rubato and strums never reach the page.
 *
 * ── Ticks ────────────────────────────────────────────────────────────────
 *
 * Everything below is integer ticks per quarter note (`Score.divisions`),
 * never float beats: a duration either fills its slot or it does not, and
 * `0.1 + 0.2` cannot be allowed to decide that. The resolution starts at
 * NOTATE_TICKS (LCM(1..10), so triplets to 10-tuplets land on whole ticks)
 * and is raised by a small factor when a score needs more: 64th notes need
 * a factor of 2, an 11-tuplet a factor of 11.
 *
 * ── How a voice becomes notes ────────────────────────────────────────────
 *
 * 1. A track's notes are split across staves (a grand staff for keyboards)
 *    and then into voices with `separateVoices`: a voice is a line that only
 *    ever stacks chords, never overlaps itself.
 * 2. Each voice is cut at the bar lines (ties carry it across) and its gaps
 *    become rests.
 * 3. Tuplets are found from tick positions. A boundary off the 128th-note
 *    grid needs one; it gets the smallest metric unit (a beat, a half bar,
 *    the bar) that holds every note it touches, divided by the odd part of
 *    the grid that unit needs. Three equal notes in a 4/4 bar are a
 *    half-note triplet over the bar, not a cascade of tied 16th triplets.
 * 4. Each note or rest is written as the fewest tied values that keep the
 *    meter readable: a value may run to the end of the next-larger metric
 *    unit than the one it starts on. In 4/4 a note on beat 2 cannot run
 *    through beat 3 (the half bar), in 6/8 notes group by dotted quarters.
 */

import { BarInfo, CompiledSong, CompiledTrack, MetronomeMarks, SongDoc, TempoEvent, compileDoc } from './song';
import { NOTATE_TICKS, NotateNote, separateVoices } from './notate';
import { SCALES, parseScale } from './theory';
import { drumName } from './vocabulary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th' | '128th';

/** Index = how many times a whole note is halved. */
export const NOTE_TYPES: readonly NoteType[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th', '128th'];

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export type Accidental = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'flat-flat';

/** A pitch as it is written: letter, alteration and octave (C4 = middle C). */
export interface SpelledPitch {
  step: Step;
  alter: number;
  octave: number;
  /** The accidental to print, when the key and the bar so far do not imply it. */
  accidental?: Accidental;
}

export type Notehead = 'normal' | 'x' | 'circle-x' | 'diamond' | 'triangle';

/** One beam line at one note, as MusicXML spells it. */
export type BeamValue = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook';

/** Where a drum sits on the percussion staff, and what it looks like there. */
export interface DrumDisplay {
  step: Step;
  octave: number;
  notehead: Notehead;
  /** The part's instrument id for this GM key, e.g. "P2-I39" (unique within the score). */
  instrument: string;
}

export interface NotationNote {
  /** The sounding MIDI number; for a drum, its GM percussion key. */
  midi: number;
  /** Pitched parts. */
  pitch?: SpelledPitch;
  /** Percussion parts. */
  drum?: DrumDisplay;
}

/** A tuplet as written: `actual` notes of `normalType` in the time of `normal`. */
export interface TupletMark {
  actual: number;
  normal: number;
  normalType: NoteType;
  /** This event opens the bracket. */
  start?: boolean;
  /** This event closes the bracket. */
  stop?: boolean;
}

export interface NotationEvent {
  kind: 'note' | 'rest';
  /** Ticks from the start of the measure. */
  offset: number;
  /** Ticks it actually lasts, tuplet ratio applied. */
  duration: number;
  /** The written value; absent only on a whole-measure rest. */
  type?: NoteType;
  dots: number;
  /** A rest filling the whole measure, whatever its meter. */
  measureRest?: boolean;
  /**
   * A rest that keeps its voice's count but is not printed. Rests in a
   * staff's second, third and fourth voices are padding: voice 1 already
   * shows where the staff is silent, and printed they pile up around the
   * notes of the other voices.
   */
  hidden?: boolean;
  /** Chord members, low to high; empty for a rest. */
  notes: NotationNote[];
  /** Tied from the previous event of this voice (maybe in the previous measure). */
  tieStop?: boolean;
  /** Tied into the next event of this voice. */
  tieStart?: boolean;
  tuplet?: TupletMark;
  /** Tremolo strokes for a drum roll (`sd~` = 3). */
  tremolo?: number;
  /**
   * Beams through this note or chord: `[0]` is the eighth beam, `[1]` the
   * 16th, and so on. Absent on rests, unbeamed notes and lone flags.
   */
  beams?: BeamValue[];
  /**
   * A fixed stem direction. Percussion always sets it: a drum part reads with
   * every stem up (feet down when a second voice holds them), while a
   * renderer left to itself flips stems by staff position, kick up and snare
   * down in the same groove. Pitched staves set it in measures where they
   * hold two or more voices: the first voice up, the others down, so a voice
   * that starts or stops mid-beam does not flip the stems under the beam.
   */
  stem?: 'up' | 'down';
}

export interface NotationVoice {
  /** MusicXML voice number: 1-4 on staff 1, 5-8 on staff 2. */
  voice: number;
  /** 1-based staff within the part. */
  staff: number;
  /** In time order; their durations sum to the measure length. */
  events: NotationEvent[];
}

export interface NotationKey {
  /** Sharps (positive) or flats (negative). */
  fifths: number;
  /** "major", "minor", a mode name, or "none" for a scale no signature describes. */
  mode: string;
}

export interface Clef {
  sign: 'G' | 'F' | 'C' | 'percussion';
  line: number;
}

export interface PartMeasure {
  /** The key signature, present on the first measure and wherever it changes. */
  key?: NotationKey;
  /** Voice 1 of every staff is always present; other voices only where they have notes. */
  voices: NotationVoice[];
  /**
   * Clef changes at the start of this measure, by staff index (0 = staff 1);
   * empty slots keep the clef in force. Never set on the first measure,
   * whose clefs are `Part.clefs`.
   */
  clefs?: (Clef | undefined)[];
}

/** A drum the part plays, for the MusicXML instrument list. */
export interface PartInstrument {
  id: string;
  name: string;
  /** GM percussion key. */
  key: number;
}

export interface Part {
  /** "P1", "P2"... in the order parts first appear among the tracks. */
  id: string;
  name: string;
  /**
   * The compiled tracks this part is drawn from, as indices into
   * `compileDoc(doc, { written: true }).tracks`. One, except for a keyboard
   * played by several tracks (see `groupParts`).
   */
  tracks: number[];
  sample: string;
  kit?: string;
  /** 1-based MIDI channel. */
  channel: number;
  /** 0-based GM program, when the sample has one. */
  program?: number;
  percussion: boolean;
  staves: number;
  /** One per staff. */
  clefs: Clef[];
  /** Drums used, percussion parts only. */
  instruments: PartInstrument[];
  /** Parallel to `Score.measures`. */
  measures: PartMeasure[];
}

export interface NotationTime {
  beats: number;
  beatType: number;
}

/** A metronome mark. `bpm` is always quarter notes; the display may use the meter's beat. */
export interface TempoMark {
  /** Ticks from the start of the measure. */
  offset: number;
  bpm: number;
  beatUnit: NoteType;
  dotted: boolean;
  perMinute: number;
  /** A gradual change starts here; the mark at its end gives the arrival tempo. */
  words?: 'rit.' | 'accel.';
  /** Tempo words printed before the metronome mark: the score's `tempo text:`. */
  text?: string;
  /** The metronome mark itself is not printed, only `text` (its tempo still plays). */
  hideMetronome?: boolean;
}

export interface MeasureInfo {
  /** 1-based. */
  number: number;
  /** Ticks from the start of the score. */
  start: number;
  /** Ticks. */
  length: number;
  time: NotationTime;
  /** First measure, or the meter differs from the previous one. */
  timeChanged: boolean;
  tempos: TempoMark[];
}

export interface Score {
  title?: string;
  composer?: string;
  /** Ticks per quarter note. */
  divisions: number;
  measures: MeasureInfo[];
  parts: Part[];
  /** What could not be written exactly (voices squeezed, rhythms approximated). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Small integer helpers
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function oddPart(n: number): number {
  while (n > 0 && n % 2 === 0) n /= 2;
  return n;
}

/**
 * The tick resolution: the smallest multiple of NOTATE_TICKS on which every
 * time lands. Compiled beats are rounded to 6 decimals, so "lands" allows
 * 2e-6 beats of slack, which is far below any real subdivision.
 */
function pickDivisions(values: number[]): number {
  for (let k = 1; k <= 32; k++) {
    const t = NOTATE_TICKS * k;
    const tolerance = t * 2e-6;
    if (values.every((v) => Math.abs(v * t - Math.round(v * t)) <= tolerance)) return t;
  }
  return NOTATE_TICKS * 2;
}

// ---------------------------------------------------------------------------
// Keys and spelling
// ---------------------------------------------------------------------------

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Semitones from a mode's root down to its relative major. */
const MODE_OFFSETS: [string, number, string][] = [
  ['ionian', 0, 'major'], ['dorian', 2, 'dorian'], ['phrygian', 4, 'phrygian'],
  ['lydian', 5, 'lydian'], ['mixolydian', 7, 'mixolydian'], ['aeolian', 9, 'minor'],
  ['locrian', 11, 'locrian'],
  // Minor's other forms keep the minor signature, the way they are engraved:
  // the raised degrees are accidentals, not part of the key.
  ['harmonic minor', 9, 'minor'], ['melodic minor', 9, 'minor'],
  ['harmonic major', 0, 'major'],
];

/** Each letter's alteration under a key signature. */
function keyAlters(fifths: number): Record<Step, number> {
  const out: Record<Step, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (const s of SHARP_ORDER.slice(0, fifths)) out[s] = 1;
  if (fifths < 0) for (const s of FLAT_ORDER.slice(0, -fifths)) out[s] = -1;
  return out;
}

/** "eb minor" → 6 flats, minor; "c whole tone" → no signature. */
export function keyFromScale(scale: string | undefined): NotationKey {
  const text = String(scale ?? 'c major').trim();
  let info;
  try {
    info = parseScale(text);
  } catch {
    return { fifths: 0, mode: 'none' };
  }
  const shape = info.intervals.join(',');
  const found = MODE_OFFSETS.find(([name]) => SCALES[name].join(',') === shape);
  if (!found) return { fifths: 0, mode: 'none' };
  const [, offset, mode] = found;
  const majorPc = (((info.rootPc - offset) % 12) + 12) % 12;
  const f = (majorPc * 7) % 12; // fifths on the sharp side, 0..11
  const candidates = [f, f - 12].filter((c) => c >= -7 && c <= 7);
  // C# major and Db major are the same pitches; the written root's letter
  // decides ("c# minor" sits on the sharp side, "db major" on the flat one).
  const letter = /^([a-gA-G])/.exec(text)?.[1].toUpperCase() as Step | undefined;
  const fits = candidates.filter((c) => {
    if (!letter) return false;
    const alters = keyAlters(c);
    return (((NATURAL_PC[letter] + alters[letter]) % 12) + 12) % 12 === info.rootPc;
  });
  const pool = fits.length ? fits : candidates;
  const fifths = pool.reduce((best, c) => (Math.abs(c) < Math.abs(best) ? c : best));
  return { fifths, mode };
}

/**
 * The score's `key:`, one entry per measure: the key text where the printed
 * key is set, undefined where it holds. `key: g major` names the opening key;
 * a mapping of bar numbers (`{ 1: db major, 37: e major }`) names changes.
 * Without one, every part opens in its first `scale:` and keeps it: a
 * `scale:` set mid-piece moves the degrees, not the key signature.
 */
function printedKeys(value: unknown, count: number, warn: (message: string) => void): (string | undefined)[] {
  const out: (string | undefined)[] = new Array(count).fill(undefined);
  if (value == null) return out;
  const entries: [string, unknown][] = typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : [['1', value]];
  for (const [bar, raw] of entries) {
    const n = Number(bar);
    const text = String(raw ?? '').trim();
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`key: "${bar}" is not a bar number; write the bars where the key changes, e.g. key: { 1: db major, 37: e major }`);
    }
    try {
      parseScale(text);
    } catch {
      throw new Error(`key: "${text}" is not a key; write it like a scale, e.g. "g major" or "c# minor"`);
    }
    if (n > count) warn(`key: bar ${n} is past the last bar`);
    else out[n - 1] = text;
  }
  return out;
}

/** A spelling for every pitch class under a key: the key's own notes, then the chromatic ones. */
function spellingTable(key: NotationKey, preferFlats: boolean): [Step, number][] {
  const alters = keyAlters(key.fifths);
  const table: ([Step, number] | undefined)[] = new Array(12);
  for (const s of STEPS) table[(((NATURAL_PC[s] + alters[s]) % 12) + 12) % 12] = [s, alters[s]];
  // A minor key's raised 6th and 7th are sharpened letters (G# in A minor,
  // C# and B natural in D minor), whichever side the signature is on, and
  // so is its raised 4th, the leading note of the dominant (D# in A minor,
  // E# in B minor).
  const tonicPc = ((key.fifths * 7) % 12 + 12 + 9) % 12;
  const minorRaised = new Set<Step>();
  if (key.mode === 'minor') {
    const tonic = table[tonicPc]![0];
    const i = STEPS.indexOf(tonic);
    minorRaised.add(STEPS[(i + 3) % 7]);
    minorRaised.add(STEPS[(i + 5) % 7]);
    minorRaised.add(STEPS[(i + 6) % 7]);
  }
  for (let pc = 0; pc < 12; pc++) {
    if (table[pc]) continue;
    const below = table[(pc + 11) % 12];
    const above = table[(pc + 1) % 12];
    const raise: [Step, number] | undefined = below && [below[0], below[1] + 1];
    const lower: [Step, number] | undefined = above && [above[0], above[1] - 1];
    let pick: [Step, number] | undefined;
    if (raise && minorRaised.has(raise[0])) pick = raise;
    else if (raise && raise[1] === 0) pick = raise;
    else if (lower && lower[1] === 0) pick = lower;
    else if (key.fifths > 0) pick = raise;
    else if (key.fifths < 0 || preferFlats) pick = lower;
    // No signature: the usual C major spellings (C# Eb F# G# Bb).
    else pick = pc === 3 || pc === 10 ? lower : raise;
    if (!pick || Math.abs(pick[1]) > 1) pick = pick === raise ? lower ?? raise : raise ?? lower;
    table[pc] = pick;
  }
  return table as [Step, number][];
}

function spell(midi: number, table: [Step, number][]): SpelledPitch {
  return spellAs(midi, table[((midi % 12) + 12) % 12]);
}

/** A MIDI note written with a given letter and alteration: B#3 is MIDI 60. */
function spellAs(midi: number, [step, alter]: [Step, number]): SpelledPitch {
  const natural = midi - alter;
  return { step, alter, octave: Math.floor(natural / 12) - 1 };
}

const pcOf = (midi: number) => ((midi % 12) + 12) % 12;
const flatSide = (scale: string) => /^[a-gA-G]b/.test(scale.trim());

/** What a note named by degree is spelled from, in one bar. */
interface SpellContext {
  /** The scale in force, as a spelling table. */
  table: [Step, number][];
  /** Pitch classes of the scale in force: everything else is chromatic. */
  inScale: Set<number>;
}

/**
 * The scale in force spells the notes; a scale no key signature describes
 * (whole tone, octatonic) leaves that to the printed key.
 */
function spellingContext(scale: string, keyText: string): SpellContext {
  const local = keyFromScale(scale);
  const table = local.mode === 'none'
    ? spellingTable(keyFromScale(keyText), flatSide(keyText))
    : spellingTable(local, flatSide(scale));
  let inScale = new Set<number>();
  try {
    const info = parseScale(scale);
    inScale = new Set(info.intervals.map((i) => pcOf(info.rootPc + i)));
  } catch {
    // An unreadable scale already failed the compile; nothing is diatonic.
  }
  return { table, inScale };
}

/** `pc` written with `letter`, when one sharp or flat at most does it. */
function withLetter(pc: number, letter: Step): [Step, number] | undefined {
  let alter = pcOf(pc - NATURAL_PC[letter]);
  if (alter > 6) alter -= 12;
  return Math.abs(alter) <= 1 ? [letter, alter] : undefined;
}

/**
 * Spell the notes of one voice that the score named by degree; a note named
 * by letter keeps its letter. A note of the scale in force takes the scale's
 * spelling. A chromatic one follows the line. Moving a semitone to the next
 * pitch, it takes the letter beside that note's, so a line rises with sharps
 * and falls with flats (the turn D Eb D C# D, not D D# D C# D). Else, reached
 * by a semitone from the pitch before, it keeps that note's letter where the
 * table would spell it against the line (G G#, not G Ab). Else the table of
 * the scale in force decides.
 */
function spellLine(line: TickNote[], at: (tick: number) => SpellContext): void {
  const onsets: TickNote[][] = [];
  for (const n of line) {
    const last = onsets[onsets.length - 1];
    if (last && last[0].start === n.start) last.push(n);
    else onsets.push([n]);
  }
  const spelled = (n: TickNote): [Step, number] => n.spelling ?? at(n.start).table[pcOf(n.midi)];
  // The nearest pitch other than `n`'s own (a repeated note says nothing),
  // when that onset holds exactly one note a semitone away.
  const neighbour = (n: TickNote, i: number, step: 1 | -1): TickNote | undefined => {
    for (let j = i + step; j >= 0 && j < onsets.length; j += step) {
      const others = onsets[j].filter((m) => m.midi !== n.midi);
      if (!others.length) continue;
      const near = others.filter((m) => Math.abs(m.midi - n.midi) === 1);
      return near.length === 1 ? near[0] : undefined;
    }
    return undefined;
  };
  // Right to left, so the note a chromatic one moves to is already spelled.
  for (let i = onsets.length - 1; i >= 0; i--) {
    for (const n of onsets[i]) {
      if (n.spelling) continue;
      const { table, inScale } = at(n.start);
      const pc = pcOf(n.midi);
      const base = table[pc];
      if (inScale.has(pc)) {
        n.spelling = base;
        continue;
      }
      const next = neighbour(n, i, 1);
      if (next) {
        const [letter] = spelled(next);
        const beside = STEPS[(STEPS.indexOf(letter) + (next.midi > n.midi ? 6 : 1)) % 7];
        // E E#: the same letter, when the one beside would need a double accidental.
        const fit = withLetter(pc, beside) ?? withLetter(pc, letter);
        if (fit) {
          n.spelling = fit;
          continue;
        }
      }
      const prev = neighbour(n, i, -1);
      if (prev && (prev.midi < n.midi ? base[1] < 0 : base[1] > 0)) {
        const fit = withLetter(pc, spelled(prev)[0]);
        if (fit) {
          n.spelling = fit;
          continue;
        }
      }
      n.spelling = base;
    }
  }
}

const ACCIDENTALS: Record<number, Accidental> = { 2: 'double-sharp', 1: 'sharp', 0: 'natural', [-1]: 'flat', [-2]: 'flat-flat' };

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

/**
 * GM key → position on a five-line percussion staff and notehead. The kit
 * follows the common drum-set legend (kick in the bottom space, snare on the
 * third space, hats and cymbals above the staff with x heads); hand
 * percussion spreads over the middle of the staff so a part of two or three
 * of them stays legible.
 */
const DRUM_DISPLAY: Record<number, [Step, number, Notehead]> = {
  35: ['F', 4, 'normal'], 36: ['F', 4, 'normal'],
  37: ['C', 5, 'x'], 38: ['C', 5, 'normal'], 40: ['C', 5, 'normal'], 39: ['D', 5, 'x'],
  41: ['A', 4, 'normal'], 43: ['A', 4, 'normal'], 45: ['B', 4, 'normal'],
  47: ['D', 5, 'normal'], 48: ['E', 5, 'normal'], 50: ['E', 5, 'normal'],
  42: ['G', 5, 'x'], 44: ['D', 4, 'x'], 46: ['G', 5, 'circle-x'],
  49: ['A', 5, 'x'], 57: ['A', 5, 'x'], 52: ['B', 5, 'x'], 55: ['B', 5, 'x'],
  51: ['F', 5, 'x'], 59: ['F', 5, 'x'], 53: ['F', 5, 'diamond'],
  54: ['B', 4, 'x'], 56: ['E', 5, 'triangle'], 58: ['G', 4, 'x'],
  60: ['E', 5, 'normal'], 61: ['D', 5, 'normal'], 62: ['C', 5, 'normal'],
  63: ['B', 4, 'normal'], 64: ['A', 4, 'normal'], 65: ['E', 5, 'normal'], 66: ['C', 5, 'normal'],
  67: ['F', 5, 'triangle'], 68: ['D', 5, 'triangle'], 69: ['E', 5, 'x'], 70: ['G', 5, 'x'],
  71: ['A', 5, 'normal'], 72: ['A', 5, 'normal'], 73: ['G', 4, 'x'], 74: ['G', 4, 'x'],
  75: ['E', 5, 'x'], 76: ['F', 5, 'triangle'], 77: ['D', 5, 'triangle'],
  78: ['C', 5, 'x'], 79: ['C', 5, 'circle-x'], 80: ['A', 5, 'triangle'], 81: ['A', 5, 'triangle'],
  82: ['F', 5, 'x'], 83: ['A', 5, 'x'], 84: ['A', 5, 'x'],
};

/** GM percussion names, for the instrument list a notation program shows. */
const GM_DRUM_NAMES: Record<number, string> = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum', 37: 'Side Stick', 38: 'Snare', 39: 'Hand Clap',
  40: 'Electric Snare', 41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom',
  44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat', 47: 'Low-Mid Tom', 48: 'Hi-Mid Tom',
  49: 'Crash Cymbal', 50: 'High Tom', 51: 'Ride Cymbal', 52: 'Chinese Cymbal', 53: 'Ride Bell',
  54: 'Tambourine', 55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap',
  59: 'Ride Cymbal 2', 60: 'High Bongo', 61: 'Low Bongo', 62: 'Mute High Conga',
  63: 'Open High Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas', 71: 'Short Whistle',
  72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'High Wood Block',
  77: 'Low Wood Block', 78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle',
  81: 'Open Triangle', 82: 'Shaker', 83: 'Jingle Bell', 84: 'Bell Tree',
};

function drumDisplay(key: number): [Step, number, Notehead] {
  return DRUM_DISPLAY[key] ?? ['C', 5, 'normal'];
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/** Samples played from a keyboard (or written like one): they get a grand staff. */
const GRAND_STAFF = /^(piano|epiano|keys|organ|harp|celesta|harpsichord|clavinet|marimba)/i;
const ALTO_CLEF = /^violas?$/i;

/**
 * Which staff of a grand staff a track's name asks for: 0 is the upper staff,
 * 1 the lower. A name matches when it is one of these words, optionally
 * followed by "hand" and a number, with or without a space, `-` or `_`:
 * `rh`, `RH2`, `right hand`, `left-hand`, `upper_1`. A hinted track
 * stays on its staff whatever its range; the staff's clef follows its notes.
 */
const HAND_HINTS: [RegExp, 0 | 1][] = [
  // Organ trios play the second manual with the left hand: `manual2` (and
  // `manual II`) sit on the lower staff, any other manual on the upper.
  [/^manual[\s_-]*(2|ii)$/i, 1],
  [/^(rh|right|upper|treble|manual|soprano|alto|mezzo)([\s_-]*hand)?[\s_-]*\d*$/i, 0],
  [/^(lh|left|lower|bass|tenor)([\s_-]*hand)?[\s_-]*\d*$/i, 1],
];

/**
 * An organ's pedal line is printed on a staff of its own, below the manuals.
 * Sharing the left hand's staff, it lands on deep ledger lines whenever that
 * staff moves to the treble clef.
 */
const PEDAL = /^pedals?[\s_-]*\d*$/i;

/** The staff a track's name asks for, or undefined to split by pitch. */
export function handOf(name: string): 0 | 1 | undefined {
  return HAND_HINTS.find(([re]) => re.test(name.trim()))?.[1];
}

/**
 * Tracks → parts. Every track is its own part, except keyboards: all tracks
 * playing the same keyboard sample (same `sample:`, case aside) are one part
 * on one grand staff, placed where the first of them sits in track order.
 * That is how keyboard music is written in play.yaml, one track per hand or
 * per line, and how it is printed, one instrument. A track named `pedal`
 * stays out of the group and keeps a staff to itself (see `PEDAL`).
 *
 * A piano duet (two players, two pianos' worth of tracks with the same
 * sample) would need a way to say which tracks belong to which player, such
 * as a per-track `part:` name; until then it prints as one crowded piano.
 */
function groupParts(tracks: CompiledTrack[]): number[][] {
  const groups: number[][] = [];
  const bySample = new Map<string, number[]>();
  tracks.forEach((track, i) => {
    if (track.kit == null && GRAND_STAFF.test(track.sample) && !PEDAL.test(track.name.trim())) {
      const key = track.sample.toLowerCase();
      const group = bySample.get(key);
      if (group) {
        group.push(i);
        return;
      }
      bySample.set(key, [i]);
      groups.push(bySample.get(key)!);
      return;
    }
    groups.push([i]);
  });
  return groups;
}

/** "piano" → "Piano", "tubular-bells" → "Tubular Bells". */
function displayName(sample: string): string {
  return sample.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * The instrument a part is named for: its sample's name, except that the
 * electric piano is a piano on the page (a score played on `epiano` reads
 * "Piano", as an edition of it would).
 */
function instrumentName(sample: string): string {
  return /^e?piano$/i.test(sample.trim()) ? 'Piano' : displayName(sample);
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

function parseMeter(meter: string): NotationTime {
  const m = /^(\d+)\/(\d+)$/.exec(meter);
  return m ? { beats: parseInt(m[1], 10), beatType: parseInt(m[2], 10) } : { beats: 4, beatType: 4 };
}

/** Compound meters group their eighths (or quarters) in threes: 6/8, 9/8, 12/8, 6/4. */
function isCompound(time: NotationTime): boolean {
  return time.beats % 3 === 0 && time.beats >= 6 && time.beatType >= 4 ||
    time.beats === 3 && time.beatType >= 8;
}

/**
 * The metric units of a measure, coarsest first, each dividing the one
 * before: bar, half bar (in 4/4, 12/8...), beat, then halves down to the
 * 128th. The note splitter reads them as "how far may a note starting here
 * run before it must show a beat".
 */
function meterLevels(time: NotationTime, length: number, T: number): { levels: number[]; beatLevel: number } {
  const unit = (4 * T) / time.beatType;
  const levels = [length];
  const add = (len: number) => {
    if (len < levels[levels.length - 1] && Number.isInteger(len) && levels[levels.length - 1] % len === 0) levels.push(len);
  };
  if (isCompound(time)) {
    const groups = time.beats / 3;
    if (groups % 2 === 0 && groups >= 4) add(length / 2);
    add(unit * 3);
  } else if (time.beats % 2 === 0 && time.beats >= 4) {
    add(length / 2);
  }
  add(unit);
  const beat = isCompound(time) ? unit * 3 : unit;
  for (let len = unit / 2; len >= T / 32; len /= 2) add(len);
  return { levels, beatLevel: Math.max(0, levels.indexOf(beat)) };
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

interface Value {
  type: NoteType;
  dots: number;
  /** Actual ticks. */
  length: number;
}

/**
 * Every written value (whole to 128th, up to two dots) and its length in
 * actual ticks under an `actual:normal` tuplet ratio, longest first. Values
 * that do not land on a whole tick are left out: they cannot be written in
 * this score's resolution.
 */
function valuesFor(T: number, actual = 1, normal = 1): Value[] {
  const out: Value[] = [];
  for (let k = 0; k < NOTE_TYPES.length; k++) {
    for (let dots = 0; dots <= 2; dots++) {
      // (4T / 2^k) * (2 - 2^-dots) * normal / actual
      const num = 4 * T * normal * (2 ** (dots + 1) - 1);
      const den = actual * 2 ** (k + dots);
      if (num % den === 0) out.push({ type: NOTE_TYPES[k], dots, length: num / den });
    }
  }
  return out.sort((a, b) => b.length - a.length || a.dots - b.dots);
}

interface Context {
  /** Ticks from the measure start. */
  origin: number;
  levels: number[];
  /**
   * The level that is the beat. Inside a beat, a value may run to the
   * beat's end (16th, 8th, 16th is the figure every reader knows); only
   * from the beat upwards must it stop at the next larger unit.
   */
  beatLevel: number;
  values: Value[];
  tuplet?: { actual: number; normal: number; normalType: NoteType };
}

/**
 * Cut [a, b) (relative to the context origin) into written values. A value
 * starting on a unit of some level may run to the end of the enclosing unit
 * one level up, so beats stay visible; within that it takes the longest
 * value that fits.
 */
function splitSpan(a: number, b: number, ctx: Context): { at: number; value: Value }[] {
  const out: { at: number; value: Value }[] = [];
  const { levels, values } = ctx;
  while (a < b) {
    let level = levels.findIndex((len) => a % len === 0);
    if (level === -1) level = levels.length; // finer than any level: run to the finest unit
    const parent = levels[level > ctx.beatLevel ? ctx.beatLevel : Math.max(0, level - 1)];
    const allowedEnd = level === 0 ? levels[0] : (Math.floor(a / parent) + 1) * parent;
    const room = Math.min(b, allowedEnd) - a;
    const value = values.find((v) => v.length <= room);
    if (!value) {
      // Nothing fits on this resolution. Keep the time exact and the picture
      // approximate rather than lose the note.
      out.push({ at: a, value: { type: NOTE_TYPES[NOTE_TYPES.length - 1], dots: 0, length: b - a } });
      break;
    }
    out.push({ at: a, value });
    a += value.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tuplets
// ---------------------------------------------------------------------------

interface Segment {
  from: number;
  to: number;
  midis: number[];
  tieIn: boolean;
  tieOut: boolean;
  roll?: number;
  /** How each of `midis` is spelled, where known. */
  spellings?: Map<number, [Step, number]>;
}

interface TupletGroup {
  start: number;
  end: number;
  actual: number;
  normal: number;
  normalType: NoteType;
}

/**
 * Tuplet brackets for one voice of one measure, from where its notes and
 * rests begin and end. See the file header for the rule.
 */
function findTuplets(
  segments: Segment[],
  levels: number[],
  T: number,
  warn: (message: string) => void,
): TupletGroup[] {
  const regular = (p: number) => (p * 32) % T === 0;
  const length = levels[0];
  const boundaries = new Set<number>();
  for (const s of segments) {
    boundaries.add(s.from);
    boundaries.add(s.to);
  }
  const irregular = [...boundaries].filter((p) => p > 0 && p < length && !regular(p)).sort((x, y) => x - y);
  let groups: TupletGroup[] = [];
  for (const p of irregular) {
    if (groups.some((g) => p > g.start && p < g.end)) continue;
    let placed = false;
    for (let i = levels.length - 1; i >= 0 && !placed; i--) {
      const len = levels[i];
      const start = Math.floor(p / len) * len;
      const end = start + len;
      if (end > length) continue;
      if (groups.some((g) => g.start < end && g.end > start && !(g.start >= start && g.end <= end))) continue;
      // Every note or rest that starts or ends off the grid inside this
      // unit must lie wholly within it, or the bracket would cut it.
      const contained = segments.every((s) => {
        const offInside = [s.from, s.to].some((q) => q > start && q < end && !regular(q));
        return !offInside || (s.from >= start && s.to <= end);
      });
      if (!contained) continue;
      let g = len;
      for (const q of boundaries) if (q > start && q < end) g = gcd(g, q - start);
      const d = len / g;
      const actual = oddPart(d);
      if (actual < 3 || d / actual > 16) continue;
      // `normal` notes of a plain value must fill the unit exactly:
      // 3 in 2 eighths over a beat, 5 in 4 sixteenths, 5 in 6 sixteenths
      // over a dotted quarter.
      let best: { normal: number; k: number } | undefined;
      for (let k = 0; k < NOTE_TYPES.length; k++) {
        const normal = (len * 2 ** k) / (4 * T);
        if (Number.isInteger(normal) && normal < actual && (!best || normal > best.normal)) best = { normal, k };
      }
      if (!best) continue;
      groups = groups.filter((gr) => !(gr.start >= start && gr.end <= end));
      groups.push({ start, end, actual, normal: best.normal, normalType: NOTE_TYPES[best.k] });
      placed = true;
    }
    if (!placed) warn('a rhythm too irregular to bracket; its values are approximate');
  }
  return groups.sort((x, y) => x.start - y.start);
}

// ---------------------------------------------------------------------------
// Building a voice-measure
// ---------------------------------------------------------------------------

function buildVoiceEvents(
  segments: Segment[],
  length: number,
  { levels, beatLevel }: { levels: number[]; beatLevel: number },
  time: NotationTime,
  T: number,
  warn: (message: string) => void,
): NotationEvent[] {
  // Gaps are rests.
  const all: Segment[] = [];
  let cursor = 0;
  for (const s of segments) {
    if (s.from > cursor) all.push({ from: cursor, to: s.from, midis: [], tieIn: false, tieOut: false });
    all.push(s);
    cursor = s.to;
  }
  if (cursor < length) all.push({ from: cursor, to: length, midis: [], tieIn: false, tieOut: false });

  const groups = findTuplets(all, levels, T, warn);
  const plain: Context = { origin: 0, levels, beatLevel, values: valuesFor(T) };
  const contexts = new Map<TupletGroup, Context>();
  for (const g of groups) {
    const len = g.end - g.start;
    const unit = len / g.actual;
    const inner = [len];
    if (Number.isInteger(unit)) for (let u = unit; Number.isInteger(u) && u >= 1; u /= 2) inner.push(u);
    contexts.set(g, {
      origin: g.start,
      levels: inner,
      beatLevel: 0,
      values: valuesFor(T, g.actual, g.normal),
      tuplet: { actual: g.actual, normal: g.normal, normalType: g.normalType },
    });
  }

  const events: NotationEvent[] = [];
  for (const seg of all) {
    // Cut at tuplet bracket edges: a value is either inside a bracket or not.
    const cuts = [seg.from, seg.to];
    for (const g of groups) {
      if (g.start > seg.from && g.start < seg.to) cuts.push(g.start);
      if (g.end > seg.from && g.end < seg.to) cuts.push(g.end);
    }
    cuts.sort((x, y) => x - y);
    const pieces: { at: number; value: Value; ctx: Context }[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const group = groups.find((g) => cuts[i] >= g.start && cuts[i + 1] <= g.end);
      const ctx = group ? contexts.get(group)! : plain;
      for (const piece of splitSpan(cuts[i] - ctx.origin, cuts[i + 1] - ctx.origin, ctx)) {
        pieces.push({ at: piece.at + ctx.origin, value: piece.value, ctx });
      }
    }
    const isNote = seg.midis.length > 0;
    pieces.forEach((piece, i) => {
      const event: NotationEvent = {
        kind: isNote ? 'note' : 'rest',
        offset: piece.at,
        duration: piece.value.length,
        type: piece.value.type,
        dots: piece.value.dots,
        notes: seg.midis.map((midi) => {
          const spelling = seg.spellings?.get(midi);
          return spelling ? { midi, pitch: spellAs(midi, spelling) } : { midi };
        }),
      };
      if (isNote) {
        if (i > 0 || seg.tieIn) event.tieStop = true;
        if (i < pieces.length - 1 || seg.tieOut) event.tieStart = true;
        if (seg.roll) event.tremolo = Math.min(4, 2 + seg.roll);
      }
      if (piece.ctx.tuplet) event.tuplet = { ...piece.ctx.tuplet };
      events.push(event);
    });
  }

  // Bracket ends: the first and last value inside each group.
  for (const g of groups) {
    const inside = events.filter((e) => e.offset >= g.start && e.offset < g.end);
    if (inside.length) {
      inside[0].tuplet!.start = true;
      inside[inside.length - 1].tuplet!.stop = true;
    }
  }
  beamVoice(events, beamGroups(time, length, T, groups), time, T);
  return events;
}

// ---------------------------------------------------------------------------
// Beams
// ---------------------------------------------------------------------------

/** How many beams a written value carries: eighth 1, 16th 2, 32nd 3... */
function beamCount(type: NoteType | undefined): number {
  const index = type ? NOTE_TYPES.indexOf(type) : -1;
  return index >= 3 ? index - 2 : 0;
}

/**
 * Where beams may run in a measure, as [start, end) spans in ticks. Beams
 * show the beat: a quarter in simple meters (also in 2/2, where 16ths still
 * group by quarters), a dotted quarter in 6/8, 9/8 and 12/8, and the usual
 * 3+2 and 2+2+3 eighths in 5/8 and 7/8. A tuplet is its own span, so its
 * bracket and its beam agree.
 */
function beamGroups(time: NotationTime, length: number, T: number, tuplets: TupletGroup[]): [number, number][] {
  const eighth = T / 2;
  let sizes: number[];
  if (isCompound(time) && time.beatType === 8) {
    sizes = [3 * eighth];
  } else if (time.beatType === 8) {
    const n = time.beats;
    const counts = n === 5 ? [3, 2] : n === 7 ? [2, 2, 3] : n % 2 === 0 ? Array(n / 2).fill(2)
      : [...Array((n - 3) / 2).fill(2), 3];
    sizes = counts.map((c) => c * eighth);
  } else {
    sizes = [T];
  }
  const base: [number, number][] = [];
  for (let at = 0, i = 0; at < length; i++) {
    const size = sizes[Math.min(i, sizes.length - 1)] ?? T;
    base.push([at, Math.min(length, at + size)]);
    at += size;
  }
  // Tuplet spans replace whatever base spans they cover.
  const out: [number, number][] = [];
  for (const [s0, e0] of base) {
    let cursor = s0;
    for (const g of tuplets) {
      if (g.end <= cursor || g.start >= e0) continue;
      if (g.start > cursor) out.push([cursor, g.start]);
      cursor = Math.max(cursor, g.end);
    }
    if (cursor < e0) out.push([cursor, e0]);
  }
  for (const g of tuplets) out.push([g.start, g.end]);
  const unique = new Map(out.map((span) => [`${span[0]}:${span[1]}`, span]));
  return [...unique.values()].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}

/**
 * Beam a voice of one measure. Notes shorter than a quarter that fall in
 * the same beam span are joined; a rest or a longer note breaks the run, and
 * a run of one keeps its flag. In 4/4 and in half-note meters, a half bar of
 * nothing but plain eighths is beamed as one group of four, as engravers do.
 */
function beamVoice(events: NotationEvent[], spans: [number, number][], time: NotationTime, T: number): void {
  const beamable = (e: NotationEvent) => e.kind === 'note' && beamCount(e.type) > 0;
  const runs: NotationEvent[][] = [];
  const used = new Set<NotationEvent>();
  const halfBars = time.beatType === 2 || (time.beats === 4 && time.beatType === 4);
  if (halfBars) {
    const length = events.reduce((sum, e) => sum + e.duration, 0);
    for (let h = 0; h + 2 * T <= length; h += 2 * T) {
      const inside = events.filter((e) => e.offset >= h && e.offset < h + 2 * T);
      const plainEighths = inside.length === 4 && inside.every((e) =>
        e.kind === 'note' && e.type === 'eighth' && e.dots === 0 && !e.tuplet && e.duration === T / 2);
      if (plainEighths) {
        runs.push(inside);
        inside.forEach((e) => used.add(e));
      }
    }
  }
  for (const [start, end] of spans) {
    let run: NotationEvent[] = [];
    for (const e of events) {
      if (e.offset < start || e.offset >= end || used.has(e)) continue;
      if (beamable(e) && e.offset + e.duration <= end) {
        run.push(e);
        used.add(e);
      } else {
        runs.push(run);
        run = [];
      }
    }
    runs.push(run);
  }
  for (const run of runs) {
    if (run.length < 2) continue;
    const depth = Math.max(...run.map((e) => beamCount(e.type)));
    for (const e of run) e.beams = [];
    for (let level = 1; level <= depth; level++) {
      for (let i = 0; i < run.length; i++) {
        const e = run[i];
        if (beamCount(e.type) < level) continue;
        const prev = i > 0 && beamCount(run[i - 1].type) >= level;
        const next = i < run.length - 1 && beamCount(run[i + 1].type) >= level;
        let value: BeamValue;
        if (prev && next) value = 'continue';
        else if (next) value = 'begin';
        else if (prev) value = 'end';
        // A lone shorter value hooks toward the note it shares its half of
        // the beat with: a dotted eighth and 16th hooks back, a 16th and
        // dotted eighth hooks forward.
        else if (i === 0) value = 'forward hook';
        else if (i === run.length - 1) value = 'backward hook';
        else value = (e.offset - run[0].offset) % (2 * e.duration) === 0 ? 'forward hook' : 'backward hook';
        e.beams![level - 1] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

interface TickNote {
  start: number;
  end: number;
  midi: number;
  roll?: number;
  /** Letter and alteration: as written for a note named by letter, else from `spellLine`. */
  spelling?: [Step, number];
}

/** A note handed to separateVoices, carrying what it needs back. */
type VoiceNote = NotateNote & { roll?: number; id: number };

/**
 * Move every chord into the lowest-numbered voice that is free for its whole
 * span. `separateVoices` keeps a line in the voice that matches its register
 * for the whole piece, which is right while the lines overlap; once they stop,
 * a lone lower line would stay in voice 2 under a bar of empty voice 1. On
 * the page, voice 1 is the music and higher voices exist only where the
 * music actually splits.
 */
function compactVoices(voices: TickNote[][]): TickNote[][] {
  const out: TickNote[][] = voices.map(() => []);
  const chords = voices.flatMap((voice, vi) => {
    const groups = new Map<string, TickNote[]>();
    for (const n of voice) {
      const key = `${n.start}:${n.end}`;
      const g = groups.get(key);
      if (g) g.push(n);
      else groups.set(key, [n]);
    }
    return [...groups.values()].map((notes) => ({ vi, notes }));
  }).sort((a, b) => a.notes[0].start - b.notes[0].start || a.vi - b.vi);
  for (const { vi, notes } of chords) {
    const { start, end } = notes[0];
    // A voice is free when nothing in it overlaps, or what does is this very
    // chord's span (a chord split by register across voices joins up again).
    const free = (v: TickNote[]) => v.every((n) => n.end <= start || n.start >= end || (n.start === start && n.end === end));
    // Its own voice can be taken by a chord moved down earlier; then any free
    // voice will do, and only when none is free does the original separation
    // stand, rather than a voice that overlaps itself.
    let target = out.findIndex((v, i) => i <= vi && free(v));
    if (target === -1) target = out.findIndex(free);
    if (target === -1) return voices;
    out[target].push(...notes);
  }
  return out.filter((v) => v.length).map((v) => v.sort((a, b) => a.start - b.start || a.midi - b.midi));
}

/**
 * Build the notation model of a score. Pure: compiles the document in
 * written mode and lays every track out as one part.
 */
export function scoreFromDoc(doc: SongDoc): Score {
  const song = compileDoc(doc, { written: true });
  return scoreFromWritten(song, doc);
}

function scoreFromWritten(song: CompiledSong, doc: SongDoc): Score {
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  // ── Resolution ──
  const values: number[] = [];
  for (const t of song.tracks) {
    for (const e of t.timeline) values.push(e.time, e.time + e.duration);
    for (const b of t.bars ?? []) values.push(b.start, b.beats);
  }
  for (const t of song.tempoMap) values.push(t.time, t.time + t.rampBeats);
  const T = pickDivisions(values);
  const tick = (beats: number) => Math.round(beats * T);

  // ── The measure grid: the track whose bars reach furthest ──
  const master = song.tracks.reduce<CompiledTrack | undefined>((best, t) => {
    const end = (x?: CompiledTrack) => {
      const bars = x?.bars ?? [];
      return bars.length ? bars[bars.length - 1].start + bars[bars.length - 1].beats : -1;
    };
    return end(t) > end(best) ? t : best;
  }, undefined);
  const grid: BarInfo[] = [...(master?.bars ?? [])];
  if (!grid.length) grid.push({ start: 0, beats: song.measureBeats, meter: `${Math.round(song.measureBeats)}/4`, scale: 'c major' });
  // A note held past the last bar line still needs bars to sit in.
  const lastEnd = Math.max(0, ...song.tracks.flatMap((t) => t.timeline.map((e) => tick(e.time + e.duration))));
  while (tick(grid[grid.length - 1].start + grid[grid.length - 1].beats) < lastEnd) {
    const last = grid[grid.length - 1];
    grid.push({ ...last, start: last.start + last.beats });
  }
  for (const t of song.tracks) {
    const bars = t.bars ?? [];
    if (bars.some((b, i) => !grid[i] || tick(b.start) !== tick(grid[i].start) || tick(b.beats) !== tick(grid[i].beats))) {
      warn(`${t.name}: its bar lines disagree with the score's; written on the score's bars`);
    }
  }

  const measures: MeasureInfo[] = grid.map((b, i) => {
    const time = parseMeter(b.meter);
    const prev = i > 0 ? parseMeter(grid[i - 1].meter) : undefined;
    return {
      number: i + 1,
      start: tick(b.start),
      length: tick(b.beats),
      time,
      timeChanged: !prev || prev.beats !== time.beats || prev.beatType !== time.beatType,
      tempos: [],
    };
  });
  placeTempos(song, measures, tick, tempoPrint(doc));

  const measureAt = (t: number): number => {
    let lo = 0;
    for (let i = 0; i < measures.length; i++) if (measures[i].start <= t) lo = i;
    return lo;
  };

  // ── Parts ──
  const rootTrack = doc && doc.play != null ? song.tracks[0] : undefined;
  const keys = printedKeys(doc?.key, measures.length, warn);
  const env: PartEnv = { measures, T, tick, warn, measureAt, keys };
  const parts = groupParts(song.tracks).map((indices, index) => {
    const tracks = indices.map((i) => song.tracks[i]);
    // One track keeps its own name (the instrument's, for the document's
    // own `play:`); several are named for the parent they share, or else
    // for the instrument.
    const parents = new Set(tracks.map((t) => t.parent));
    const name = tracks.length === 1
      ? (tracks[0] === rootTrack ? instrumentName(tracks[0].sample) : tracks[0].name)
      : parents.size === 1 && tracks[0].parent !== undefined ? tracks[0].parent : instrumentName(tracks[0].sample);
    return buildPart(tracks, indices, index, name, env);
  });

  const composer: unknown = doc?.composer;
  return {
    title: song.title,
    composer: typeof composer === 'string' ? composer : undefined,
    divisions: T,
    measures,
    parts,
    warnings,
  };
}

/**
 * Notes of a keyboard part → [upper staff, lower staff]. Chords stay on one
 * staff, the one their middle falls on, with some stickiness around middle C
 * so a line wandering over it does not jump staves on every note. A chord
 * wider than one hand's reach is split at middle C, the way it is played.
 */
function splitGrandStaff(notes: TickNote[]): TickNote[][] {
  const byStaff: TickNote[][] = [[], []];
  const chords = new Map<string, TickNote[]>();
  for (const n of notes) {
    const k = `${n.start}:${n.end}`;
    const c = chords.get(k);
    if (c) c.push(n);
    else chords.set(k, [n]);
  }
  let last = 0;
  for (const chord of chords.values()) {
    const lo = Math.min(...chord.map((n) => n.midi));
    const hi = Math.max(...chord.map((n) => n.midi));
    if (hi - lo > 14 && lo < 60 && hi >= 60) {
      for (const n of chord) byStaff[n.midi >= 60 ? 0 : 1].push(n);
      continue;
    }
    const mean = chord.reduce((sum, n) => sum + n.midi, 0) / chord.length;
    // Clearly high or low goes where it belongs; between G3 and E4 the
    // chord stays on the staff the previous one used.
    const staff = mean >= 64 ? 0 : mean < 55 ? 1 : last;
    byStaff[staff].push(...chord);
    last = staff;
  }
  return byStaff;
}

/**
 * Decide the accidentals of one staff of one measure, its notes spelled by
 * `spellLine` (the table is a fallback). An accidental holds for the rest of
 * the bar on its line, across the staff's voices; a note tied over the bar
 * line carries its accidental with it and prints none.
 */
function spellStaff(voices: NotationVoice[], key: NotationKey, table: [Step, number][]): void {
  const alters = keyAlters(key.fifths);
  const state = new Map<string, number>();
  const events = voices.flatMap((v) => v.events)
    .filter((e) => e.kind === 'note')
    .sort((a, b) => a.offset - b.offset);
  for (const e of events) {
    for (const n of e.notes) {
      const pitch: SpelledPitch = n.pitch ? { step: n.pitch.step, alter: n.pitch.alter, octave: n.pitch.octave } : spell(n.midi, table);
      const line = `${pitch.step}${pitch.octave}`;
      const current = state.get(line) ?? alters[pitch.step];
      if ((!e.tieStop || e.offset > 0) && pitch.alter !== current) {
        pitch.accidental = ACCIDENTALS[pitch.alter];
        state.set(line, pitch.alter);
      }
      n.pitch = pitch;
    }
  }
}

const TREBLE: Clef = { sign: 'G', line: 2 };
const BASS: Clef = { sign: 'F', line: 4 };

/**
 * The clef of one grand-staff staff, measure by measure. Each measure votes
 * by the mean pitch of the notes it starts: treble from E-flat 4 up, bass from
 * G-sharp 3 down, and in between the clef in force stays (hysteresis, so a
 * line hovering around middle C does not flip). A vote that holds for a
 * single measure is ignored, and so are measures with no notes: a clef change
 * is worth printing only when the music settles in the new register.
 */
function clefPlan(notes: TickNote[], measures: MeasureInfo[], home: 'G' | 'F'): Clef[] {
  const means = measures.map((m) => {
    const inBar = notes.filter((n) => n.start >= m.start && n.start < m.start + m.length);
    return inBar.length ? inBar.reduce((sum, n) => sum + n.midi, 0) / inBar.length : undefined;
  });
  const vote: ('G' | 'F' | undefined)[] = means.map((mean) =>
    mean === undefined ? undefined : mean >= 63 ? 'G' : mean <= 56 ? 'F' : undefined);
  const first = vote.find((v) => v !== undefined) ?? home;
  const plan: ('G' | 'F')[] = [];
  let current: 'G' | 'F' = first;
  for (let i = 0; i < measures.length; i++) {
    const v = vote[i];
    if (v && v !== current) {
      // Settled means the next measure with notes does not vote back.
      const next = vote.slice(i + 1).find((x, k) => x !== undefined || means[i + 1 + k] !== undefined);
      if (next !== (v === 'G' ? 'F' : 'G')) current = v;
    }
    plan.push(current);
  }
  return plan.map((sign) => (sign === 'G' ? TREBLE : BASS));
}

/** What every part is laid out against. */
interface PartEnv {
  measures: MeasureInfo[];
  /** Ticks per quarter. */
  T: number;
  tick: (beats: number) => number;
  warn: (message: string) => void;
  /** Index of the measure holding a tick. */
  measureAt: (t: number) => number;
  /** The score's `key:`, per measure (see `printedKeys`). */
  keys: (string | undefined)[];
}

/**
 * Voice numbers for one staff in one measure: slot k is voice k + 1 and
 * holds the index of a line (or undefined). The lines sounding in the bar
 * are numbered by pitch, highest first, so the upper line is voice 1 with
 * its stems up and the lower one voice 2 with stems down, whichever entered
 * first. A line tied in over the bar line keeps the number it had. Slot 0
 * always exists: a bar where nothing sounds is a rest in voice 1.
 */
function voiceSlots(inBars: TickNote[][], m0: number, last: Map<number, number>): (number | undefined)[] {
  const mean = (notes: TickNote[]) => notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
  const present = inBars.map((_, i) => i).filter((i) => inBars[i].length > 0)
    .sort((a, b) => mean(inBars[b]) - mean(inBars[a]) || a - b);
  const slots: (number | undefined)[] = [];
  const placed = new Set<number>();
  for (const i of present) {
    const slot = last.get(i);
    if (slot !== undefined && slots[slot] === undefined && inBars[i].some((n) => n.start < m0)) {
      slots[slot] = i;
      placed.add(i);
    }
  }
  for (const i of present) {
    if (placed.has(i)) continue;
    let slot = 0;
    while (slots[slot] !== undefined) slot++;
    slots[slot] = i;
  }
  if (slots.length === 0) slots.push(0);
  return Array.from(slots);
}

/** One or more compiled tracks → one part: staves, voices, measures, spelling. */
function buildPart(tracks: CompiledTrack[], indices: number[], index: number, name: string, env: PartEnv): Part {
  const { measures, T, tick, warn, measureAt, keys } = env;
  const first = tracks[0];
  const id = `P${index + 1}`;
  const percussion = first.kit != null;
  const grand = !percussion && GRAND_STAFF.test(first.sample) && !PEDAL.test(first.name.trim());
  const label = tracks.length === 1 ? first.name : name;
  const partWarn = (bar: number, message: string) => warn(`${label}: bar ${bar + 1}: ${message}`);

  // Notes in ticks, pooled across the part's tracks. One key cannot be
  // struck twice at once: the same pitch starting at the same tick is one
  // note, as long as the longest of them, kept by the first track in order
  // (and so on that track's staff). Written as two, they would be two voices
  // sharing a notehead, each padded with rests that collide.
  const struck = new Map<string, TickNote>();
  const hinted: TickNote[][] = [[], []];
  const unhinted: TickNote[] = [];
  for (const track of tracks) {
    const hand = grand ? handOf(track.name) : undefined;
    for (const e of track.timeline) {
      const start = tick(e.time);
      const end = tick(e.time + e.duration);
      if (end <= start) continue;
      const key = `${start}:${e.midi}`;
      const already = struck.get(key);
      if (already) {
        already.end = Math.max(already.end, end);
        continue;
      }
      const note: TickNote = { start, end, midi: e.midi, roll: e.roll };
      if (e.spelling) note.spelling = [e.spelling.letter as Step, e.spelling.alter];
      struck.set(key, note);
      (hand === undefined ? unhinted : hinted[hand]).push(note);
    }
  }
  const byNote = (a: TickNote, b: TickNote) => a.start - b.start || a.midi - b.midi;
  unhinted.sort(byNote);

  // ── Staves ──
  const staves = grand ? 2 : 1;
  let byStaff: TickNote[][];
  if (grand) {
    const split = splitGrandStaff(unhinted);
    byStaff = [[...hinted[0], ...split[0]].sort(byNote), [...hinted[1], ...split[1]].sort(byNote)];
  } else {
    byStaff = [unhinted];
  }
  const notes = byStaff.flat();

  // ── Clefs ──
  // A grand staff's clefs follow the notes measure by measure (see
  // `clefPlan`): a left hand written high reads in treble on the lower
  // staff. Other parts keep one clef, from their whole range.
  const meanOf = (list: TickNote[], fallback: number) =>
    list.length ? list.reduce((sum, n) => sum + n.midi, 0) / list.length : fallback;
  const clefs: Clef[] = [];
  const plans = grand ? [clefPlan(byStaff[0], measures, 'G'), clefPlan(byStaff[1], measures, 'F')] : [];
  if (percussion) clefs.push({ sign: 'percussion', line: 2 });
  else if (grand) {
    clefs.push(plans[0][0], plans[1][0]);
  } else {
    const mean = meanOf(notes, 67);
    if (ALTO_CLEF.test(first.sample) && mean >= 50 && mean < 70) clefs.push({ sign: 'C', line: 3 });
    else if (mean < 55) clefs.push({ sign: 'F', line: 4 });
    else clefs.push({ sign: 'G', line: 2 });
  }

  // ── Voices per staff ──
  const voicesByStaff: TickNote[][][] = [];
  for (let s = 0; s < staves; s++) {
    const input: VoiceNote[] = byStaff[s].map((n, id) => ({ start: n.start, duration: n.end - n.start, midi: n.midi, roll: n.roll, id }));
    const separated = separateVoices(input, { maxVoices: 4 }) as VoiceNote[][];
    voicesByStaff.push(compactVoices(separated.map((voice) => {
      const out: TickNote[] = [];
      for (const n of voice) {
        const original = input[n.id];
        if (n.duration < original.duration) {
          partWarn(measureAt(n.start), 'more than four voices on a staff; a held note is cut short');
        }
        if (n.duration <= 0) continue;
        out.push({ start: n.start, end: n.start + n.duration, midi: n.midi, roll: n.roll, spelling: byStaff[s][n.id].spelling });
      }
      return out;
    })));
  }

  // ── Keys and spelling ──
  // The printed key, per measure: the score's `key:` where it says, else the
  // part's opening `scale:`, held to the end. The scale in force, which may
  // change every bar, is what a note named by degree is spelled from.
  const printed: string[] = [];
  const contexts: SpellContext[] = [];
  {
    const scaleAt = (mi: number) => tracks.map((t) => t.bars?.[mi]?.scale).find((x) => x !== undefined);
    let keyText = keys[0] ?? scaleAt(0) ?? 'c major';
    let scale = scaleAt(0) ?? 'c major';
    const cache = new Map<string, SpellContext>();
    measures.forEach((_, mi) => {
      keyText = keys[mi] ?? keyText;
      scale = scaleAt(mi) ?? scale;
      printed.push(keyText);
      const id = `${scale}|${keyText}`;
      if (!cache.has(id)) cache.set(id, spellingContext(scale, keyText));
      contexts.push(cache.get(id)!);
    });
  }
  if (!percussion) {
    for (const staff of voicesByStaff) for (const line of staff) spellLine(line, (t) => contexts[measureAt(t)]);
  }

  // ── Measures ──
  const instruments = new Map<number, PartInstrument>();
  let lastKey: NotationKey | undefined;
  // Which voice number each line of a staff had in the previous measure, so
  // a line tied over the bar line keeps it (the tie joins two notes of one voice).
  const lastSlot: Map<number, number>[] = Array.from({ length: staves }, () => new Map());
  const partMeasures: PartMeasure[] = measures.map((measure, mi) => {
    const m0 = measure.start;
    const m1 = m0 + measure.length;
    const levels = meterLevels(measure.time, measure.length, T);
    const voices: NotationVoice[] = [];
    for (let s = 0; s < staves; s++) {
      const lines = voicesByStaff[s].length ? voicesByStaff[s] : [[]];
      const inBars = lines.map((line) => line.filter((n) => n.start < m1 && n.end > m0));
      const slots = percussion
        ? lines.map((_, i) => (i === 0 || inBars[i].length ? i : undefined))
        : voiceSlots(inBars, m0, lastSlot[s]);
      lastSlot[s] = new Map(slots.flatMap((line, slot) => (line === undefined ? [] : [[line, slot] as [number, number]])));
      slots.forEach((line, vi) => {
        if (line === undefined && vi > 0) return;
        const voice: NotationVoice = { voice: s * 4 + vi + 1, staff: s + 1, events: [] };
        const inBar = line === undefined ? [] : inBars[line];
        if (inBar.length === 0) {
          // Voice 1 with nothing to play: a whole-bar rest, printed only
          // when no other voice of the staff sounds.
          const othersSound = inBars.some((notes) => notes.length > 0);
          voice.events.push({
            kind: 'rest', offset: 0, duration: measure.length, dots: 0, measureRest: true, notes: [],
            ...(othersSound ? { hidden: true } : {}),
          });
        } else {
          // Chords: one segment per onset (a voice never overlaps itself).
          const segments: Segment[] = [];
          for (const n of inBar) {
            const from = Math.max(n.start, m0) - m0;
            const last = segments[segments.length - 1];
            if (last && last.from === from) {
              last.midis.push(n.midi);
              if (n.spelling) last.spellings!.set(n.midi, n.spelling);
              continue;
            }
            segments.push({
              from,
              to: Math.min(n.end, m1) - m0,
              midis: [n.midi],
              tieIn: n.start < m0,
              tieOut: n.end > m1,
              roll: n.roll,
              spellings: new Map(n.spelling ? [[n.midi, n.spelling]] : []),
            });
          }
          for (const seg of segments) seg.midis.sort((a, b) => a - b);
          voice.events = buildVoiceEvents(segments, measure.length, levels, measure.time, T, (msg) => partWarn(mi, msg));
          // A lower voice's rests print where it is a line of its own in
          // this bar, sounding through most of it (a tenor entering after a
          // 16th rest). Where it splits off for a few notes, they are padding
          // and stay hidden.
          const sounding = voice.events.reduce((sum, e) => sum + (e.kind === 'note' ? e.duration : 0), 0);
          if (vi > 0 && sounding * 2 <= measure.length) for (const e of voice.events) if (e.kind === 'rest') e.hidden = true;
        }
        voices.push(voice);
      });
    }

    // ── Key, spelling, accidentals ──
    // With no `key:`, the opening key comes from the first track's scale;
    // the others should agree, and a part that disagrees with itself is
    // worth a warning.
    const scales = [...new Set(tracks.map((t) => t.bars?.[mi]?.scale).filter((x): x is string => x !== undefined))];
    if (mi === 0 && !keys[0] && scales.length > 1 && keyFromScale(scales[0]).fifths !== keyFromScale(scales[1]).fifths) {
      partWarn(mi, `its tracks are in different keys (${scales.join(', ')}); written in ${scales[0]}`);
    }
    const key = percussion ? { fifths: 0, mode: 'none' } : keyFromScale(printed[mi]);
    const pm: PartMeasure = { voices };
    if (!percussion) {
      for (let st = 1; st <= staves; st++) {
        const onStaff = voices.filter((v) => v.staff === st && v.events.some((e) => e.kind === 'note'));
        if (onStaff.length < 2) continue;
        onStaff.forEach((v, i) => {
          for (const e of v.events) if (e.kind === 'note') e.stem = i === 0 ? 'up' : 'down';
        });
      }
    }
    if (mi > 0 && plans.some((plan) => plan[mi] !== plan[mi - 1])) {
      pm.clefs = plans.map((plan) => (plan[mi] !== plan[mi - 1] ? plan[mi] : undefined));
    }
    if (!lastKey || lastKey.fifths !== key.fifths || lastKey.mode !== key.mode) pm.key = key;
    lastKey = key;

    if (percussion) {
      for (const v of voices) for (const e of v.events) for (const n of e.notes) {
        const [step, octave, notehead] = drumDisplay(n.midi);
        const instrumentId = `${id}-I${n.midi}`;
        if (!instruments.has(n.midi)) {
          instruments.set(n.midi, { id: instrumentId, key: n.midi, name: GM_DRUM_NAMES[n.midi] ?? drumName(n.midi) ?? `Drum ${n.midi}` });
        }
        n.drum = { step, octave, notehead, instrument: instrumentId };
      }
      for (const v of voices) for (const e of v.events) if (e.kind === 'note') e.stem = v.voice === 1 ? 'up' : 'down';
    } else {
      for (let st = 1; st <= staves; st++) spellStaff(voices.filter((v) => v.staff === st), key, contexts[mi].table);
    }
    return pm;
  });

  return {
    id,
    name,
    tracks: indices,
    sample: first.sample,
    kit: first.kit,
    channel: first.channel,
    program: first.program,
    percussion,
    staves,
    clefs,
    instruments: [...instruments.values()].sort((a, b) => a.key - b.key),
    measures: partMeasures,
  };
}

const METRONOME_MARKS: readonly MetronomeMarks[] = ['all', 'opening', 'none'];

/**
 * How the score asks its tempo to be printed: `tempo text:` (words over the
 * first bar, "Andante semplice") and `metronome marks:`. Playback ignores
 * both: a rit. written for the performance can stay off the page.
 */
function tempoPrint(doc: SongDoc | undefined): { text?: string; marks: MetronomeMarks } {
  const raw = doc?.['metronome marks'];
  const marks = raw == null ? 'all' : String(raw).trim().toLowerCase() as MetronomeMarks;
  if (!METRONOME_MARKS.includes(marks)) {
    throw new Error(`metronome marks: "${raw}" is not one of ${METRONOME_MARKS.join(', ')}`);
  }
  const text = doc?.['tempo text'] == null ? '' : String(doc['tempo text']).trim();
  return { text: text || undefined, marks };
}

/**
 * Metronome marks: the opening tempo, then one wherever it changes. A
 * gradual change (rit., accel.) is marked in words where it starts and with
 * the tempo it arrives at where it ends. The mark counts the meter's beat,
 * a dotted quarter in 6/8, though `bpm` stays in quarters for playback.
 * `metronome marks: opening` keeps only the first, `none` not even that, and
 * a `tempo text:` goes over the first bar, beside its mark or alone.
 */
function placeTempos(
  song: CompiledSong,
  measures: MeasureInfo[],
  tick: (b: number) => number,
  print: { text?: string; marks: MetronomeMarks },
): void {
  type Mark = { at: number; bpm: number; words?: 'rit.' | 'accel.' };
  const marks: Mark[] = [];
  const events: TempoEvent[] = song.tempoMap;
  if (!events.some((e) => tick(e.time) === 0)) marks.push({ at: 0, bpm: song.bpm });
  let running = song.bpm;
  for (const e of events) {
    if (e.rampBeats > 0) {
      marks.push({ at: tick(e.time), bpm: running, words: e.bpm < running ? 'rit.' : 'accel.' });
      marks.push({ at: tick(e.time + e.rampBeats), bpm: e.bpm });
    } else {
      marks.push({ at: tick(e.time), bpm: e.bpm });
    }
    running = e.bpm;
  }
  // At one tick, the last metronome mark wins and so does the last word; a
  // ramp arriving where the next one leaves keeps both.
  const kept = new Map<string, Mark>();
  for (const m of marks) kept.set(`${m.at}:${m.words ? 'w' : 'm'}`, m);
  const ordered = [...kept.values()].sort((a, b) => a.at - b.at || (a.words ? 1 : 0) - (b.words ? 1 : 0));
  let shown: number | undefined;
  for (const m of ordered) {
    // A mark repeating the tempo already on the page says nothing.
    if (!m.words && shown !== undefined && Math.abs(shown - m.bpm) < 1e-6) continue;
    const index = measures.reduce((found, ms, i) => (ms.start <= m.at ? i : found), 0);
    const measure = measures[index];
    if (m.at >= measure.start + measure.length) continue; // past the last bar
    let { beatUnit, dotted, factor } = tempoBeat(measure.time);
    // A dotted-quarter mark of 33.33 helps nobody: when the meter's beat
    // gives no whole number, count quarters instead.
    if (Math.abs(m.bpm / factor - Math.round(m.bpm / factor)) > 0.05) {
      ({ beatUnit, dotted, factor } = { beatUnit: 'quarter', dotted: false, factor: 1 });
    }
    measure.tempos.push({
      offset: m.at - measure.start,
      bpm: m.bpm,
      beatUnit,
      dotted,
      // Metronome marks are whole numbers; `bpm` keeps the exact tempo.
      perMinute: Math.max(1, Math.round(m.bpm / factor)),
      words: m.words,
    });
    shown = m.words ? undefined : m.bpm;
  }

  if (print.marks !== 'all') {
    for (const [i, measure] of measures.entries()) {
      measure.tempos = print.marks === 'opening' && i === 0
        ? measure.tempos.filter((t) => !t.words && t.offset === 0)
        : [];
    }
  }
  if (print.text) {
    const first = measures[0].tempos.find((t) => !t.words && t.offset === 0);
    if (first) first.text = print.text;
    else {
      // No mark to sit beside: the words stand alone, carrying the opening tempo.
      const at0 = song.tempoMap.find((e) => tick(e.time) === 0);
      const bpm = at0 ? at0.bpm : song.bpm;
      measures[0].tempos.unshift({
        offset: 0, bpm, beatUnit: 'quarter', dotted: false, perMinute: Math.max(1, Math.round(bpm)),
        text: print.text, hideMetronome: true,
      });
    }
  }
}

/** The beat a metronome mark counts in this meter, and its length in quarters. */
function tempoBeat(time: NotationTime): { beatUnit: NoteType; dotted: boolean; factor: number } {
  if (isCompound(time)) {
    return time.beatType === 4
      ? { beatUnit: 'half', dotted: true, factor: 3 }
      : { beatUnit: 'quarter', dotted: true, factor: 1.5 };
  }
  if (time.beatType === 2) return { beatUnit: 'half', dotted: false, factor: 2 };
  return { beatUnit: 'quarter', dotted: false, factor: 1 };
}

// ---------------------------------------------------------------------------
// Reading the model back
// ---------------------------------------------------------------------------

/** One sounding note recovered from the model, ties merged, in ticks. */
export interface ScoreNote {
  part: string;
  start: number;
  end: number;
  midi: number;
}

/**
 * Flatten a Score back to its notes: every tie chain becomes one note. This
 * is the model's own check (it must give back the written timeline exactly),
 * and what a renderer needs to light up notes during playback.
 */
export function scoreNotes(score: Score): ScoreNote[] {
  const out: ScoreNote[] = [];
  for (const part of score.parts) {
    const open = new Map<string, ScoreNote>();
    part.measures.forEach((pm, mi) => {
      const m0 = score.measures[mi].start;
      for (const v of pm.voices) {
        for (const e of v.events) {
          if (e.kind !== 'note') continue;
          for (const n of e.notes) {
            const key = `${v.staff}:${v.voice}:${n.midi}`;
            const at = m0 + e.offset;
            let note = e.tieStop ? open.get(key) : undefined;
            if (note && note.end === at) {
              note.end = at + e.duration;
            } else {
              note = { part: part.id, start: at, end: at + e.duration, midi: n.midi };
              out.push(note);
            }
            if (e.tieStart) open.set(key, note);
            else open.delete(key);
          }
        }
      }
    });
  }
  return out.sort((a, b) => a.part.localeCompare(b.part) || a.start - b.start || a.midi - b.midi || a.end - b.end);
}
