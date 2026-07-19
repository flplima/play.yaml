'use strict';

/**
 * parser.ts — The Notation → Timeline Matrix core in TypeScript.
 */

export interface TimelineEvent {
  time: number;
  pitch: string;
  duration: number;
  velocity: number;
  midi: number;
}

export interface SongConfig {
  root?: string;
  scale?: string;
  octave?: number;
}

export interface ParseOptions {
  beatsPerMeasure?: number;
}

export interface TrackInput {
  name?: string;
  channel?: number;
  program?: number;
  config?: SongConfig;
  measures?: string[];
  beatsPerMeasure?: number;
}

export interface SongDoc {
  meta?: {
    title?: string;
    composer?: string;
    bpm?: number;
    [key: string]: any;
  };
  options?: {
    beatsPerMeasure?: number;
  };
  key?: {
    root?: string;
    scale?: string;
  };
  tracks?: TrackInput[];
}

export interface CompiledTrack {
  name: string;
  channel: number;
  program?: number;
  timeline: TimelineEvent[];
}

export interface CompiledSong {
  meta: Record<string, any>;
  options: {
    beatsPerMeasure: number;
  };
  bpm: number;
  key: {
    root: number;
    rootName: string;
    scale: string;
    intervals: number[];
  };
  tracks: CompiledTrack[];
}

interface State {
  dynamic: string;
  rootPc: number;
  octave: number;
  scale: string;
}

// ---------------------------------------------------------------------------
// Tunable constants — the "feel" of the engine lives here.
// ---------------------------------------------------------------------------

export const BEATS_PER_MEASURE = 4; // 4/4 time signature

// Note-name pitch classes and the canonical (sharp) spelling for output.
const PITCH_CLASSES = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Scale-degree interval tables (semitones above the root, degrees 1..7).
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

// Dynamics → baseline MIDI velocity.
export const DYNAMICS = { pp: 30, p: 45, mp: 60, mf: 75, f: 90, ff: 110 };
const DEFAULT_DYNAMIC = 'mf';

// Articulation → gate ratio (fraction of the step length the note actually sounds).
export const GATE = {
  normal: 0.8, // detached-but-connected default
  staccato: 0.3, // "." — clipped short
  legato: 0.95, // "-"  – held right up to the next step
};

export const ACCENT_BUMP = 20; // "!" transient velocity spike

// ---------------------------------------------------------------------------
// Small pitch helpers
// ---------------------------------------------------------------------------

/** Round to 6 decimals to keep triplet math (1/3) from leaking float noise. */
function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** "C4" / "F#3" / "Bb2" → MIDI note number (C4 = 60 convention). */
export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])(#|b)?(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  let pc = PITCH_CLASSES[m[1].toUpperCase() as keyof typeof PITCH_CLASSES];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + pc;
}

/** MIDI note number → canonical sharp name ("G3"). */
export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return NAMES_SHARP[pc] + octave;
}

/** Root spelled as a bare letter ("g", "g#", "Bb") → pitch class 0..11. */
export function rootPitchClass(root: string): number {
  const m = /^([A-Ga-g])(#|b)?$/.exec(root.trim());
  if (!m) return 0;
  let pc = PITCH_CLASSES[m[1].toUpperCase() as keyof typeof PITCH_CLASSES];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/** 1-based scale degree → MIDI number, given the current tonal context. */
export function degreeToMidi(degree: number, state: State): number {
  const intervals = SCALES[state.scale as keyof typeof SCALES] || SCALES.major;
  const semis = intervals[(degree - 1) % 7];
  return (state.octave + 1) * 12 + state.rootPc + semis;
}

// ---------------------------------------------------------------------------
// Token-level parsing (suffixes, atoms, beats)
// ---------------------------------------------------------------------------

// A note "atom" is a pitch core followed by any number of suffix characters.
// Core: an absolute pitch (C4, F#3, Bb2) OR a single scale degree 1..7.
const CORE_RE = /^([A-Ga-g](?:#|b)?-?\d+|[1-7])/;

export interface SuffixResult {
  octShift: number;
  artic: 'staccato' | 'legato' | null;
  accent: boolean;
}

/**
 * Decode a suffix string into modifiers.
 *   > or ^  → octave up      < → octave down
 *   .       → staccato       - → legato
 *   !       → micro-accent
 * `artic` stays null when unspecified so callers can fall back to a group/default.
 */
export function parseSuffix(suffix: string): SuffixResult {
  let octShift = 0;
  let artic: 'staccato' | 'legato' | null = null;
  let accent = false;
  for (const ch of suffix) {
    if (ch === '>' || ch === '^') octShift += 1;
    else if (ch === '<') octShift -= 1;
    else if (ch === '!') accent = true;
    else if (ch === '.') artic = 'staccato';
    else if (ch === '-') artic = 'legato';
  }
  return { octShift, artic, accent };
}

export interface AtomResult {
  midi: number;
  artic: 'normal' | 'staccato' | 'legato';
  accent: boolean;
}

/**
 * Parse one note atom into { midi, artic, accent }, or null for a rest / any
 * token with no recognizable pitch core (e.g. "~" or a stray ".").
 * `group` carries defaults inherited from an enclosing [..] / {..} suffix.
 */
export function parseAtom(token: string, state: State, group: SuffixResult | null): AtomResult | null {
  const tok = token.trim();
  if (!tok || tok === '~') return null;

  const coreMatch = CORE_RE.exec(tok);
  if (!coreMatch) return null; // robust fallback: unknown token → rest
  const core = coreMatch[1];
  const s = parseSuffix(tok.slice(core.length));

  let parsedMidi = /^[1-7]$/.test(core)
    ? degreeToMidi(parseInt(core, 10), state)
    : nameToMidi(core);
  if (parsedMidi === null) return null;

  parsedMidi += (s.octShift + (group ? group.octShift : 0)) * 12;

  const artic = s.artic || (group && group.artic) || 'normal';
  const accent = s.accent || (group ? group.accent : false);
  return { midi: parsedMidi, artic, accent };
}

/** Turn a parsed atom into a timeline event and push it. No-op for rests. */
function emit(events: TimelineEvent[], atom: AtomResult | null, time: number, step: number, state: State): void {
  if (!atom) return;
  const duration = step * GATE[atom.artic];
  let velocity = DYNAMICS[state.dynamic as keyof typeof DYNAMICS] !== undefined
    ? DYNAMICS[state.dynamic as keyof typeof DYNAMICS]
    : DYNAMICS[DEFAULT_DYNAMIC as keyof typeof DYNAMICS];
  if (atom.accent) velocity += ACCENT_BUMP;
  velocity = Math.max(1, Math.min(127, velocity));
  events.push({
    time: round(time),
    pitch: midiToName(atom.midi),
    duration: round(duration),
    velocity,
    midi: atom.midi,
  });
}

/**
 * Parse a single beat token starting at absolute time `beatStart`.
 *   [a,b,c]  chord        — all atoms at beatStart, each a full-beat step
 *   {a,b,c}  subdivision  — beat split equally among atoms (tuplets)
 *   single   one note filling the beat
 * A trailing suffix on the bracket/brace ("{..}." , "[..]-") applies to the group.
 */
function parseBeat(token: string, state: State, beatStart: number, events: TimelineEvent[]): void {
  const tok = token.trim();
  if (!tok || tok === '~') return;

  if (tok[0] === '[') {
    const end = tok.indexOf(']');
    const group = parseSuffix(tok.slice(end + 1));
    for (const part of tok.slice(1, end).split(',')) {
      emit(events, parseAtom(part, state, group), beatStart, 1.0, state);
    }
    return;
  }

  if (tok[0] === '{') {
    const end = tok.indexOf('}');
    const group = parseSuffix(tok.slice(end + 1));
    const atoms = tok.slice(1, end).split(',');
    const step = 1.0 / atoms.length;
    atoms.forEach((part, i) => {
      emit(events, parseAtom(part, state, group), beatStart + i * step, step, state);
    });
    return;
  }

  emit(events, parseAtom(tok, state, null), beatStart, 1.0, state);
}

// ---------------------------------------------------------------------------
// Measure header directives
// ---------------------------------------------------------------------------

/**
 * Apply a measure header (everything left of "::") to the running state.
 * Directives are separated by whitespace or single colons: "f:g:minor".
 *   dynamic (pp..ff) | scale (major|minor) | root note (c, d, g#, ...)
 * Dynamics win over note-letter roots on collision (e.g. "f" = forte, not F).
 */
function applyHeader(header: string, state: State): void {
  for (const raw of header.split(/[\s:]+/)) {
    const d = raw.trim().toLowerCase();
    if (!d) continue;
    if (DYNAMICS[d as keyof typeof DYNAMICS] !== undefined) state.dynamic = d;
    else if (d === 'major' || d === 'minor') state.scale = d;
    else if (/^[a-g](#|b)?$/.test(d)) state.rootPc = rootPitchClass(d);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile notation strings into the timeline matrix.
 */
export function parseSong(trackData: string[], songConfig: SongConfig = {}, opts: ParseOptions = {}): TimelineEvent[] {
  const beatsPerMeasure = opts.beatsPerMeasure || BEATS_PER_MEASURE;

  const state: State = {
    dynamic: DEFAULT_DYNAMIC,
    rootPc: rootPitchClass(songConfig.root || 'C'),
    octave: songConfig.octave !== undefined ? songConfig.octave : 4,
    scale: songConfig.scale || 'major',
  };

  const events: TimelineEvent[] = [];

  trackData.forEach((line, measureIndex) => {
    let notes = String(line);
    const sep = notes.indexOf('::');
    if (sep !== -1) {
      applyHeader(notes.slice(0, sep), state);
      notes = notes.slice(sep + 2);
    }

    const beats = notes.trim().split(/\s+/).filter(Boolean);
    if (beats.length !== beatsPerMeasure) {
      throw new Error(
        `Measure ${measureIndex + 1}: expected ${beatsPerMeasure} beats but got ` +
          `${beats.length} — "${line}"`,
      );
    }

    const measureStart = measureIndex * beatsPerMeasure;
    beats.forEach((tok, b) => parseBeat(tok, state, measureStart + b, events));
  });

  events.sort((a, b) => a.time - b.time || a.midi - b.midi);
  return events;
}

/**
 * Compile a multitrack song document into per-track timelines.
 */
export function compileDoc(doc: SongDoc): CompiledSong {
  const meta = doc.meta || {};
  const beatsPerMeasure = (doc.options && doc.options.beatsPerMeasure) || BEATS_PER_MEASURE;
  const tracksIn = doc.tracks || [];
  const tracks = tracksIn.map((t, i) => ({
    name: t.name || `Track ${i + 1}`,
    channel: t.channel !== undefined ? t.channel : i + 1,
    program: t.program,
    timeline: parseSong(t.measures || [], t.config || {}, {
      beatsPerMeasure: t.beatsPerMeasure || beatsPerMeasure,
    }),
  }));

  const cfg0 = (tracksIn[0] && tracksIn[0].config) || {};
  const docKey = doc.key || {};
  const rootName = docKey.root || cfg0.root || 'C';
  const scaleName = SCALES[docKey.scale as keyof typeof SCALES || cfg0.scale as keyof typeof SCALES]
    ? docKey.scale || cfg0.scale || 'major'
    : 'major';
  const key = {
    root: rootPitchClass(rootName),
    rootName: String(rootName).toUpperCase(),
    scale: scaleName,
    intervals: SCALES[scaleName as keyof typeof SCALES],
  };
  return { meta, options: { beatsPerMeasure }, bpm: meta.bpm || 120, key, tracks };
}
