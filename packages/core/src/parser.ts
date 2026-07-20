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
  /** Named MIDI controls: alias → CC number, e.g. { bow: 74, pressure: 71 }. */
  controls?: Record<string, number>;
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
  TrackProps, 'scale' | 'octave' | 'velocity' | 'gate' | 'tempo'
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

/** Fraction of a slot a note actually sounds, so repeated notes re-articulate. */
export const DEFAULT_GATE = 0.9;

/**
 * Named articulations → gate. Values above 1 overlap into the next slot, which
 * is what tells a physical-model instrument to slur instead of re-attacking.
 */
export const ARTICULATIONS: Record<string, number> = {
  staccato: 0.4,
  detached: DEFAULT_GATE,
  legato: 1.05,
  slur: 1.05,
};

/** Built-in sample names → General MIDI program, for .mid export. */
export const SAMPLE_PROGRAMS: Record<string, number> = {
  piano: 0,
  keys: 4,
  bass: 33,
  strings: 48,
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
  'bebop dominant': [0, 2, 4, 5, 7, 9, 10, 11],
  'bebop major': [0, 2, 4, 5, 7, 8, 9, 11],
};

export interface ScaleInfo {
  rootPc: number;
  intervals: number[];
}

/**
 * "g major" / "eb minor" / "g lydian" / "a" (major implied) → root pitch
 * class + intervals. Any Greek mode name works alongside major/minor, and
 * unique prefixes of at least 3 letters abbreviate ("g mix", "c lyd").
 */
export function parseScale(scale: string | undefined): ScaleInfo {
  const m = /^([a-gA-G])(#|b)?((?:\s+[a-z]+)*)$/i.exec(String(scale ?? DEFAULT_SCALE).trim());
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
    throw new Error(`Invalid scale "${scale}" — expected e.g. "g major", "a minor" or "g lydian".`);
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
  gate?: number;
  tempo?: { bpm: number; overMeasures: number };
  ccs?: { cc: number; value: number }[];
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
  controls: Record<string, number> = {},
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

    if (ARTICULATIONS[clause.toLowerCase()] !== undefined) {
      patch.gate = ARTICULATIONS[clause.toLowerCase()];
      continue;
    }

    const gate = new RegExp(`^gate\\s+(${NUM})$`, 'i').exec(clause);
    if (gate) {
      patch.gate = Number(gate[1]);
      continue;
    }

    const vel = new RegExp(`^velocity\\s+(${NUM})$`, 'i').exec(clause);
    if (vel) {
      patch.velocity = Number(vel[1]);
      continue;
    }

    const rawCc = new RegExp(`^cc\\s*(\\d+)\\s+(${NUM})$`, 'i').exec(clause);
    if (rawCc) {
      addCc(parseInt(rawCc[1], 10), Number(rawCc[2]));
      continue;
    }

    const named = new RegExp(`^([a-z][a-z0-9_]*)\\s+(${NUM})$`, 'i').exec(clause);
    if (named && controls[named[1].toLowerCase()] !== undefined) {
      addCc(controls[named[1].toLowerCase()], Number(named[2]));
      continue;
    }

    try {
      parseScale(clause);
      patch.scale = clause;
      continue;
    } catch {
      // Not a scale either — fall through to the error below.
    }
    throw new Error(
      `Unknown set clause "${clause}" — expected a scale ("g lydian"), an octave ` +
        `("oct up"), "tempo 60 over 2", an articulation ("legato", "gate 1.05"), ` +
        `"velocity 90", or a control ("cc74 30", or a name from \`controls\`).`,
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

/** Is this token an inline `||…||` set directive? */
export function isSetToken(token: string): boolean {
  return token.startsWith('||');
}

/** "||g lyd, oct up||" → "g lyd, oct up". */
export function setTokenBody(token: string): string {
  return token.slice(2, token.endsWith('||') ? -2 : undefined).trim();
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
    if (depth === 0 && ch === '|' && text[i + 1] === '|') {
      flush();
      const close = text.indexOf('||', i + 2);
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
}

/**
 * Recursively place one token in [start, start+span):
 * rests emit nothing, chords stack, groups subdivide equally.
 */
function placeToken(token: string, start: number, span: number, ctx: EmitCtx): void {
  const tok = token.trim();
  if (!tok || tok === '~') return;

  if (tok[0] === '[' && tok[tok.length - 1] === ']') {
    for (const part of splitTopLevel(tok.slice(1, -1))) {
      placeToken(part, start, span, ctx);
    }
    return;
  }

  if (tok[0] === '{' && tok[tok.length - 1] === '}') {
    const parts = splitTopLevel(tok.slice(1, -1));
    if (parts.length === 0) return;
    const sub = span / parts.length;
    parts.forEach((part, i) => placeToken(part, start + i * sub, sub, ctx));
    return;
  }

  const midi = /^-?\d/.test(tok)
    ? degreeToMidi(tok, ctx.scale, ctx.octave)
    : noteToMidi(tok, ctx.octave);
  if (midi === null) return; // unknown token → treat as a rest, stay robust
  ctx.events.push({
    time: round(start),
    pitch: midiToName(midi),
    duration: round(span * ctx.gate),
    velocity: ctx.velocity,
    midi,
  });
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
    if (!text) return;
    out.push({ text, index: m });
    if (splitTopLevel(text).some((t) => !isSetToken(t))) m++;
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
}

/**
 * Compile one track's measures. Each measure is divided equally among its
 * top-level tokens. Mapping items and `||…||` tokens act as directives: they
 * update the running scale/octave/velocity/gate, and emit control or tempo
 * events at the beat where they appear, without advancing time.
 */
export function parsePlayFull(play: PlayInput, props: TrackProps = {}): PlayResult {
  const measureBeats = measureToBeats(props.measure);
  const controlAliases = props.controls ?? {};
  const ctx: EmitCtx = {
    events: [],
    scale: parseScale(props.scale),
    octave: props.octave ?? DEFAULT_OCTAVE,
    velocity: Math.max(1, Math.min(127, props.velocity ?? DEFAULT_VELOCITY)),
    gate: props.gate ?? DEFAULT_GATE,
  };
  const controls: ControlEvent[] = [];
  const tempos: TempoEvent[] = [];

  const applyPatch = (patch: SetPatch, at: number) => {
    if (patch.scale) ctx.scale = parseScale(patch.scale);
    if (patch.octave !== undefined) ctx.octave = patch.octave;
    if (patch.octaveDelta) ctx.octave += patch.octaveDelta;
    if (patch.velocity !== undefined) {
      ctx.velocity = Math.max(1, Math.min(127, patch.velocity));
    }
    if (patch.gate !== undefined) ctx.gate = patch.gate;
    if (patch.tempo) {
      tempos.push({
        time: round(at),
        bpm: patch.tempo.bpm,
        rampBeats: round(patch.tempo.overMeasures * measureBeats),
      });
    }
    for (const c of patch.ccs ?? []) {
      controls.push({ time: round(at), cc: c.cc, value: c.value });
    }
  };

  const applySet = (value: string | string[], at: number) =>
    applyPatch(parseSet(value, controlAliases), at);

  let m = 0;
  const compileMeasure = (raw: string) => {
    const measure = raw.trim();
    if (!measure) return;
    const tokens = splitTopLevel(measure);
    const noteTokens = tokens.filter((t) => !isSetToken(t));
    if (noteTokens.length === 0) {
      // A directive-only line changes state but is not a measure.
      for (const tok of tokens) applySet(setTokenBody(tok), m * measureBeats);
      return;
    }
    const step = measureBeats / noteTokens.length;
    let slot = 0;
    for (const tok of tokens) {
      const at = m * measureBeats + slot * step;
      if (isSetToken(tok)) {
        applySet(setTokenBody(tok), at);
      } else {
        placeToken(tok, at, step, ctx);
        slot++;
      }
    }
    m++;
  };

  for (const item of playItems(play)) {
    if (item && typeof item === 'object') {
      const at = m * measureBeats;
      if (item.scale !== undefined) ctx.scale = parseScale(item.scale);
      if (item.octave !== undefined) ctx.octave = item.octave;
      if (item.velocity !== undefined) {
        ctx.velocity = Math.max(1, Math.min(127, item.velocity));
      }
      if (item.gate !== undefined) ctx.gate = item.gate;
      if (item.tempo !== undefined) tempos.push({ time: round(at), bpm: item.tempo, rampBeats: 0 });
      if (item.set !== undefined) applySet(item.set, at);
      for (const [key, value] of Object.entries(item)) {
        if (/^\d+$/.test(key) && typeof value === 'string') {
          const target = parseInt(key, 10) - 1;
          if (target >= 0) m = target; // numbered measure: jump to its slot
          compileMeasure(value);
        }
      }
      continue;
    }
    compileMeasure(String(item));
  }

  ctx.events.sort((a, b) => a.time - b.time || a.midi - b.midi);
  controls.sort((a, b) => a.time - b.time);
  tempos.sort((a, b) => a.time - b.time);
  return { timeline: ctx.events, controls, tempos };
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
  'gate', 'controls',
];

function effectiveProps(node: TrackNode, inherited: TrackProps): TrackProps {
  const props: TrackProps = { ...inherited };
  for (const key of INHERITED) {
    if (node[key] !== undefined) (props as any)[key] = node[key];
  }
  if (node.set !== undefined) {
    const patch = parseSet(node.set);
    if (patch.scale) props.scale = patch.scale;
    if (patch.octave !== undefined) props.octave = patch.octave;
    if (patch.octaveDelta) props.octave = (props.octave ?? DEFAULT_OCTAVE) + patch.octaveDelta;
  }
  return props;
}

/** Length in measures — the furthest slot a sounding measure occupies. */
function playedMeasureCount(play: PlayInput): number {
  let max = 0;
  for (const e of playMeasureEntries(play)) {
    if (splitTopLevel(e.text).some((t) => !isSetToken(t))) max = Math.max(max, e.index + 1);
  }
  return max;
}

/**
 * Compile a document (which is itself a track) into flat per-track timelines.
 */
export function compileDoc(doc: SongDoc): CompiledSong {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Score must be a mapping with a "play:" or "tracks:" key.');
  }

  const rootProps = effectiveProps(doc, {
    tempo: DEFAULT_TEMPO,
    measure: DEFAULT_MEASURE,
    sample: DEFAULT_SAMPLE,
    octave: DEFAULT_OCTAVE,
    velocity: DEFAULT_VELOCITY,
  });

  const tracks: CompiledTrack[] = [];
  const tempoMap: TempoEvent[] = [];
  let lengthBeats = 0;
  let nextChannel = 1;

  const walk = (node: TrackNode, name: string, inherited: TrackProps) => {
    const props = node === doc ? rootProps : effectiveProps(node, inherited);

    if (node.play != null) {
      const { timeline, controls, tempos } = parsePlayFull(node.play, props);
      const measureBeats = measureToBeats(props.measure);
      lengthBeats = Math.max(lengthBeats, playedMeasureCount(node.play) * measureBeats);
      const sample = props.sample ?? DEFAULT_SAMPLE;
      // Tempo belongs to the song, not a voice — merge every track's changes.
      tempoMap.push(...tempos);
      tracks.push({
        name,
        channel: props.channel ?? nextChannel++,
        sample,
        program: props.program ?? SAMPLE_PROGRAMS[sample.toLowerCase()],
        timeline,
        controls,
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
