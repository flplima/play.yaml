'use strict';

/**
 * parser.ts — the simplified recursive play.yaml DSL → timeline compiler.
 *
 * A document IS a track. Any track may declare child tracks, which inherit
 * every property from their parent (except `play`) and may override any of
 * them:
 *
 *   tempo: 80
 *   measure: 4/4
 *   sample: piano
 *   play: "c d e d"          # the root itself plays
 *   tracks:
 *     bassline:
 *       sample: bass         # overrides `sample`, inherits everything else
 *       play:
 *         - "c c ~ ~ c c ~ ~"
 *
 * Each string in a `play` array (or line in a multiline string) is one
 * measure. The measure's duration is divided EQUALLY among its
 * whitespace-separated tokens: 4 tokens in 4/4 are quarter notes, 8 tokens
 * are eighth notes. Tokens recurse:
 *   ~          rest
 *   _          hold — prolongs the previous note through this slot (a tie),
 *              at any depth and across barlines
 *   c  eb3     note — letter, optional #/b, optional octave (default 4)
 *   1  8  4#   scale degree in the track's `scale` (default "c major"):
 *              1 = root at the track's `octave`, 8 = root an octave up,
 *              trailing #/b raises/lowers a semitone
 *   5^ 5+ 5-   octave modifiers, repeatable: ^ or + shifts a note up an
 *              octave, - shifts it down (5^^ = the fifth two octaves up).
 *              They follow any accidental: 4#^
 *   [c e g]    chord — simultaneous, each element spans the whole slot
 *   {c {d e}}  group — the slot is divided equally among elements, recursively
 */

export interface TimelineEvent {
  time: number; // in quarter-note beats
  pitch: string;
  duration: number;
  velocity: number;
  midi: number;
}

/** Properties a track passes down to its children. */
export interface TrackProps {
  tempo?: number;
  measure?: string | number; // "4/4" or a plain beat count
  sample?: string;
  scale?: string; // "g major", "a minor" — the key for degree tokens
  octave?: number;
  channel?: number;
  program?: number;
  velocity?: number;
  /**
   * Fraction of its slot a note sounds. Below 1 the note releases before the
   * next begins (detached); above 1 they overlap, which is how physical
   * models such as SWAM are told to play a slur rather than re-attack.
   */
  gate?: number;
  /**
   * Roll spread for `~`-marked chords, in beats between successive notes.
   * The chord rolls in written order, so `[1 5 12]~` speaks bass-first the
   * way a string player breaks a triple stop, and `[12 5 1]~` strums the
   * other way. `~~` doubles the spread for a slower, guitar-like strum.
   */
  strum?: number;
  /**
   * How many notes of a rolled chord keep sounding. A bow can sustain two
   * strings, so `voices: 2` makes `[1 5 12]~` bow the bass into the roll and
   * release it as the top pair lands — the way a cellist breaks a triple
   * stop, and what physical models (SWAM) need to voice every note.
   * Unset = all notes sustain (piano, guitar, samplers).
   */
  voices?: number;
  /**
   * How long a voices-limited note rings past the onset of the note that
   * displaces it, in beats (`tail -0.02` as a set clause). Negative releases
   * it just before, so a two-voice model never has to steal. Unset =
   * max(3×strum, 0.09).
   */
  strumTail?: number;
  /** A dynamic or character mark ("mf", "dolce") — the worded form of `velocity`. */
  dynamic?: string;
  /** An articulation mark ("legato", "tenuto") — the worded form of `gate`. */
  articulation?: string;
  /**
   * Named MIDI controls: alias → CC number, or → { cc, min, max } when the
   * instrument's mapping uses a narrower band or runs the other way round
   * (`{ cc: 74, min: 127, max: 0 }` inverts it).
   */
  controls?: Record<string, number | ControlSpec>;
}

/** How a named control maps onto a CC, and over what range. */
export interface ControlSpec {
  cc: number;
  min?: number;
  max?: number;
}

/** A control-change emitted at a point in the timeline. */
export interface ControlEvent {
  time: number; // in quarter-note beats
  cc: number;
  value: number;
}

/** A tempo change; `rampBeats` > 0 makes it a gradual rit./accel. */
export interface TempoEvent {
  time: number; // in quarter-note beats
  bpm: number;
  rampBeats: number;
}

/**
 * A mapping item inside a `play` list. Named keys change the running note
 * props from that point on without advancing time (e.g. `- scale: d major`
 * or `- set: 'g lyd, oct up'`). Numeric keys are numbered measures: the key
 * states the 1-based measure the string occupies (`- 5: "1 2 3 4"`), so
 * measures can be labeled explicitly and gaps become silence.
 */
export type PlayDirective = Pick<
  TrackProps, 'scale' | 'octave' | 'velocity' | 'gate' | 'tempo' | 'measure' | 'strum' | 'voices'
> & {
  set?: string | string[];
  [measure: number]: string | undefined;
};

export type PlayInput = string | (string | PlayDirective)[];

export interface TrackNode extends TrackProps {
  title?: string; // meaningful at the root
  set?: string | string[]; // shorthand prop patch, applied after own props
  play?: PlayInput;
  tracks?: Record<string, TrackNode>;
}

export type SongDoc = TrackNode;

export interface CompiledTrack {
  name: string;
  channel: number;
  sample?: string;
  program?: number;
  timeline: TimelineEvent[];
  /** CC changes declared mid-song, in beat order. */
  controls: ControlEvent[];
}

export interface CompiledSong {
  title?: string;
  bpm: number;
  measureBeats: number;
  /** Song length in beats — the longest track, whole measures. */
  lengthBeats: number;
  /** Tempo changes in beat order; empty when the song holds one tempo. */
  tempoMap: TempoEvent[];
  tracks: CompiledTrack[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPO = 80;
export const DEFAULT_MEASURE = '4/4';
export const DEFAULT_SAMPLE = 'piano';
export const DEFAULT_SCALE = 'c major';
export const DEFAULT_OCTAVE = 4;
export const DEFAULT_VELOCITY = 90;

/** The token that prolongs the previous note rather than striking a new one. */
export const HOLD = '_';

/** Fraction of a slot a note actually sounds, so repeated notes re-articulate. */
export const DEFAULT_GATE = 0.9;

/**
 * Named articulations → gate. Values above 1 overlap into the next slot, which
 * is what tells a physical-model instrument to slur instead of re-attacking.
 */
export const ARTICULATIONS: Record<string, number> = {
  staccatissimo: 0.25,
  spiccato: 0.3, // off-the-string bounce; on SWAM set Bow Lift to "Off String"
  staccato: 0.4,
  short: 0.4,
  portato: 0.7,
  detached: DEFAULT_GATE,
  separate: DEFAULT_GATE,
  tenuto: 0.98,
  legato: 1.05,
  smooth: 1.05,
  slurred: 1.05,
  slur: 1.05,
};

/** Dynamic marks → MIDI velocity. */
export const DYNAMICS: Record<string, number> = {
  ppp: 16,
  pianississimo: 16,
  pp: 32,
  pianissimo: 32,
  p: 48,
  piano: 48,
  quiet: 48,
  mp: 64,
  mezzopiano: 64,
  mf: 80,
  mezzoforte: 80,
  f: 96,
  forte: 96,
  loud: 96,
  ff: 112,
  fortissimo: 112,
  fff: 127,
  fortississimo: 127,
};

/** How much one "louder" / "softer" step moves the velocity. */
const DYNAMIC_STEP = 16;

/** Tempo marks → beats per minute. */
export const TEMPO_MARKS: Record<string, number> = {
  grave: 40,
  largo: 50,
  lento: 55,
  adagio: 66,
  andante: 76,
  andantino: 88,
  moderato: 100,
  allegretto: 116,
  allegro: 132,
  vivace: 160,
  presto: 180,
  prestissimo: 200,
};

/**
 * Character marks — the composite ones. Each expands to the combination of
 * dynamic and articulation a player would reach for on seeing the word.
 */
export const EXPRESSIONS: Record<string, { velocity?: number; gate?: number }> = {
  dolce: { velocity: 56, gate: 1.02 }, // sweetly: soft and connected
  cantabile: { velocity: 80, gate: 1.05 }, // singing
  espressivo: { velocity: 88, gate: 1.02 },
  'sotto voce': { velocity: 40, gate: 0.95 },
  leggiero: { velocity: 56, gate: 0.6 }, // light and detached
  grazioso: { velocity: 68, gate: 0.9 },
  marcato: { velocity: 104, gate: 0.8 }, // marked, each note stressed
  martele: { velocity: 112, gate: 0.55 }, // hammered strokes, biting attack
  martellato: { velocity: 112, gate: 0.55 },
  pesante: { velocity: 104, gate: 0.98 }, // heavy
  maestoso: { velocity: 100, gate: 0.98 },
  agitato: { velocity: 100, gate: 0.75 },
  tranquillo: { velocity: 52, gate: 1.0 },
};

/**
 * Conventional CCs for the named controls, so the playing-technique words
 * below work untouched. Override per track with `controls:` to match your
 * instrument's own MIDI mapping.
 */
export const DEFAULT_CONTROLS: Record<string, ControlSpec> = {
  bow: { cc: 74 }, // bow position / brightness
  pressure: { cc: 71 },
  vibrato: { cc: 1 }, // modulation, the near-universal vibrato control
};

/**
 * Playing techniques → a position from 0 to 1 along a named control, which is
 * then scaled into that control's range. Bow position runs from over the
 * fingerboard (0) to at the bridge (1); if your instrument maps it the other
 * way, invert the range in `controls:` rather than rewriting the score.
 */
export const CONTROL_TERMS: Record<string, { control: string; amount: number }> = {
  // ── bow position ──
  'sul tasto': { control: 'bow', amount: 0 },
  flautando: { control: 'bow', amount: 0.1 },
  flautato: { control: 'bow', amount: 0.1 },
  'poco sul tasto': { control: 'bow', amount: 0.25 },
  ordinario: { control: 'bow', amount: 0.5 },
  naturale: { control: 'bow', amount: 0.5 },
  ord: { control: 'bow', amount: 0.5 },
  'poco sul ponticello': { control: 'bow', amount: 0.75 },
  'sul ponticello': { control: 'bow', amount: 0.9 },
  'molto sul ponticello': { control: 'bow', amount: 1 },

  // ── bow pressure ──
  'light bow': { control: 'pressure', amount: 0.2 },
  sfiorando: { control: 'pressure', amount: 0.1 }, // barely touching
  'normal bow': { control: 'pressure', amount: 0.5 },
  'heavy bow': { control: 'pressure', amount: 0.85 },
  premuto: { control: 'pressure', amount: 0.9 }, // pressed
  pressed: { control: 'pressure', amount: 0.9 },
  scratch: { control: 'pressure', amount: 1 }, // overpressure — SWAM shows "Scratch"

  // ── vibrato ──
  'senza vibrato': { control: 'vibrato', amount: 0 },
  'non vibrato': { control: 'vibrato', amount: 0 },
  'no vibrato': { control: 'vibrato', amount: 0 },
  'poco vibrato': { control: 'vibrato', amount: 0.25 },
  'light vibrato': { control: 'vibrato', amount: 0.25 },
  vibrato: { control: 'vibrato', amount: 0.6 },
  'molto vibrato': { control: 'vibrato', amount: 1 },
  'full vibrato': { control: 'vibrato', amount: 1 },
  'slow vibrato': { control: 'vibrato_rate', amount: 0.25 },
  'fast vibrato': { control: 'vibrato_rate', amount: 0.85 },

  // ── play mode: how the string is set in motion ──
  arco: { control: 'playmode', amount: 0 },
  pizzicato: { control: 'playmode', amount: 0.5 },
  pizz: { control: 'playmode', amount: 0.5 },
  'col legno': { control: 'playmode', amount: 1 },

  // ── bowed tremolo (the instrument's own, e.g. SWAM auto-tremolo) ──
  'tremolo off': { control: 'tremolo', amount: 0 },
  tremolo: { control: 'tremolo', amount: 0.5 },
  'tremolo slow': { control: 'tremolo', amount: 0.5 },
  'tremolo fast': { control: 'tremolo', amount: 1 },

  // ── mute ──
  'con sordino': { control: 'sordino', amount: 1 },
  'senza sordino': { control: 'sordino', amount: 0 },

  // ── bow lift: on the string (martelé) vs off the string (spiccato) ──
  'off the string': { control: 'bowlift', amount: 0 },
  'on the string': { control: 'bowlift', amount: 1 },

  // ── left hand ──
  'senza portamento': { control: 'portamento', amount: 0 },
  portamento: { control: 'portamento', amount: 0.7 },
  'molto portamento': { control: 'portamento', amount: 1 },
  glissando: { control: 'portamento', amount: 1 },
  'no harmonics': { control: 'harmonics', amount: 0 },
  harmonics: { control: 'harmonics', amount: 0.4 }, // 2nd harmonic — one octave up
  'high harmonics': { control: 'harmonics', amount: 0.9 }, // 3rd — octave and a fifth

  // ── left-hand position (SWAM "Alternate Fingering"): where notes are
  //    fingered, and whether open strings are allowed to ring ──
  'mid position': { control: 'fingering', amount: 0 },
  'high position': { control: 'fingering', amount: 0.5 }, // near the bridge
  'open strings': { control: 'fingering', amount: 1 }, // near the nut + open
};

/** Resolve a named control to its CC and range, falling back to convention. */
export function resolveControl(
  controls: Record<string, number | ControlSpec> | undefined,
  name: string,
): ControlSpec | undefined {
  const declared = controls?.[name];
  const spec = typeof declared === 'number' ? { cc: declared } : declared ?? DEFAULT_CONTROLS[name];
  return spec && { min: 0, max: 127, ...spec };
}

/**
 * Immediate relative tempo words → the ratio applied to the running tempo.
 * Unlike the gradual words below these take effect at once, the way a player
 * reads "più lento" at a section boundary.
 */
const TEMPO_RELATIVE: Record<string, number> = {
  'piu lento': 0.75,
  'meno mosso': 0.8,
  'piu mosso': 1.25,
};

/** How much velocity one `>` accent adds to a note. */
export const ACCENT_STEP = 16;

/** Default roll spread for `~`-marked chords, in beats between notes. */
export const DEFAULT_STRUM = 0.03;

/** Gradual tempo words → the ratio they move the pulse by. */
const TEMPO_GRADUAL: Record<string, number> = {
  ritardando: 0.8,
  rit: 0.8,
  ritenuto: 0.8,
  rallentando: 0.8,
  rall: 0.8,
  allargando: 0.85,
  slower: 0.9,
  accelerando: 1.25,
  accel: 1.25,
  stringendo: 1.25,
  faster: 1.1,
};

/** Built-in sample names → General MIDI program, for .mid export. */
export const SAMPLE_PROGRAMS: Record<string, number> = {
  piano: 0,
  keys: 4,
  bass: 33,
  strings: 48,
  violin: 40,
  cello: 42,
  pad: 89,
  flute: 73,
  ocarina: 79,
  lead: 81,
};

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

/**
 * "g major" / "eb minor" / "g lydian" / "a" (major implied) → root pitch
 * class + intervals. Any Greek mode name works alongside major/minor, and
 * unique prefixes of at least 3 letters abbreviate ("g mix", "c lyd").
 */
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
  let rootPc = PITCH_CLASSES[m[1].toLowerCase()];
  if (m[2] === '#') rootPc += 1;
  if (m[2] === 'b') rootPc -= 1;
  return { rootPc: ((rootPc % 12) + 12) % 12, intervals: SCALES[found[1]] };
}

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
  let rootPc = PITCH_CLASSES[m[1].toLowerCase()];
  if (m[2] === '#') rootPc += 1;
  if (m[2] === 'b') rootPc -= 1;
  return { rootPc: ((rootPc % 12) + 12) % 12, intervals };
}

// ---------------------------------------------------------------------------
// `set` shorthand — "g lydian, octave up" patches several props at once
// ---------------------------------------------------------------------------

export interface SetPatch {
  scale?: string;
  octave?: number;
  octaveDelta?: number;
  velocity?: number;
  /** Relative dynamic step, for "louder" / "softer". */
  velocityDelta?: number;
  /** Gradual dynamic: reach `to` over `overMeasures` measures. */
  velocityRamp?: { to?: number; scale?: number; overMeasures: number };
  gate?: number;
  /** `bpm` is absolute, `scale` multiplies the running tempo; both may ramp. */
  tempo?: { bpm?: number; scale?: number; overMeasures: number };
  /** "a tempo" — return to the tempo the track started at. */
  aTempo?: boolean;
  /** A time-signature change ("2/4") for the measures that follow. */
  measure?: string;
  /** Roll spread for `~` chords, in beats between successive notes. */
  strum?: number;
  /** Sustained-note limit inside rolled chords (0 = unlimited). */
  voices?: number;
  /**
   * How long a voices-limited note rings past the onset of the note that
   * displaces it, in beats. Negative releases it just before (avoids voice
   * stealing on 2-voice models). Unset = max(3×strum, 0.09).
   */
  strumTail?: number;
  ccs?: { cc: number; value: number }[];
  /** Control drifts: reach `to` over `overMeasures`, from wherever the
   *  control last sat ("sul ponticello over 6", "bow to 110 over 4"). */
  ccRamps?: { cc: number; to: number; overMeasures: number }[];
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

/**
 * Parse a `set` value (a string of comma-separated clauses, or an array of
 * such strings) into a prop patch. Clauses:
 *   "g lydian" / "c mix"          → scale (abbreviations welcome)
 *   "octave up" / "oct down"      → relative octave shift
 *   "octave 3" / "oct 3"          → absolute octave
 *   "tempo 60" / "tempo 60 over 2" → tempo, optionally ramped over N measures
 *   "legato" / "detached" / "staccato" / "gate 1.05" → articulation
 *   "velocity 90"                 → dynamics
 *   "cc74 30"                     → a raw control change
 *   "bow 30"                      → a control change via the track's `controls`
 */
export function parseSet(
  value: string | string[],
  controls: Record<string, number | ControlSpec> = {},
  opts: { ignoreMissingControls?: boolean } = {},
): SetPatch {
  const patch: SetPatch = {};
  const clauses = (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(','))
    .map((c) => c.trim())
    .filter(Boolean);

  const addCc = (cc: number, val: number) => {
    (patch.ccs ??= []).push({ cc, value: Math.max(0, Math.min(127, Math.round(val))) });
  };

  for (const clause of clauses) {
    const oct = /^oct(?:ave)?\s+(up|down|-?\d+)$/i.exec(clause);
    if (oct) {
      if (oct[1] === 'up') patch.octaveDelta = (patch.octaveDelta ?? 0) + 1;
      else if (oct[1] === 'down') patch.octaveDelta = (patch.octaveDelta ?? 0) - 1;
      else {
        patch.octave = parseInt(oct[1], 10);
        delete patch.octaveDelta;
      }
      continue;
    }

    const tempo = new RegExp(`^tempo\\s+(${NUM})(?:\\s+over\\s+(${NUM}))?$`, 'i').exec(clause);
    if (tempo) {
      patch.tempo = { bpm: Number(tempo[1]), overMeasures: tempo[2] ? Number(tempo[2]) : 0 };
      continue;
    }

    // A time-signature change: "2/4", or "measure 2/4" if you prefer words.
    const meter = /^(?:measure\s+)?(\d+\s*\/\s*\d+)$/i.exec(clause);
    if (meter) {
      patch.measure = meter[1].replace(/\s+/g, '');
      continue;
    }

    const word = clause.toLowerCase().replace(/\.$/, '') // "rit." → "rit"
      .replace(/ù/g, 'u').replace(/é/g, 'e'); // "più lento", "martelé"

    if (TEMPO_RELATIVE[word] !== undefined) {
      patch.tempo = { scale: TEMPO_RELATIVE[word], overMeasures: 0 };
      continue;
    }

    if (ARTICULATIONS[word] !== undefined) {
      patch.gate = ARTICULATIONS[word];
      continue;
    }

    if (DYNAMICS[word] !== undefined) {
      patch.velocity = DYNAMICS[word];
      continue;
    }

    if (EXPRESSIONS[word] !== undefined) {
      Object.assign(patch, EXPRESSIONS[word]);
      continue;
    }

    // Playing techniques: "sul tasto", "molto vibrato", "pizzicato".
    if (CONTROL_TERMS[word] !== undefined) {
      const { control, amount } = CONTROL_TERMS[word];
      const spec = resolveControl(controls, control);
      if (spec) {
        addCc(spec.cc, spec.min! + (spec.max! - spec.min!) * amount);
      } else if (!opts.ignoreMissingControls) {
        throw new Error(
          `"${clause}" needs a "${control}" control — add it under \`controls:\`, ` +
            `e.g. controls: { ${control}: 74 }.`,
        );
      }
      continue;
    }

    // A technique word with a span drifts there instead of jumping:
    // "sul ponticello over 6" glides the bow to the bridge across 6 measures.
    const termRamp = new RegExp(`^(.+?)\\s+over\\s+(${NUM})$`).exec(word);
    if (termRamp && CONTROL_TERMS[termRamp[1]] !== undefined) {
      const { control, amount } = CONTROL_TERMS[termRamp[1]];
      const spec = resolveControl(controls, control);
      if (spec) {
        (patch.ccRamps ??= []).push({
          cc: spec.cc,
          to: Math.round(spec.min! + (spec.max! - spec.min!) * amount),
          overMeasures: Number(termRamp[2]),
        });
      } else if (!opts.ignoreMissingControls) {
        throw new Error(
          `"${clause}" needs a "${control}" control — add it under \`controls:\`.`,
        );
      }
      continue;
    }

    if (TEMPO_MARKS[word] !== undefined) {
      patch.tempo = { bpm: TEMPO_MARKS[word], overMeasures: 0 };
      continue;
    }

    if (word === 'a tempo' || word === 'atempo') {
      patch.aTempo = true;
      continue;
    }

    if (word === 'louder' || word === 'softer') {
      patch.velocityDelta = (patch.velocityDelta ?? 0) +
        (word === 'louder' ? DYNAMIC_STEP : -DYNAMIC_STEP);
      continue;
    }

    // Gradual marks: "ritardando", "rit over 2", "allargando to adagio over 3".
    const gradual = new RegExp(
      `^([a-z]+)(?:\\s+to\\s+([a-z]+|${NUM}))?(?:\\s+over\\s+(${NUM}))?$`,
      'i',
    ).exec(word);
    if (gradual && TEMPO_GRADUAL[gradual[1]] !== undefined) {
      const overMeasures = gradual[3] ? Number(gradual[3]) : 1;
      if (gradual[2] !== undefined) {
        const bpm = TEMPO_MARKS[gradual[2]] ?? Number(gradual[2]);
        if (!Number.isFinite(bpm)) {
          throw new Error(`Unknown tempo "${gradual[2]}" in "${clause}".`);
        }
        patch.tempo = { bpm, overMeasures };
      } else {
        patch.tempo = { scale: TEMPO_GRADUAL[gradual[1]], overMeasures };
      }
      continue;
    }

    // "crescendo", "cresc to ff over 2", "diminuendo over 4".
    const hairpin = new RegExp(
      `^(crescendo|cresc|diminuendo|dim|decrescendo|decresc)` +
        `(?:\\s+to\\s+([a-z]+|${NUM}))?(?:\\s+over\\s+(${NUM}))?$`,
      'i',
    ).exec(word);
    if (hairpin) {
      const rising = /^cres/.test(hairpin[1]);
      const target = hairpin[2];
      const overMeasures = hairpin[3] ? Number(hairpin[3]) : 1;
      if (target !== undefined) {
        const to = DYNAMICS[target] ?? Number(target);
        if (!Number.isFinite(to)) {
          throw new Error(`Unknown dynamic "${target}" in "${clause}".`);
        }
        patch.velocityRamp = { to, overMeasures };
      } else {
        patch.velocityRamp = { scale: rising ? 1.4 : 0.65, overMeasures };
      }
      continue;
    }

    const gate = new RegExp(`^gate\\s+(${NUM})$`, 'i').exec(clause);
    if (gate) {
      patch.gate = Number(gate[1]);
      continue;
    }

    const strum = new RegExp(`^strum\\s+(${NUM})$`, 'i').exec(clause);
    if (strum) {
      patch.strum = Number(strum[1]);
      continue;
    }

    const voices = /^voices\s+(\d+|all)$/i.exec(clause);
    if (voices) {
      patch.voices = voices[1].toLowerCase() === 'all' ? 0 : parseInt(voices[1], 10);
      continue;
    }

    const tail = new RegExp(`^tail\\s+(${NUM})$`, 'i').exec(clause);
    if (tail) {
      patch.strumTail = Number(tail[1]);
      continue;
    }

    const vel = new RegExp(`^velocity\\s+(${NUM})$`, 'i').exec(clause);
    if (vel) {
      patch.velocity = Number(vel[1]);
      continue;
    }

    // Numeric control drifts: "bow to 110 over 4", "cc74 to 90 over 2".
    const clamp127 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
    const ccRamp = new RegExp(`^cc\\s*(\\d+)\\s+to\\s+(${NUM})\\s+over\\s+(${NUM})$`, 'i').exec(clause);
    if (ccRamp) {
      (patch.ccRamps ??= []).push({
        cc: parseInt(ccRamp[1], 10), to: clamp127(Number(ccRamp[2])), overMeasures: Number(ccRamp[3]),
      });
      continue;
    }
    const namedRamp = new RegExp(`^([a-z][a-z0-9_]*)\\s+to\\s+(${NUM})\\s+over\\s+(${NUM})$`, 'i').exec(clause);
    const namedRampSpec = namedRamp && resolveControl(controls, namedRamp[1].toLowerCase());
    if (namedRampSpec) {
      (patch.ccRamps ??= []).push({
        cc: namedRampSpec.cc, to: clamp127(Number(namedRamp![2])), overMeasures: Number(namedRamp![3]),
      });
      continue;
    }
    // Classification mode: a "name value" clause may be a control the track
    // declares but this caller can't see — treat it as a directive clause.
    if (namedRamp && opts.ignoreMissingControls) continue;

    const rawCc = new RegExp(`^cc\\s*(\\d+)\\s+(${NUM})$`, 'i').exec(clause);
    if (rawCc) {
      addCc(parseInt(rawCc[1], 10), Number(rawCc[2]));
      continue;
    }

    const named = new RegExp(`^([a-z][a-z0-9_]*)\\s+(${NUM})$`, 'i').exec(clause);
    const namedSpec = named && resolveControl(controls, named[1].toLowerCase());
    if (namedSpec) {
      addCc(namedSpec.cc, Number(named![2]));
      continue;
    }
    if (named && opts.ignoreMissingControls) continue;

    try {
      parseScale(clause);
      patch.scale = clause;
      continue;
    } catch {
      // Not a scale either — fall through to the error below.
    }
    throw new Error(
      `Unknown set clause "${clause}" — expected a dynamic ("mf", "dolce", ` +
        `"crescendo to f over 2"), a tempo ("allegro", "ritardando over 2", ` +
        `"a tempo", "tempo 60", "più lento"), an articulation ("legato", ` +
        `"staccato"), a scale ("g lydian"), an octave ("oct up"), a meter ` +
        `("2/4"), or a control ("cc74 30").`,
    );
  }
  return patch;
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

/** Round to 6 decimals to keep equal-division math (1/3, 1/6…) stable. */
function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
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

// ---------------------------------------------------------------------------
// Measures & tokens
// ---------------------------------------------------------------------------

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

/** Could this token appear in a measure — a note, degree, rest, hold or group? */
function isMeasureToken(token: string): boolean {
  // Suffix marks (accents, strums) don't change what a token is — but a bare
  // `~` is the rest, not a suffix.
  const suffix = /([<>~]+)$/.exec(token);
  if (suffix && suffix[1].length < token.length) token = token.slice(0, -suffix[1].length);
  if (token === '~' || token === HOLD) return true;
  if (token[0] === '{' || token[0] === '[') return true;
  if (isSetToken(token) || isScaleToken(token)) return true;
  if (/^_+\S/.test(token)) return true; // _1, __d3
  if (/^-?\d+(#|b)?[+^-]*$/.test(token)) return true; // scale degree
  return noteToMidi(token) !== null;
}

/**
 * Is this play-list string an expression mark rather than a measure?
 *
 * Measures win any tie: a string whose tokens all read as notes is always a
 * measure, so `"f"` stays the note F rather than becoming forte (write
 * `"forte"`, or `set: f`, when you mean the dynamic).
 */
export function isDirectiveString(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const tokens = splitTopLevel(trimmed);
  if (tokens.length > 0 && tokens.every(isMeasureToken)) return false;
  try {
    // Classification only — a technique word is a directive even when the
    // track hasn't mapped its control yet (compilation stays strict).
    parseSet(trimmed, {}, { ignoreMissingControls: true });
    return true;
  } catch {
    return false; // neither — leave it to the measure parser to complain
  }
}

/** Is this token an inline `||…||` set directive? */
export function isSetToken(token: string): boolean {
  return token.startsWith('||');
}

/** Is this token an inline `==…==` scale or chord change? */
export function isScaleToken(token: string): boolean {
  return token.startsWith('==');
}

/** "||g lyd, oct up||" → "g lyd, oct up"; "==Dm7==" → "Dm7". */
export function setTokenBody(token: string): string {
  const width = isScaleToken(token) ? 2 : 2;
  const closer = isScaleToken(token) ? '==' : '||';
  return token.slice(width, token.endsWith(closer) ? -width : undefined).trim();
}

/**
 * Split on whitespace at bracket depth 0 ("{c [d e]} f" → ["{c [d e]}", "f"]).
 * A `||…||` set directive is one token regardless of the spaces inside it.
 */
export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // `||…||` and `==…==` are single tokens however many spaces they contain.
    const fence = depth === 0 && ((ch === '|' && text[i + 1] === '|') || (ch === '=' && text[i + 1] === '='))
      ? ch + ch
      : null;
    if (fence) {
      flush();
      const close = text.indexOf(fence, i + 2);
      const end = close === -1 ? text.length : close + 2;
      out.push(text.slice(i, end));
      i = end - 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) flush();
    else current += ch;
  }
  flush();
  return out;
}

interface EmitCtx {
  events: TimelineEvent[];
  scale: ScaleInfo;
  octave: number;
  velocity: number;
  gate: number;
  /** Beats between successive notes of a `~`-rolled chord. */
  strum: number;
  /** Sustained-note limit inside rolled chords (0 = unlimited). */
  voices: number;
  /** Release tail for voices-limited notes, in beats; undefined = auto. */
  strumTail?: number;
  /** Active crescendo/diminuendo; notes inside the span interpolate. */
  velocityRamp?: { fromBeat: number; toBeat: number; from: number; to: number };
  /** The notes a `_` would prolong, and how much time they cover so far. */
  held?: { events: TimelineEvent[]; span: number } | null;
}

const clampVelocity = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

/** Velocity for a note, honouring any crescendo/diminuendo in progress. */
function velocityAt(ctx: EmitCtx, beat: number): number {
  const ramp = ctx.velocityRamp;
  if (!ramp || beat <= ramp.fromBeat) return ramp ? ramp.from : ctx.velocity;
  if (beat >= ramp.toBeat) return ramp.to;
  const t = (beat - ramp.fromBeat) / (ramp.toBeat - ramp.fromBeat);
  return clampVelocity(ramp.from + (ramp.to - ramp.from) * t);
}

/**
 * Recursively place one token in [start, start+span):
 * rests emit nothing, chords stack, groups subdivide equally.
 * `boost` carries an accent's extra velocity into chord members.
 */
function placeToken(token: string, start: number, span: number, ctx: EmitCtx, boost = 0): void {
  let tok = token.trim();
  if (!tok) return;

  // Suffix marks: `>` accents, `<` softens (both stackable), and `~` rolls a
  // chord (arpeggiando) — `[1 5 12]~`. The bare `~` rest stays untouched
  // because a suffix needs something to sit on.
  let strumMarks = 0;
  const suffix = /([<>~]+)$/.exec(tok);
  if (suffix && suffix[1].length < tok.length) {
    for (const ch of suffix[1]) {
      if (ch === '~') strumMarks += 1;
      else boost += ch === '>' ? ACCENT_STEP : -ACCENT_STEP;
    }
    tok = tok.slice(0, -suffix[1].length);
  }

  // A rest cuts the sound off, so nothing can be prolonged across it.
  if (tok === '~') {
    ctx.held = null;
    return;
  }

  // `_` prolongs whatever sounded last instead of striking a new note — a tie.
  // It works at any depth and across barlines.
  if (tok === HOLD) {
    if (ctx.held) {
      ctx.held.span += span;
      const duration = round(ctx.held.span * ctx.gate);
      for (const event of ctx.held.events) event.duration = duration;
    }
    return;
  }

  if (tok[0] === '[' && tok[tok.length - 1] === ']') {
    const before = ctx.events.length;
    const parts = splitTopLevel(tok.slice(1, -1));
    // A `~` rolls the chord in WRITTEN order: each note starts a little after
    // the previous and everything still ends together, like a broken triple
    // stop or a guitar strum. The spread is clamped so fast subdivisions
    // never roll past their own slot.
    const spread = strumMarks
      ? Math.min(strumMarks * ctx.strum, (span * 0.6) / Math.max(1, parts.length - 1))
      : 0;
    parts.forEach((part, i) => {
      const offset = round(i * spread);
      placeToken(part, start + offset, span - offset, ctx, boost);
    });
    const chord = ctx.events.slice(before);
    // With a `voices` limit, a rolled chord is played the way a bow breaks
    // it: each earlier note releases after the roll moves past the
    // instrument's polyphony. The release tail overlaps the displacing note
    // generously — that overlap is what tells a string-crossing model
    // (SWAM) the next note lives on another string, and it is how long a
    // broken bass genuinely rings under the top of the chord.
    let sustained = chord;
    if (strumMarks && ctx.voices > 0 && chord.length > ctx.voices) {
      const cut = chord.length - ctx.voices;
      const tail = ctx.strumTail ?? Math.max(3 * spread, 0.09);
      for (let i = 0; i < cut; i++) {
        const releaseAt = chord[i + ctx.voices].time + tail;
        chord[i].duration = round(
          Math.min(Math.max(0.01, releaseAt - chord[i].time), span * ctx.gate),
        );
      }
      sustained = chord.slice(cut);
    }
    // The (sustaining part of the) chord is prolonged together.
    ctx.held = sustained.length ? { events: sustained, span } : null;
    return;
  }

  if (tok[0] === '{' && tok[tok.length - 1] === '}') {
    const parts = splitTopLevel(tok.slice(1, -1));
    if (parts.length === 0) return;
    const sub = span / parts.length;
    parts.forEach((part, i) => placeToken(part, start + i * sub, sub, ctx, boost));
    return;
  }

  // A leading `_` drops the note an octave, repeatable: `_1`, `__d3`. (A `_`
  // on its own is the hold token, handled above.)
  const under = /^(_+)(?=\S)/.exec(tok);
  const core = under ? tok.slice(under[1].length) : tok;
  const octavesDown = under ? under[1].length : 0;

  const raw = /^-?\d/.test(core)
    ? degreeToMidi(core, ctx.scale, ctx.octave)
    : noteToMidi(core, ctx.octave);
  const midi = raw === null ? null : raw - 12 * octavesDown;
  if (midi === null) return; // unknown token → treat as a rest, stay robust
  const event: TimelineEvent = {
    time: round(start),
    pitch: midiToName(midi),
    duration: round(span * ctx.gate),
    velocity: clampVelocity(velocityAt(ctx, start) + boost),
    midi,
  };
  ctx.events.push(event);
  ctx.held = { events: [event], span };
}

function playItems(play: PlayInput): (string | PlayDirective)[] {
  return Array.isArray(play) ? play : String(play).split('\n');
}

export interface PlayMeasureEntry {
  text: string;
  /** 0-based measure slot this string occupies. */
  index: number;
}

/**
 * Walk a `play` value yielding every measure string with the measure slot it
 * lands in — accounting for numbered keys (which jump the position) and
 * directive-only lines (which occupy no slot).
 */
export function playMeasureEntries(play: PlayInput | undefined): PlayMeasureEntry[] {
  if (play == null) return [];
  const out: PlayMeasureEntry[] = [];
  let m = 0;
  const push = (raw: string) => {
    const text = raw.trim();
    if (!text || isDirectiveString(text)) return; // expression marks take no time
    out.push({ text, index: m });
    if (splitTopLevel(text).some((t) => !isSetToken(t) && !isScaleToken(t))) m++;
  };
  for (const item of playItems(play)) {
    if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) {
        if (/^\d+$/.test(key) && typeof value === 'string') {
          const target = parseInt(key, 10) - 1;
          if (target >= 0) m = target;
          push(value);
        }
      }
      continue;
    }
    push(String(item));
  }
  return out;
}

/** `play` value → list of measure strings (directive items don't count). */
export function playToMeasures(play: PlayInput | undefined): string[] {
  return playMeasureEntries(play).map((e) => e.text);
}

export interface PlayResult {
  timeline: TimelineEvent[];
  controls: ControlEvent[];
  tempos: TempoEvent[];
  /** Where the last sounding measure ends, in beats — honours meter changes. */
  lengthBeats: number;
}

/**
 * Compile one track's measures. Each measure is divided equally among its
 * top-level tokens. Mapping items and `||…||` tokens act as directives: they
 * update the running scale/octave/velocity/gate, and emit control or tempo
 * events at the beat where they appear, without advancing time.
 */
export function parsePlayFull(play: PlayInput, props: TrackProps = {}): PlayResult {
  let measureBeats = measureToBeats(props.measure);
  const controlAliases = props.controls ?? {};
  const baseTempo = props.tempo ?? DEFAULT_TEMPO;
  let runningTempo = baseTempo;
  // `dynamic:` and `articulation:` are the worded forms of velocity and gate.
  const worded = parseSet(
    [props.dynamic, props.articulation].filter(Boolean).join(', ') || [],
  );
  const ctx: EmitCtx = {
    events: [],
    scale: parseScale(props.scale),
    octave: props.octave ?? DEFAULT_OCTAVE,
    velocity: clampVelocity(props.velocity ?? worded.velocity ?? DEFAULT_VELOCITY),
    gate: props.gate ?? worded.gate ?? DEFAULT_GATE,
    strum: props.strum ?? DEFAULT_STRUM,
    voices: props.voices ?? 0,
    strumTail: props.strumTail,
  };
  const controls: ControlEvent[] = [];
  const tempos: TempoEvent[] = [];
  /** Last value emitted per CC, so a drift knows where it starts. */
  const lastCc = new Map<number, number>();

  // Physical models (SWAM and friends) take their loudness from a continuous
  // expression controller, not from note velocity. When a track declares an
  // `expression` control, dynamic marks also drive it: immediate changes emit
  // one CC, hairpins a ramp of CCs at eighth-note resolution.
  const exprSpec = controlAliases.expression !== undefined
    ? resolveControl(controlAliases, 'expression')
    : undefined;
  const exprValue = (velocity: number) =>
    Math.round(exprSpec!.min! + (exprSpec!.max! - exprSpec!.min!) * (clampVelocity(velocity) / 127));
  const emitExpression = (at: number, velocity: number) => {
    if (exprSpec) controls.push({ time: round(at), cc: exprSpec.cc, value: exprValue(velocity) });
  };
  const emitExpressionRamp = (fromBeat: number, toBeat: number, from: number, to: number) => {
    if (!exprSpec || toBeat <= fromBeat) return;
    const steps = Math.max(1, Math.ceil((toBeat - fromBeat) * 2)); // one per eighth
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      emitExpression(fromBeat + (toBeat - fromBeat) * t, from + (to - from) * t);
    }
  };

  // A physical model is silent until expression moves — open it at the start.
  emitExpression(0, ctx.velocity);

  const setTempo = (bpm: number, overMeasures: number, at: number) => {
    runningTempo = bpm;
    tempos.push({
      time: round(at),
      bpm: round(bpm),
      rampBeats: round(overMeasures * measureBeats),
    });
  };

  const applyPatch = (patch: SetPatch, at: number) => {
    if (patch.scale) ctx.scale = parseScale(patch.scale);
    if (patch.octave !== undefined) ctx.octave = patch.octave;
    if (patch.octaveDelta) ctx.octave += patch.octaveDelta;
    if (patch.measure) measureBeats = measureToBeats(patch.measure);

    // A new dynamic cancels any hairpin still in progress.
    if (patch.velocity !== undefined) {
      ctx.velocity = clampVelocity(patch.velocity);
      ctx.velocityRamp = undefined;
      emitExpression(at, ctx.velocity);
    }
    if (patch.velocityDelta) {
      ctx.velocity = clampVelocity(ctx.velocity + patch.velocityDelta);
      ctx.velocityRamp = undefined;
      emitExpression(at, ctx.velocity);
    }
    if (patch.velocityRamp) {
      const from = velocityAt(ctx, at);
      const to = clampVelocity(
        patch.velocityRamp.to ?? from * (patch.velocityRamp.scale ?? 1),
      );
      ctx.velocityRamp = {
        fromBeat: at,
        toBeat: at + patch.velocityRamp.overMeasures * measureBeats,
        from,
        to,
      };
      ctx.velocity = to; // where the music sits once the hairpin has landed
      emitExpressionRamp(at, ctx.velocityRamp.toBeat, from, to);
    }

    if (patch.gate !== undefined) ctx.gate = patch.gate;
    if (patch.strum !== undefined) ctx.strum = patch.strum;
    if (patch.voices !== undefined) ctx.voices = patch.voices;
    if (patch.strumTail !== undefined) ctx.strumTail = patch.strumTail;

    if (patch.aTempo) setTempo(baseTempo, 0, at);
    if (patch.tempo) {
      const target = patch.tempo.bpm ?? runningTempo * (patch.tempo.scale ?? 1);
      setTempo(target, patch.tempo.overMeasures, at);
    }

    for (const c of patch.ccs ?? []) {
      controls.push({ time: round(at), cc: c.cc, value: c.value });
      lastCc.set(c.cc, c.value);
    }
    // Drifts glide from wherever the control last sat, one step per eighth.
    for (const r of patch.ccRamps ?? []) {
      const from = lastCc.get(r.cc) ?? r.to;
      const toBeat = at + r.overMeasures * measureBeats;
      const steps = Math.max(1, Math.ceil((toBeat - at) * 2));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        controls.push({
          time: round(at + (toBeat - at) * t),
          cc: r.cc,
          value: Math.round(from + (r.to - from) * t),
        });
      }
      lastCc.set(r.cc, r.to);
    }
  };

  const applySet = (value: string | string[], at: number) =>
    applyPatch(parseSet(value, controlAliases), at);

  // `beat` is the cursor where the next measure starts. `m` counts measures
  // so numbered keys can jump; with meter changes in play, a jump over unseen
  // measures assumes they carry the meter running at that point.
  let m = 0;
  let beat = 0;
  let endBeat = 0;
  const compileMeasure = (raw: string) => {
    const measure = raw.trim();
    if (!measure) return;
    // A bare expression mark ("legato", "allargando over 2") sits between
    // measures like a marking in a score, and takes no time.
    if (isDirectiveString(measure)) {
      applySet(measure, beat);
      return;
    }
    const tokens = splitTopLevel(measure);
    const isMark = (t: string) => isSetToken(t) || isScaleToken(t);
    const noteTokens = tokens.filter((t) => !isMark(t));
    if (noteTokens.length === 0) {
      // A directive-only line changes state but is not a measure.
      for (const tok of tokens) {
        if (isScaleToken(tok)) ctx.scale = parseScale(setTokenBody(tok));
        else applySet(setTokenBody(tok), beat);
      }
      return;
    }
    const step = measureBeats / noteTokens.length;
    let slot = 0;
    for (const tok of tokens) {
      const at = beat + slot * step;
      if (isScaleToken(tok)) {
        // `==Dm7==` / `==C mixolydian==` — re-key the degrees that follow.
        ctx.scale = parseScale(setTokenBody(tok));
      } else if (isSetToken(tok)) {
        applySet(setTokenBody(tok), at);
      } else {
        placeToken(tok, at, step, ctx);
        slot++;
      }
    }
    m++;
    beat = round(beat + measureBeats);
    endBeat = Math.max(endBeat, beat);
  };

  const jumpTo = (target: number) => {
    if (target === m) return;
    beat = round(beat + (target - m) * measureBeats);
    m = target;
  };

  for (const item of playItems(play)) {
    if (item && typeof item === 'object') {
      if (item.scale !== undefined) ctx.scale = parseScale(item.scale);
      if (item.octave !== undefined) ctx.octave = item.octave;
      if (item.velocity !== undefined) {
        ctx.velocity = Math.max(1, Math.min(127, item.velocity));
        emitExpression(beat, ctx.velocity);
      }
      if (item.gate !== undefined) ctx.gate = item.gate;
      if (item.strum !== undefined) ctx.strum = item.strum;
      if (item.voices !== undefined) ctx.voices = item.voices;
      if (item.measure !== undefined) measureBeats = measureToBeats(item.measure);
      if (item.tempo !== undefined) tempos.push({ time: round(beat), bpm: item.tempo, rampBeats: 0 });
      if (item.set !== undefined) applySet(item.set, beat);
      for (const [key, value] of Object.entries(item)) {
        if (/^\d+$/.test(key) && typeof value === 'string') {
          const target = parseInt(key, 10) - 1;
          if (target >= 0) jumpTo(target); // numbered measure: jump to its slot
          compileMeasure(value);
        }
      }
      continue;
    }
    compileMeasure(String(item));
  }

  ctx.events.sort((a, b) => a.time - b.time || a.midi - b.midi);

  // A legato gate makes notes overlap — but when the SAME pitch repeats, the
  // earlier note's late Note-Off would cut the restruck note short. Trim the
  // earlier one to release just before the restrike instead.
  const lastByPitch = new Map<number, TimelineEvent>();
  for (const e of ctx.events) {
    const prev = lastByPitch.get(e.midi);
    if (prev && prev.time < e.time && prev.time + prev.duration > e.time) {
      prev.duration = round(Math.max(0.01, e.time - prev.time - 0.02));
    }
    lastByPitch.set(e.midi, e);
  }

  controls.sort((a, b) => a.time - b.time);
  tempos.sort((a, b) => a.time - b.time);
  return { timeline: ctx.events, controls, tempos, lengthBeats: endBeat };
}

/** Compile one track's measures to its note timeline. */
export function parsePlay(play: PlayInput, props: TrackProps = {}): TimelineEvent[] {
  return parsePlayFull(play, props).timeline;
}

// ---------------------------------------------------------------------------
// Document compilation (recursive tracks with inheritance)
// ---------------------------------------------------------------------------

const INHERITED: (keyof TrackProps)[] = [
  'tempo', 'measure', 'sample', 'scale', 'octave', 'channel', 'program', 'velocity',
  'gate', 'dynamic', 'articulation', 'controls', 'strum', 'voices', 'strumTail',
];

function effectiveProps(node: TrackNode, inherited: TrackProps): TrackProps {
  const props: TrackProps = { ...inherited };
  for (const key of INHERITED) {
    if (node[key] !== undefined) (props as any)[key] = node[key];
  }
  if (node.set !== undefined) {
    const patch = parseSet(node.set, props.controls);
    if (patch.scale) props.scale = patch.scale;
    if (patch.octave !== undefined) props.octave = patch.octave;
    if (patch.octaveDelta) props.octave = (props.octave ?? DEFAULT_OCTAVE) + patch.octaveDelta;
    if (patch.velocity !== undefined) props.velocity = patch.velocity;
    if (patch.gate !== undefined) props.gate = patch.gate;
    // Any control changes it declares are emitted at the start of the track,
    // in compileDoc — see the `set` handling in walk().
  }
  return props;
}

/**
 * Compile a document (which is itself a track) into flat per-track timelines.
 */
export function compileDoc(doc: SongDoc): CompiledSong {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Score must be a mapping with a "play:" or "tracks:" key.');
  }

  // velocity and gate are deliberately left unset here so that their worded
  // forms (`dynamic:` / `articulation:`) can supply them.
  const rootProps = effectiveProps(doc, {
    tempo: DEFAULT_TEMPO,
    measure: DEFAULT_MEASURE,
    sample: DEFAULT_SAMPLE,
    octave: DEFAULT_OCTAVE,
  });

  const tracks: CompiledTrack[] = [];
  const tempoMap: TempoEvent[] = [];
  let lengthBeats = 0;
  let nextChannel = 1;

  const walk = (node: TrackNode, name: string, inherited: TrackProps) => {
    const props = node === doc ? rootProps : effectiveProps(node, inherited);

    if (node.play != null) {
      const { timeline, controls, tempos, lengthBeats: trackBeats } = parsePlayFull(node.play, props);
      // A `set:` on the track itself opens the instrument at beat 0.
      const opening = (node.set !== undefined ? parseSet(node.set, props.controls).ccs ?? [] : [])
        .map((c) => ({ time: 0, cc: c.cc, value: c.value }));
      lengthBeats = Math.max(lengthBeats, trackBeats);
      const sample = props.sample ?? DEFAULT_SAMPLE;
      // Tempo belongs to the song, not a voice — merge every track's changes.
      tempoMap.push(...tempos);
      tracks.push({
        name,
        channel: props.channel ?? nextChannel++,
        sample,
        program: props.program ?? SAMPLE_PROGRAMS[sample.toLowerCase()],
        timeline,
        controls: [...opening, ...controls],
      });
    }

    if (node.tracks && typeof node.tracks === 'object') {
      for (const [childName, child] of Object.entries(node.tracks)) {
        if (child && typeof child === 'object') walk(child, childName, props);
      }
    }
  };

  walk(doc, doc.title || 'main', rootProps);

  if (tracks.length === 0) {
    throw new Error('Score has nothing to play — add a "play:" or "tracks:" key.');
  }

  // One change per beat position; a later track's declaration wins.
  const byTime = new Map<number, TempoEvent>();
  for (const t of tempoMap) byTime.set(t.time, t);

  return {
    title: doc.title,
    bpm: rootProps.tempo ?? DEFAULT_TEMPO,
    measureBeats: measureToBeats(rootProps.measure),
    lengthBeats,
    tempoMap: [...byTime.values()].sort((a, b) => a.time - b.time),
    tracks,
  };
}
