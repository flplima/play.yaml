'use strict';

/**
 * song.ts — the compiler: measure strings + track props → per-track timelines
 * of notes, control changes and tempo changes, and whole documents (recursive
 * tracks with prop inheritance) → a CompiledSong.
 */

import {
  DEFAULT_MEASURE, DEFAULT_OCTAVE, ScaleInfo, degreeToMidi, isDegreeToken, measureToBeats,
  chordNotes, letterSpelling, notatedMeter, midiToName, noteToMidi, parseScale,
} from './theory';
import {
  ACCENT_STEP, ControlSpec, DEFAULT_GATE, DEFAULT_STRUM, DRUM_CHANNEL, PedalPattern,
  controlValue, presetProgram, drumName, resolveControl, resolveDrum,
} from './vocabulary';
import { SetPatch, isDirectiveString, parseSet } from './set';
import {
  HOLD, REST, commentStart, divideByWeight, isMarkToken, isScaleToken, peelSuffix, setTokenBody, splitTopLevel, stripComment,
} from './tokens';
import {
  ArpSpec, DEFAULT_SEED, HumanizeSpec, SpreadSpec, WalkSpec, WalkState,
  expandArp, expandSpread, expandWalk, hash01, normalizeHumanize,
} from './generate';

/** Every `time`, `duration` and `rampBeats` below is in quarter-note beats. */
export interface TimelineEvent {
  time: number;
  pitch: string;
  duration: number;
  velocity: number;
  midi: number;
  /**
   * Written compile only: a drum roll (`sd~`) kept as one note, with how many
   * `~` marks it carried. A performance compile retriggers the hits instead,
   * and never sets this.
   */
  roll?: number;
  /**
   * Written compile only: the letter and alteration a note named by letter
   * was written with (`d#4` is D sharp, `eb4` E flat), so sheet music prints
   * it as written. Degrees leave it unset; notation spells those itself.
   */
  spelling?: { letter: string; alter: number };
}

/** Properties a track passes down to its children. */
export interface TrackProps {
  tempo?: number;
  measure?: string | number; // "4/4" or a plain beat count
  preset?: string;
  scale?: string; // "g major", "a minor" — the key for degree tokens
  octave?: number;
  /**
   * Semitones added to every pitch this track sounds, after the notes are
   * read. `octave:` cannot do this job: it is the octave a *bare* note name
   * defaults to, so a line written in absolute pitches (`e4 f4 g4`) ignores
   * it entirely. Transposition is what voicing the same line on a different
   * instrument needs — `transpose: -12` puts a violin melody on a cello
   * without touching a single written note, and the score still reads as the
   * composer wrote it.
   *
   * Kit tracks are left alone: a drum token names a GM percussion key, and
   * shifting it would pick a different instrument rather than a lower pitch.
   */
  transpose?: number;
  channel?: number;
  program?: number;
  velocity?: number;
  /**
   * Fraction of its slot a note sounds. Below 1 the note releases before the
   * next begins (detached); above 1 they overlap, which is how a physical
   * model is told to play a slur rather than re-attack.
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
   * stop, and what a physical model needs to voice every note.
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
  /**
   * Rubato — "stolen time" — as a depth from 0 (strict) to 1 (very free).
   * The beat breathes inside each bar: the notes after a downbeat lean late,
   * then hurry to arrive on the next one. What is stolen is paid back by the
   * bar line, so bars never drift and parts stay together — that is what
   * separates rubato from a tempo change. The worded marks ("rubato",
   * "molto rubato", "a battuta") set it too.
   */
  rubato?: number;
  /** A dynamic or character mark ("mf", "dolce") — the worded form of `velocity`. */
  dynamic?: string;
  /**
   * Remap this track's velocities into a band, so the dynamic marks keep
   * their written meaning while the instrument plays in a usable part of its
   * range. A solo line over a busy accompaniment is the usual reason: leave
   * the score's `pianissimo` where the composer put it and lift the band
   * instead of rewriting the marks.
   *
   * Takes the same shapes as a control `range:` — the whole 0..127 velocity
   * domain is mapped through it:
   *   velocityRange: 100             → 0 … 100   (a ceiling)
   *   velocityRange: [64, 112]       → 64 … 112  (a band; write it backwards
   *                                   to invert)
   *   velocityRange: [0, 40, 90, 112] → a curve through those breakpoints
   *
   * Applies to note velocities only, after accents and humanize, so nothing
   * escapes the band. An `expression` control keeps its own range.
   */
  velocityRange?: number | number[];
  /** An articulation mark ("legato", "tenuto") — the worded form of `gate`. */
  articulation?: string;
  /**
   * How a sustained voice lets go into a rest.
   *
   * A bowed or blown line does not stop dead at a pause: the player eases off
   * over the last part of the note. On a physical model that easing *is* the
   * expression control falling away — a note-off at full bow speed is the
   * sound of a tape being cut, which is exactly what a written rest should
   * not sound like. So this rides the track's `expression` control down over
   * the tail of the last note before every pause, and puts it back where it
   * was for the next phrase.
   *
   * Needs an `expression` control to do anything; without one there is
   * nothing to ease off. Notes that merely change (a slur, a legato overlap)
   * are untouched — only a real silence counts.
   *
   *   release: 0.5                          → taper over the last half-beat
   *   release: { over: 0.75, to: 0.2 }      → longer, and not quite to nothing
   *   release: { over: 0.5, gap: 1 }        → only into pauses of a beat or more
   *
   * `to` is a position along the expression control's own range (0 = its
   * floor), so a control declared `range: [78, 127]` still releases to 78 —
   * the quietest this instrument speaks at, not silence.
   */
  release?: number | { over?: number; to?: number; gap?: number };
  /**
   * Names a drum kit ("acoustic", "808", "percussion") and switches the
   * track's tokens from pitches to drum names: `bd hh sd hh` instead of
   * notes. Kit tracks default to MIDI channel 10 (GM percussion) and take no
   * program change. A `~` suffix rolls a hit (`sd~` = snare roll); scale and
   * octave are ignored. (`kit: 808` arrives as a YAML number — both work.)
   */
  kit?: string | number;
  /**
   * Named MIDI controls: alias → CC number, or → `{ cc, range }` when the
   * instrument's mapping uses a narrower band, runs the other way round, or
   * is not linear. See ControlSpec for the range forms.
   */
  controls?: Record<string, number | ControlSpec>;
  /**
   * A pedalling pattern that runs until something cancels it — the worded
   * form ("pedale sincopato", "pedal per bar") sets this from `set:`.
   */
  pedal?: PedalPattern | null;
  /**
   * Seed for every stochastic feature (`chance`, `humanize`, seeded
   * generators). The same file always compiles to the same MIDI; change the
   * seed to browse variations. Default 1.
   */
  seed?: number;
  /**
   * Probability (0..1) that each struck note actually sounds. Dropped notes
   * stay silent but keep their time slot, so the groove never shifts.
   * Deterministic per (seed, time, pitch). Default 1 — everything plays.
   */
  chance?: number;
  /**
   * Seeded timing/velocity jitter, applied at compile time: an intensity
   * 0..1 (1 ≈ ±0.03 beats, ±10 velocity) or explicit
   * `{time: beats, velocity: steps}`.
   */
  humanize?: number | { time?: number; velocity?: number };
}

/** A control-change emitted at a point in the timeline. */
export interface ControlEvent {
  time: number;
  cc: number;
  value: number;
}

/** A tempo change; `rampBeats` > 0 makes it a gradual rit./accel. */
export interface TempoEvent {
  time: number;
  bpm: number;
  rampBeats: number;
}

/**
 * The track props a play-list directive item (or a section track) may change
 * mid-score. Everything else — the instrument, its channel, its controls —
 * is declared once on the track.
 */
export const DIRECTIVE_PROPS = [
  'scale', 'octave', 'velocity', 'gate', 'rubato', 'tempo', 'measure', 'strum', 'voices',
  'seed', 'chance', 'humanize',
] as const;
export type DirectiveProp = (typeof DIRECTIVE_PROPS)[number];

/**
 * A mapping item inside a `play` list. Named keys change the running note
 * props from that point on without advancing time (e.g. `- scale: d major`
 * or `- set: 'g lyd, oct up'`). Numeric keys are numbered measures: the key
 * states the 1-based measure the string occupies (`- 5: "1 2 3 4"`), so
 * measures can be labeled explicitly and gaps become silence.
 */
export type PlayDirective = Pick<TrackProps, DirectiveProp> & {
  set?: string | string[];
  [measure: number]: string | undefined;
};

/**
 * A generator item inside a `play` list — expands to one ordinary measure
 * string before compilation (docs/generative-design.md):
 *
 *   - spread: {steps: 16, bd: 5, hh: [13, 2]}   # euclidean rhythm layers
 *   - arp: {chord: Dm7, mode: updown, steps: 8} # chord tones over the bar
 *   - walk: {steps: 8, start: 1}                # seeded walk over the scale
 */
export interface PlayGenerator {
  spread?: SpreadSpec;
  arp?: ArpSpec;
  walk?: WalkSpec;
}

/**
 * Per-pass variation inside an `Nx:` repeat (or a `loop: N` section): each
 * pass plays the next entry, cycling. Entries are measure strings or
 * generator items — one bar each.
 *
 *   - 4x:
 *       - "bd ~ sd ~"
 *       - alternate: ["hh hh hh hh", "hh hh {hh hh hh}"]
 */
export interface PlayAlternate {
  alternate: (string | PlayGenerator)[];
}

/**
 * An inline repeat inside a `play` list — sugar that expands before
 * compilation. The count lives in the key, the measures in the value:
 *
 *   - 8x: "{eb2 _ [gb3 bb3 eb4]} {~ ~ eb2} [gb3 bb3 eb4] bb2 [f3 ab3 db4]"
 *   - 2x: ["1 2 3 4", "5 4 3 2"]     # a list works too; repeats nest
 *
 * `0x:` skips its content. The forever loop belongs to `sections:`.
 */
export interface PlayRepeat {
  [times: `${number}x`]: PlayInput | undefined;
}

export type PlayInput =
  string | (string | PlayDirective | PlayRepeat | PlayGenerator | PlayAlternate)[];

export interface TrackNode extends TrackProps {
  title?: string; // meaningful at the root
  /**
   * Bars of silence before this track's music starts. A child adds its own
   * wait to its parent's, so a group of tracks can enter together.
   */
  wait?: number;
  /**
   * The words, one syllable per struck note in order: `A- ve Ma- ri- a`.
   * A trailing `-` joins a syllable to the next one; `_` lets a note pass
   * with no new syllable (a melisma). Line breaks are free.
   */
  lyrics?: string;
  set?: string | string[]; // shorthand prop patch, applied after own props
  play?: PlayInput;
  tracks?: Record<string, TrackNode>;
}

/**
 * One instrument's part inside a section: a `play` list, an optional `wait`
 * (measures of silence before it enters — first pass only), plus any of the
 * directive-expressible props (velocity, gate, scale, octave, …) to override
 * for this section's span.
 */
export interface SectionTrack extends Pick<TrackProps, DirectiveProp> {
  /** Measures to rest before entering the section. Applies once, never on loops. */
  wait?: number;
  set?: string | string[];
  play?: PlayInput;
}

/**
 * A named section of the song. Sections play in declaration order.
 * `loop: true` (the default) marks the part of the song that repeats forever
 * — those sections must be the tail of the document. `loop: N` plays the
 * section N times in a row (0 skips it); `loop: false` plays it once.
 * All other keys are instrument tracks.
 */
export type SectionNode =
  Record<string, SectionTrack | boolean | number | undefined> & {
    loop?: boolean | number;
    wait?: number;
  };

/** Which metronome marks sheet music prints: every change, the opening one, or none. */
export type MetronomeMarks = 'all' | 'opening' | 'none';

/**
 * Header keys only the printed score reads (notation.ts); compiling ignores
 * them, so they never change what plays.
 */
export interface PrintHeader {
  /** Printed top right, under the title. */
  composer?: string;
  /**
   * The key signature: `g major`, or bar numbers to keys for real key
   * changes (`{ 1: db major, 37: e major }`). Defaults to the first `scale:`.
   */
  key?: string | Record<string, string>;
  /** Tempo words printed over the first bar ("Andante semplice"). */
  'tempo text'?: string;
  /** Default `all`. */
  'metronome marks'?: MetronomeMarks;
}

export type SongDoc = TrackNode & PrintHeader & { sections?: Record<string, SectionNode> };

/**
 * One measure of a track as written, from a written compile (`{ written: true }`).
 * Notation needs what the timeline alone cannot say: where the bar lines
 * fall once the meter changes, how the meter was spelled (6/8 and 3/4 are
 * both three beats) and which key the bar is in.
 */
export interface BarInfo {
  /** Where the measure starts, in quarter-note beats. */
  start: number;
  /** Its length in quarter-note beats. */
  beats: number;
  /** The meter as notated: "6/8", "3/4". A plain beat count reads as quarters ("5/4"). */
  meter: string;
  /**
   * The track's key in force, as written ("eb major"). Only `scale:` props,
   * directives and `set` clauses move it; an `==Dm7==` chord-scale token
   * changes the degrees, not the key signature.
   */
  scale: string;
}

/**
 * How to compile. The default is a performance: everything the score says
 * about *how* to play (gate, humanize, rubato, strums, bow release) shapes
 * the timeline.
 */
export interface CompileOptions {
  /**
   * Compile the notes as written instead: every note lasts its full slot
   * (gate 1, holds merged), with no humanize, rubato warp, strum spread,
   * voices cut, same-pitch trim or bow release, and a drum roll stays one
   * note. `chance` and generators still expand exactly as in a performance,
   * so the two compiles agree on which notes exist. Tracks also carry their
   * bar map (`bars`). This is what sheet music is drawn from.
   */
  written?: boolean;
}

export interface CompiledTrack {
  name: string;
  channel: number;
  preset: string;
  /** The drum kit this track plays, when it is a `kit:` track. */
  kit?: string;
  program?: number;
  timeline: TimelineEvent[];
  /** CC changes declared mid-song, in beat order. */
  controls: ControlEvent[];
  /** Written compile only: one entry per measure, numbered measures' gaps included. */
  bars?: BarInfo[];
  /**
   * Written compile only: the name of the track this one is nested in, when
   * it sits under another track rather than directly under the document.
   * Notation names a merged keyboard part after it.
   */
  parent?: string;
  /** The words under the notes, from `lyrics:`, one syllable per struck note. */
  lyrics?: Lyric[];
}

/** How a syllable sits in its word, in MusicXML's terms. */
export type Syllabic = 'single' | 'begin' | 'middle' | 'end';

export interface Lyric {
  /** The beat of the note it is sung on. */
  time: number;
  text: string;
  syllabic: Syllabic;
}

export interface CompiledSong {
  title?: string;
  bpm: number;
  measureBeats: number;
  /**
   * The meter as notated ("12/8"), carried only when the beat count alone
   * would lose it — 12/8 and 6/4 are both 6 beats, and the `.mid` export
   * writes a time signature that a re-import reads back. Simple meters
   * (4/4, 3/4, 3/8, 9/8) are recoverable from `measureBeats`, so they are
   * left undefined rather than moving every score's compiled shape.
   */
  measureSig?: string;
  /** Song length in beats — the longest track, whole measures. */
  lengthBeats: number;
  /**
   * Where the forever-loop begins, in beats, when the document's sections
   * declare one (everything before it — the intro — plays once). Undefined =
   * no loop declared; players fall back to looping the whole song.
   */
  loopStartBeats?: number;
  /** Tempo changes in beat order; empty when the song holds one tempo. */
  tempoMap: TempoEvent[];
  tracks: CompiledTrack[];
  /**
   * Non-fatal compile notes — tokens that read as nothing and became silence,
   * tagged with their bar. A score with these still plays; they exist so a
   * typo in a mark or a pitch is visible instead of just sounding wrong.
   */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPO = 80;
export const DEFAULT_PRESET = 'piano';
export const DEFAULT_VELOCITY = 90;

/** Round to 6 decimals to keep equal-division math (1/3, 1/6…) stable. */
function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

const clampVelocity = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

// ---------------------------------------------------------------------------
// Token placement
// ---------------------------------------------------------------------------

interface EmitCtx {
  events: TimelineEvent[];
  /** Kit track: tokens are drum names / raw GM keys, not pitches. */
  drums: boolean;
  scale: ScaleInfo;
  octave: number;
  /** Semitones added to every pitch, after the token is read. */
  transpose: number;
  velocity: number;
  gate: number;
  /** Beats between successive notes of a `~`-rolled chord. */
  strum: number;
  /** Sustained-note limit inside rolled chords (0 = unlimited). */
  voices: number;
  /** Release tail for voices-limited notes, in beats; undefined = auto. */
  strumTail?: number;
  /** Rubato depth, 0 (strict) to 1 (very free). */
  rubato: number;
  /** Active crescendo/diminuendo; notes inside the span interpolate. */
  velocityRamp?: { fromBeat: number; toBeat: number; from: number; to: number };
  /** The notes a `_` would prolong, and how much time they cover so far. */
  held?: { events: TimelineEvent[]; span: number } | null;
  /** Tokens that read as nothing, collected rather than thrown. */
  warnings: string[];
  /** 1-based measure being compiled, so a warning can name it. */
  measureNumber: number;
  /** Seed for chance/humanize — same seed, same compiled song. */
  seed: number;
  /** Probability each struck note sounds (1 = always). */
  chance: number;
  /** Seeded timing/velocity jitter; unset = play exactly as written. */
  humanize?: HumanizeSpec;
  /** Written compile: notes as notated, no performance shaping. */
  written: boolean;
}

/** Should this note be dropped by the running `chance`? Deterministic. */
function dropByChance(ctx: EmitCtx, start: number, midi: number): boolean {
  if (ctx.chance >= 1) return false;
  return hash01(ctx.seed, Math.round(start * 1e6), midi, 15485863) >= ctx.chance;
}

/** Seeded humanize offsets for a note (zero when humanize is off). */
function humanizeOffsets(ctx: EmitCtx, start: number, midi: number): { dt: number; dv: number } {
  const h = ctx.humanize;
  if (!h || (h.time === 0 && h.velocity === 0)) return { dt: 0, dv: 0 };
  const t6 = Math.round(start * 1e6);
  return {
    dt: (hash01(ctx.seed, t6, midi, 7919) * 2 - 1) * h.time,
    dv: (hash01(ctx.seed, t6, midi, 104729) * 2 - 1) * h.velocity,
  };
}

/**
 * The deepest a bar may lean, as a fraction of its own length, at `rubato: 1`.
 * Roughly an eighth of a beat in 2/4 — the edge of expressive, not sloppy.
 */
const RUBATO_DEPTH = 0.08;

/**
 * Where a point inside a bar actually falls once the beat breathes.
 *
 * `u` is the position within the measure (0 = this downbeat, 1 = the next) and
 * the answer is the same measure re-read expressively. The shift is a sine over
 * the bar, so it vanishes at both bar lines: **time stolen early is paid back by
 * the end of the measure**, and bars — and the other parts — never drift. That
 * is the whole difference between rubato and a tempo change.
 *
 * Within the bar the first half leans late (the player lingers just after the
 * downbeat) and the second half hurries to arrive on the next one. A slow arch
 * across four bars varies the depth, so consecutive bars do not breathe in
 * lockstep and the line still phrases rather than wobbling.
 *
 * The curve is monotonic for every depth ≤ 1 (its slope bottoms out near 0.5),
 * so notes stretch and compress but never reorder, collide, or run backwards.
 * It is a pure function of the bar number — no randomness — so a score compiles
 * to the same timeline every time.
 */
function rubatoWarp(u: number, amount: number, measureIndex = 0): number {
  if (!amount) return u;
  const arch = 0.75 + 0.25 * Math.cos((Math.PI * measureIndex) / 4);
  return u + amount * RUBATO_DEPTH * arch * Math.sin(2 * Math.PI * u);
}

/** Velocity for a note, honouring any crescendo/diminuendo in progress. */
function velocityAt(ctx: EmitCtx, beat: number): number {
  const ramp = ctx.velocityRamp;
  if (!ramp || beat <= ramp.fromBeat) return ramp ? ramp.from : ctx.velocity;
  if (beat >= ramp.toBeat) return ramp.to;
  const t = (beat - ramp.fromBeat) / (ramp.toBeat - ramp.fromBeat);
  return clampVelocity(ramp.from + (ramp.to - ramp.from) * t);
}

/**
 * A token that reads as neither a note nor a mark stays a rest — deliberately,
 * so a half-written score still plays. The cost is that a mistyped expression
 * mark ("sostenuto" before it was vocabulary, "ritardadno") silently swallows a
 * whole bar and a mistyped pitch silently drops a note, leaving a hole in the
 * music with nothing to point at. So the token is recorded: playback stays
 * forgiving, and the studio can say which bar went quiet and why.
 */
function noteUnknownToken(ctx: EmitCtx, token: string, kind: 'pitch' | 'drum' | 'chord' = 'pitch'): void {
  const tok = token.trim();
  if (!tok) return;
  const what = kind === 'drum' ? 'no such drum name or GM key'
    : kind === 'chord' ? 'a capital starts a chord like C, Dm7 or G7/B; note names are lowercase'
    : 'not a note, degree, chord or rest';
  const where = `bar ${ctx.measureNumber}`;
  const message = `${where}: unknown token "${tok}" (${what}) — silent`;
  if (!ctx.warnings.includes(message)) ctx.warnings.push(message);
}

/**
 * Recursively place one token in [start, start+span): rests emit nothing,
 * chords stack, groups share the span by weight. `boost` carries an accent's
 * extra velocity into chord members.
 */
function placeToken(token: string, start: number, span: number, ctx: EmitCtx, boost = 0): void {
  if (!token.trim()) return;
  const { core: tok, marks } = peelSuffix(token.trim());
  // Duration marks (`.` `:`) were consumed by the caller's division.
  let strumMarks = 0;
  for (const ch of marks) {
    if (ch === '~') strumMarks += 1;
    else if (ch === '>') boost += ACCENT_STEP;
    else if (ch === '<') boost -= ACCENT_STEP;
  }

  // A rest cuts the sound off, so nothing can be prolonged across it.
  if (tok === REST) {
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
    // that the next note lives on another string, and it is how long a
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
    ctx.held = sustained.length ? { events: sustained, span } : null;
    return;
  }

  if (tok[0] === '{' && tok[tok.length - 1] === '}') {
    const parts = splitTopLevel(tok.slice(1, -1));
    divideByWeight(parts, span).forEach((slot, i) => {
      placeToken(parts[i], start + slot.offset, slot.span, ctx, boost);
    });
    return;
  }

  // Kit tracks: the token is a drum name ("bd", "snare") or a raw GM key.
  if (ctx.drums) {
    const spec = resolveDrum(tok);
    if (!spec) {
      noteUnknownToken(ctx, token, 'drum');
      return;
    }
    if (dropByChance(ctx, start, spec.note)) {
      ctx.held = null;
      return;
    }
    const pitch = drumName(spec.note) ?? String(spec.note);
    const baseVelocity = clampVelocity(velocityAt(ctx, start) + boost);
    if (strumMarks > 0 && !ctx.written) {
      // `sd~` is a roll: retriggered hits filling the slot at 32nd-note pace
      // (`~~` at 64ths), swelling into the beat it lands on. Retriggers keep
      // the roll audible on any GM synth and in the .mid export.
      const step = 0.125 / strumMarks;
      const hits = Math.max(2, Math.round(span / step));
      for (let i = 0; i < hits; i++) {
        const t = hits > 1 ? i / (hits - 1) : 1;
        const at = start + (i * span) / hits;
        const h = humanizeOffsets(ctx, at, spec.note);
        ctx.events.push({
          time: round(Math.max(0, at + h.dt)),
          pitch,
          duration: round((span / hits) * 0.9),
          velocity: clampVelocity(baseVelocity * (0.6 + 0.4 * t) + h.dv),
          midi: spec.note,
        });
      }
      ctx.held = { events: [ctx.events[ctx.events.length - 1]], span: span / hits };
      return;
    }
    const h = humanizeOffsets(ctx, start, spec.note);
    const event: TimelineEvent = {
      time: round(Math.max(0, start + h.dt)),
      pitch,
      duration: round(span * ctx.gate),
      velocity: clampVelocity(baseVelocity + h.dv),
      midi: spec.note,
    };
    // Written, a roll is one note with tremolo strokes, not its retriggers.
    if (strumMarks > 0) event.roll = strumMarks;
    ctx.events.push(event);
    ctx.held = { events: [event], span };
    return;
  }

  // A leading `_` drops the note an octave, repeatable: `_1`, `__d3`. (A `_`
  // on its own is the hold token, handled above.)
  const under = /^(_+)(?=\S)/.exec(tok);
  const core = under ? tok.slice(under[1].length) : tok;
  const octavesDown = under ? under[1].length : 0;

  // A capital starts a chord token (`C`, `Dm7/C`): it sounds as a chord
  // in the track's octave. Note names are lowercase, so `A-` is never a note.
  if (/^[A-G]/.test(core)) {
    const notes = chordNotes(core, ctx.octave - octavesDown);
    if (!notes) {
      noteUnknownToken(ctx, token, 'chord');
      return;
    }
    placeToken(`[${notes.join(' ')}]${'~'.repeat(strumMarks)}`, start, span, ctx, boost);
    return;
  }
  const raw = isDegreeToken(core)
    ? degreeToMidi(core, ctx.scale, ctx.octave)
    : noteToMidi(core, ctx.octave);
  const midi = raw === null ? null : raw - 12 * octavesDown + ctx.transpose;
  if (midi === null) {
    noteUnknownToken(ctx, token);
    return;
  }
  if (dropByChance(ctx, start, midi)) {
    ctx.held = null;
    return;
  }
  const h = humanizeOffsets(ctx, start, midi);
  const event: TimelineEvent = {
    time: round(Math.max(0, start + h.dt)),
    pitch: midiToName(midi),
    duration: round(span * ctx.gate),
    velocity: clampVelocity(velocityAt(ctx, start) + boost + h.dv),
    midi,
  };
  if (ctx.written && !isDegreeToken(core)) {
    const spelling = letterSpelling(core, midi);
    if (spelling) event.spelling = spelling;
  }
  ctx.events.push(event);
  ctx.held = { events: [event], span };
}

// ---------------------------------------------------------------------------
// Play lists
// ---------------------------------------------------------------------------

const REPEAT_KEY = /^(\d+)x$/;

const GENERATOR_KEYS = ['spread', 'arp', 'walk'] as const;

/** Expansion state shared across the items of one play list. */
interface GenState {
  walk: WalkState;
}

/** Expand one generator item to its measure string. */
function expandGenerator(item: PlayGenerator, gen: GenState): string {
  const keys = Object.keys(item);
  const kind = keys.find((k) => (GENERATOR_KEYS as readonly string[]).includes(k))!;
  if (keys.length > 1) {
    throw new Error(`A "${kind}:" generator item can't mix with "${keys.find((k) => k !== kind)}" — put other keys in their own list item.`);
  }
  const spec = (item as Record<string, unknown>)[kind];
  if (spec == null || typeof spec !== 'object') {
    throw new Error(`"${kind}:" needs a mapping with its parameters — see docs/generative-design.md.`);
  }
  if (kind === 'spread') return expandSpread(spec as SpreadSpec);
  if (kind === 'arp') return expandArp(spec as ArpSpec);
  return expandWalk(spec as WalkSpec, gen.walk);
}

/**
 * Flatten a `play` value into its items, expanding inline `Nx:` repeats
 * (recursively — repeats may nest), generator items (`spread:`, `arp:`,
 * `walk:` → ordinary measure strings) and `alternate:` picks. Every consumer
 * of a play list goes through here, so all of these work identically for
 * compiling, measure counting, sections and editor highlighting.
 *
 * `pass` is which pass of an enclosing repeat (or `loop: N` section) is
 * being expanded — it drives `alternate:`; nested repeats compose
 * lexicographically. Expansion is deterministic, so repeated walks over the
 * same list always agree.
 */
function playItems(play: PlayInput, pass = 0, gen?: GenState): (string | PlayDirective)[] {
  gen ??= { walk: { count: 0 } };
  const raw = Array.isArray(play) ? play : String(play).split('\n');
  const out: (string | PlayDirective)[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && Object.keys(item).some((k) => REPEAT_KEY.test(k))) {
      for (const [key, content] of Object.entries(item)) {
        const match = REPEAT_KEY.exec(key);
        if (!match) {
          throw new Error(`A repeat item ("${Object.keys(item).find((k) => REPEAT_KEY.test(k))}:") can't mix with "${key}" — put other keys in their own list item.`);
        }
        if (content == null) {
          throw new Error(`"${key}:" needs the measures to repeat as its value.`);
        }
        const times = parseInt(match[1], 10);
        for (let p = 0; p < times; p++) {
          const inner = playItems(content as PlayInput, pass * times + p, gen);
          for (const entry of inner) {
            if (entry && typeof entry === 'object' && Object.keys(entry).some((k) => /^\d+$/.test(k))) {
              throw new Error(
                `Numbered measures can't sit inside a "${key}:" repeat — a repeat has no fixed bar to anchor them to.`,
              );
            }
          }
          out.push(...inner);
        }
      }
      continue;
    }
    if (item && typeof item === 'object' && 'alternate' in item) {
      const keys = Object.keys(item);
      if (keys.length > 1) {
        throw new Error(`An "alternate:" item can't mix with "${keys.find((k) => k !== 'alternate')}" — put other keys in their own list item.`);
      }
      const entries = (item as PlayAlternate).alternate;
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('"alternate:" needs a list of measures to cycle through, one per pass.');
      }
      const chosen = entries[((pass % entries.length) + entries.length) % entries.length];
      if (typeof chosen === 'string') {
        out.push(stripComment(chosen));
      } else if (chosen && typeof chosen === 'object' &&
        Object.keys(chosen).some((k) => (GENERATOR_KEYS as readonly string[]).includes(k))) {
        out.push(expandGenerator(chosen, gen));
      } else {
        throw new Error('"alternate:" entries must be measure strings or generator items (spread/arp/walk) — one bar each.');
      }
      continue;
    }
    if (item && typeof item === 'object' &&
      Object.keys(item).some((k) => (GENERATOR_KEYS as readonly string[]).includes(k))) {
      out.push(expandGenerator(item as PlayGenerator, gen));
      continue;
    }
    out.push(withoutComments(item as string | PlayDirective));
  }
  return out;
}

/** A play item with the `#` comments taken off its bar strings. */
function withoutComments(item: string | PlayDirective): string | PlayDirective {
  if (typeof item === 'string') return stripComment(item);
  if (!item || typeof item !== 'object') return item;
  let copy: PlayDirective | undefined;
  for (const [key, value] of Object.entries(item)) {
    if (/^\d+$/.test(key) && typeof value === 'string' && commentStart(value) !== -1) {
      copy ??= { ...item };
      (copy as Record<string, unknown>)[key] = stripComment(value);
    }
  }
  return copy ?? item;
}

/** Does this measure string occupy a bar slot (vs a directive that takes none)? */
export function occupiesBar(text: string): boolean {
  return text.trim() !== '' && !isDirectiveString(text) &&
    splitTopLevel(text).some((t) => !isMarkToken(t));
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
    if (occupiesBar(text)) m++;
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

export interface PlayResult {
  timeline: TimelineEvent[];
  controls: ControlEvent[];
  tempos: TempoEvent[];
  /** Where the last sounding measure ends, in beats — honours meter changes. */
  lengthBeats: number;
  /** Tokens that compiled to silence, with the bar they sat in. */
  warnings: string[];
  /** Written mode only: the bar map, one entry per measure. */
  bars?: BarInfo[];
}

/**
 * Compile one track's measures. Each measure is divided equally among its
 * top-level tokens. Mapping items and `||…||` tokens act as directives: they
 * update the running scale/octave/velocity/gate, and emit control or tempo
 * events at the beat where they appear, without advancing time.
 */
export function parsePlayFull(
  play: PlayInput,
  props: TrackProps = {},
  /**
   * Controls the track opens on, from a `set:` on the track itself. They are
   * emitted by the caller (at beat 0); what they are needed for here is the
   * starting point of a later drift. Without them a track that opens
   * `set: volume 127` and later says `fade out over 4` has nowhere to fade
   * *from*, and the ramp collapses to a jump.
   */
  opening: ControlEvent[] = [],
  options: CompileOptions = {},
): PlayResult {
  const written = options.written === true;
  let measureBeats = measureToBeats(props.measure);
  const controlAliases = props.controls ?? {};
  const baseTempo = props.tempo ?? DEFAULT_TEMPO;
  let runningTempo = baseTempo;
  const worded = parseSet(
    [props.dynamic, props.articulation].filter(Boolean).join(', ') || [],
  );
  const ctx: EmitCtx = {
    events: [],
    drums: props.kit != null,
    scale: parseScale(props.scale),
    octave: props.octave ?? DEFAULT_OCTAVE,
    transpose: props.transpose ?? 0,
    velocity: clampVelocity(props.velocity ?? worded.velocity ?? DEFAULT_VELOCITY),
    // Written mode drops every performance choice up front; the patch
    // applier below then refuses to bring them back mid-score.
    gate: written ? 1 : props.gate ?? worded.gate ?? DEFAULT_GATE,
    strum: written ? 0 : props.strum ?? DEFAULT_STRUM,
    voices: written ? 0 : props.voices ?? 0,
    strumTail: props.strumTail,
    rubato: written ? 0 : props.rubato ?? worded.rubato ?? 0,
    warnings: [],
    measureNumber: 1,
    seed: props.seed ?? DEFAULT_SEED,
    chance: Math.max(0, Math.min(1, props.chance ?? 1)),
    humanize: written ? undefined : normalizeHumanize(props.humanize),
    written,
  };
  // The key and meter as written, for the bar map. `ctx.scale` cannot stand
  // in for the key: an `==Dm7==` token moves it without changing the signature.
  let keyText = props.scale ?? 'c major';
  let meterText = notatedMeterText(props.measure ?? DEFAULT_MEASURE);
  const controls: ControlEvent[] = [];
  const tempos: TempoEvent[] = [];
  /** Last value emitted per CC, so a drift knows where it starts. */
  const lastCc = new Map<number, number>(opening.map((c) => [c.cc, c.value]));

  // Physical-model instruments take their loudness from a continuous
  // expression controller, not from note velocity. When a track declares an
  // `expression` control, dynamic marks also drive it: immediate changes emit
  // one CC, hairpins a ramp of CCs at eighth-note resolution.
  const exprSpec = controlAliases.expression !== undefined
    ? resolveControl(controlAliases, 'expression')
    : undefined;
  const exprValue = (velocity: number) =>
    Math.round(controlValue(exprSpec!, clampVelocity(velocity) / 127));
  const emitExpression = (at: number, velocity: number) => {
    if (exprSpec) controls.push({ time: round(at), cc: exprSpec.cc, value: exprValue(velocity) });
  };
  /** A glide as a staircase, one step per eighth note: [beat, progress 0..1]. */
  const rampSteps = (fromBeat: number, toBeat: number): [number, number][] => {
    const steps = Math.max(1, Math.ceil((toBeat - fromBeat) * 2));
    const out: [number, number][] = [];
    for (let s = 1; s <= steps; s++) out.push([fromBeat + (toBeat - fromBeat) * (s / steps), s / steps]);
    return out;
  };
  const emitExpressionRamp = (fromBeat: number, toBeat: number, from: number, to: number) => {
    if (!exprSpec || toBeat <= fromBeat) return;
    for (const [beat, t] of rampSteps(fromBeat, toBeat)) emitExpression(beat, from + (to - from) * t);
  };

  /*
   * Pedalling. A held damper is one CC; real pedalling is a rhythm, so the
   * pattern is re-emitted for each measure as it is compiled — that way it
   * follows meter changes and never has to be written out bar by bar.
   */
  let pedalPattern: PedalPattern | null = props.pedal ?? null;
  const pedalSpec = () => resolveControl(controlAliases, 'pedal');
  /** How long the dampers are actually off the strings when re-taking, in beats. */
  const PEDAL_LIFT = 0.06;
  const emitPedal = (start: number, span: number) => {
    const spec = pedalSpec();
    if (!pedalPattern || !spec || span <= 0) return;
    const down = Math.round(controlValue(spec, pedalPattern.depth));
    const up = Math.round(controlValue(spec, 0));
    const step = pedalPattern.unit === 'beat' ? 1 : span;
    for (let offset = 0; offset < span - 1e-9; offset += step) {
      const at = start + offset;
      const width = Math.min(step, span - offset);
      if (pedalPattern.style === 'legato') {
        // Lift *on* the change and catch it again at once: the new harmony is
        // caught, the old one is not dragged into it.
        controls.push({ time: round(at), cc: spec.cc, value: up });
        controls.push({ time: round(at + Math.min(PEDAL_LIFT, width / 2)), cc: spec.cc, value: down });
      } else {
        controls.push({ time: round(at), cc: spec.cc, value: down });
        controls.push({ time: round(at + Math.max(0, width - PEDAL_LIFT)), cc: spec.cc, value: up });
      }
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
    if (patch.pedal !== undefined) {
      pedalPattern = patch.pedal;
      // Stopping means the dampers come down now, not at the next barline.
      if (!patch.pedal) {
        const spec = pedalSpec();
        if (spec) controls.push({ time: round(at), cc: spec.cc, value: Math.round(controlValue(spec, 0)) });
      }
    }
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

    if (!written) {
      if (patch.gate !== undefined) ctx.gate = patch.gate;
      if (patch.strum !== undefined) ctx.strum = patch.strum;
      if (patch.voices !== undefined) ctx.voices = patch.voices;
      if (patch.strumTail !== undefined) ctx.strumTail = patch.strumTail;
      if (patch.rubato !== undefined) ctx.rubato = patch.rubato;
      if (patch.humanize !== undefined) ctx.humanize = patch.humanize ?? undefined;
    }
    if (patch.seed !== undefined) ctx.seed = patch.seed;
    if (patch.chance !== undefined) ctx.chance = Math.max(0, Math.min(1, patch.chance));
    if (patch.scale) keyText = patch.scale;
    if (patch.measure) meterText = notatedMeterText(patch.measure);

    if (patch.aTempo) setTempo(baseTempo, 0, at);
    if (patch.tempo) {
      const target = patch.tempo.bpm ?? runningTempo * (patch.tempo.scale ?? 1);
      setTempo(target, patch.tempo.overMeasures, at);
    }

    for (const c of patch.ccs ?? []) {
      controls.push({ time: round(at), cc: c.cc, value: c.value });
      lastCc.set(c.cc, c.value);
    }
    // Drifts glide from wherever the control last sat.
    for (const r of patch.ccRamps ?? []) {
      const from = lastCc.get(r.cc) ?? r.to;
      for (const [beat, t] of rampSteps(at, at + r.overMeasures * measureBeats)) {
        controls.push({ time: round(beat), cc: r.cc, value: Math.round(from + (r.to - from) * t) });
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
  // The bar map (written mode).
  const bars: BarInfo[] = [];
  const noteBar = (index: number, start: number) => {
    if (!written) return;
    // Bars skipped by a numbered jump are silent bars in the running meter.
    for (let i = bars.length; i < index; i++) {
      bars[i] = { start: round(start - (index - i) * measureBeats), beats: measureBeats, meter: meterText, scale: keyText };
    }
    bars[index] = { start, beats: measureBeats, meter: meterText, scale: keyText };
  };
  const compileMeasure = (raw: string) => {
    const measure = raw.trim();
    if (!measure) return;
    ctx.measureNumber = m + 1;
    // A bare expression mark ("legato", "allargando over 2") sits between
    // measures like a marking in a score, and takes no time.
    if (isDirectiveString(measure)) {
      applySet(measure, beat);
      return;
    }
    const tokens = splitTopLevel(measure);
    const noteTokens = tokens.filter((t) => !isMarkToken(t));
    if (noteTokens.length === 0) {
      // A directive-only line changes state but is not a measure.
      for (const tok of tokens) {
        if (isScaleToken(tok)) ctx.scale = parseScale(setTokenBody(tok));
        else applySet(setTokenBody(tok), beat);
      }
      return;
    }
    const slots = divideByWeight(noteTokens, measureBeats);
    const firstEvent = ctx.events.length; // where this measure's notes begin
    let pos = 0; // beats consumed within the measure
    let slot = 0;
    for (const tok of tokens) {
      const at = beat + pos;
      if (isScaleToken(tok)) {
        ctx.scale = parseScale(setTokenBody(tok));
      } else if (isMarkToken(tok)) {
        applySet(setTokenBody(tok), at);
      } else {
        // Recorded at the first note, so a key set at the head of the bar
        // (`||eb major|| …`) belongs to this bar rather than the next.
        if (slot === 0) noteBar(m, beat);
        placeToken(tok, at, slots[slot].span, ctx);
        pos += slots[slot++].span;
      }
    }
    // Let the bar breathe. Onset and release are warped by the same curve, so
    // a note keeps its shape (and its overlap with the next) as it moves; the
    // measure still ends where it began, so `beat` below is untouched.
    if (ctx.rubato > 0) {
      const warp = (t: number) =>
        beat + rubatoWarp((t - beat) / measureBeats, ctx.rubato, m) * measureBeats;
      for (let i = firstEvent; i < ctx.events.length; i++) {
        const event = ctx.events[i];
        const from = warp(event.time);
        const to = warp(event.time + event.duration);
        event.time = round(from);
        event.duration = round(Math.max(0.01, to - from));
      }
    }
    emitPedal(beat, measureBeats);
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
      checkDirectiveKeys(item, m + 1);
      applyPatch(directivePatch(item), beat);
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
  for (const e of written ? [] : ctx.events) {
    const prev = lastByPitch.get(e.midi);
    if (prev && prev.time < e.time && prev.time + prev.duration > e.time) {
      prev.duration = round(Math.max(0.01, e.time - prev.time - 0.02));
    }
    lastByPitch.set(e.midi, e);
  }

  /*
   * Bow release. Run over the finished timeline rather than while compiling,
   * because "is a rest coming?" is only answerable once the notes after this
   * one exist — and a phrase ends where the *sound* stops, which under a
   * legato overlap or a held chord is not where any single note ends.
   */
  if (!written && exprSpec && props.release !== undefined && props.release !== null) {
    const cfg = typeof props.release === 'number' ? { over: props.release } : props.release;
    const over = Math.max(0, cfg.over ?? 0.5);
    const minGap = Math.max(0, cfg.gap ?? 0.25);
    const floor = Math.round(controlValue(exprSpec, Math.max(0, Math.min(1, cfg.to ?? 0))));
    const notes = [...ctx.events].sort((a, b) => a.time - b.time);
    const exprEvents = controls
      .filter((c) => c.cc === exprSpec.cc)
      .sort((a, b) => a.time - b.time);
    /** The expression the score has called for at this beat. */
    const exprAt = (beat: number): number | null => {
      let value: number | null = null;
      for (const e of exprEvents) {
        if (e.time > beat + 1e-9) break;
        value = e.value;
      }
      return value;
    };
    const added: ControlEvent[] = [];

    // Walk the sounding span: a pause opens where nothing is left ringing and
    // the next attack is far enough away to read as silence.
    let i = 0;
    while (i < notes.length) {
      let soundingUntil = notes[i].time + notes[i].duration;
      let lastOnset = notes[i].time;
      let j = i + 1;
      while (j < notes.length && notes[j].time < soundingUntil + minGap - 1e-9) {
        soundingUntil = Math.max(soundingUntil, notes[j].time + notes[j].duration);
        lastOnset = Math.max(lastOnset, notes[j].time);
        j++;
      }
      const nextOnset = j < notes.length ? notes[j].time : Infinity;

      // Never start the taper before the note it belongs to, or the bow would
      // be dying away through a note that has only just been attacked.
      const start = Math.max(lastOnset, soundingUntil - over);
      const held = exprAt(start);
      if (held !== null && held > floor && soundingUntil > start + 1e-9) {
        // Fine enough that the fall reads as a bow slowing rather than a
        // staircase: a half-beat release at 4 steps/beat is two values.
        const steps = Math.max(4, Math.ceil((soundingUntil - start) * 16));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          added.push({
            time: round(start + (soundingUntil - start) * t),
            cc: exprSpec.cc,
            value: Math.round(held + (floor - held) * t),
          });
        }
        // Put the bow back for the next phrase — unless the score itself has
        // something to say at the entry, in which case that wins.
        const spoken = exprEvents.some((e) => e.time > soundingUntil + 1e-9 && e.time <= nextOnset + 1e-9);
        if (nextOnset !== Infinity && !spoken) {
          added.push({ time: round(nextOnset), cc: exprSpec.cc, value: held });
        }
      }
      i = j;
    }
    controls.push(...added);
  }

  controls.sort((a, b) => a.time - b.time);
  tempos.sort((a, b) => a.time - b.time);
  // A track-level velocity band. Applied last, over the finished timeline, so
  // it catches every velocity the compiler produced — dynamic marks, hairpin
  // ramps, accents, rolls and humanize alike — and nothing escapes the band.
  // The written dynamics keep their relative shape; only where they land moves.
  if (props.velocityRange !== undefined) {
    const band: ControlSpec = { cc: 0, range: props.velocityRange };
    for (const event of ctx.events) {
      event.velocity = clampVelocity(controlValue(band, event.velocity / 127));
    }
  }

  const result: PlayResult = { timeline: ctx.events, controls, tempos, lengthBeats: endBeat, warnings: ctx.warnings };
  if (written) result.bars = bars;
  return result;
}

/**
 * A `measure:` value as a time signature. Strings are kept as written, so
 * 6/8 stays 6/8; a plain beat count is read in quarters (5 → 5/4), or in
 * eighths or sixteenths when it is not a whole number of quarters.
 */
function notatedMeterText(measure: string | number): string {
  const text = String(measure).trim();
  const sig = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (sig) return `${parseInt(sig[1], 10)}/${parseInt(sig[2], 10)}`;
  const beats = measureToBeats(measure);
  for (const den of [4, 8, 16, 32]) {
    const num = (beats * den) / 4;
    if (Math.abs(num - Math.round(num)) < 1e-9) return `${Math.round(num)}/${den}`;
  }
  return `${Math.round(beats)}/4`;
}

const DIRECTIVE_KEYS = new Set<string>([...DIRECTIVE_PROPS, 'set']);

/** A mapping item in a play list takes props, `set:` and bar numbers only. */
function checkDirectiveKeys(item: PlayDirective, bar: number): void {
  for (const key of Object.keys(item)) {
    if (/^\d+$/.test(key) || DIRECTIVE_KEYS.has(key)) continue;
    if (key === 'dynamic' || key === 'articulation') {
      throw new Error(
        `bar ${bar}: "${key}:" is a track key. Inside a play list, write the word as its own line: - "${item[key as keyof PlayDirective]}".`,
      );
    }
    const hint = suggestKey(key, [...DIRECTIVE_KEYS, ...GENERATOR_KEYS, 'alternate']);
    throw new Error(
      `bar ${bar}: "${key}:" can't change inside a play list.` +
        (hint ? ` Did you mean "${hint}"?` : ` Inside a play list a mapping takes ${[...DIRECTIVE_KEYS].join(', ')}, ` +
          `a bar number, a repeat (2x:) or a generator.`),
    );
  }
}

/**
 * A directive item is the mapping form of a `set` patch, so it goes through
 * the same applier and the tempo/velocity bookkeeping stays in one place.
 */
function directivePatch(item: PlayDirective): SetPatch {
  const patch: SetPatch = {};
  for (const key of DIRECTIVE_PROPS) {
    const value = item[key];
    if (value === undefined) continue;
    if (key === 'tempo') patch.tempo = { bpm: value as number, overMeasures: 0 };
    else if (key === 'humanize') patch.humanize = normalizeHumanize(value as TrackProps['humanize']) ?? null;
    else if (key === 'measure') patch.measure = String(value);
    else (patch as Record<string, unknown>)[key] = value;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Sections — named song parts with parallel instrument tracks inside
// ---------------------------------------------------------------------------

/** Keys of a section mapping that are NOT instrument tracks. */
const SECTION_KEYS = new Set(['loop', 'wait']);

const SECTION_TRACK_KEYS = new Set(['wait', 'set', 'play', ...DIRECTIVE_PROPS]);

/** Bars a play list spans (numbered keys included). */
function measureSpan(play: PlayInput | undefined): number {
  if (play == null) return 0;
  let span = 0;
  for (const entry of playMeasureEntries(play)) span = Math.max(span, entry.index + 1);
  return span;
}

/**
 * Expand a `sections:` document into an equivalent classic per-track one:
 * every instrument gets a synthesized play list whose numbered measures place
 * each section pass at its absolute bars. Returns the bar where the
 * forever-loop begins (null when no section loops).
 *
 * Waits apply exactly once. For a looping tail that contains waits, the tail
 * is compiled twice: a first pass with the waits before the loop point, then
 * a clean pass that becomes the body repeated forever.
 */
export function expandSections(doc: SongDoc): { doc: SongDoc; loopStartBar: number | null } {
  if (!doc.sections || typeof doc.sections !== 'object') return { doc, loopStartBar: null };
  if (doc.play != null) {
    throw new Error('Use either a top-level "play:" or "sections:", not both.');
  }
  if (doc.wait != null) {
    throw new Error('With "sections:", "wait:" goes on a section or on a track inside one.');
  }
  for (const [name, node] of Object.entries(doc.tracks ?? {})) {
    if (node && typeof node === 'object' && node.wait != null) {
      throw new Error(
        `With "sections:", the top-level track "${name}" can't wait — put "wait:" on its part inside a section.`,
      );
    }
    if (node && typeof node === 'object' && (node.play != null || node.tracks)) {
      throw new Error(
        `With "sections:", the top-level track "${name}" declares the instrument only ` +
          `(preset, kit, controls…) — its music lives inside the sections.`,
      );
    }
  }

  const lists = new Map<string, (string | PlayDirective)[]>();
  const order: string[] = [];
  const listFor = (name: string) => {
    let list = lists.get(name);
    if (!list) {
      list = [];
      lists.set(name, list);
      order.push(name);
    }
    return list;
  };

  let cursor = 0; // absolute bar (0-based) where the next section starts
  let loopStartBar: number | null = null;

  const sectionTracks = (name: string, section: SectionNode): [string, SectionTrack][] =>
    Object.entries(section)
      .filter(([key]) => !SECTION_KEYS.has(key))
      .map(([trackName, node]) => {
        if (!node || typeof node !== 'object') {
          throw new Error(`Section "${name}": track "${trackName}" must be a mapping with a "play:".`);
        }
        for (const key of Object.keys(node)) {
          if (!SECTION_TRACK_KEYS.has(key)) {
            throw new Error(
              `Section "${name}", track "${trackName}": "${key}" can't change per section — ` +
                `declare it on the top-level track.`,
            );
          }
        }
        return [trackName, node as SectionTrack];
      });

  /** Write one pass of a section into every participating track's list. */
  const emit = (name: string, section: SectionNode, withWaits: boolean, pass = 0) => {
    const sectionWait = withWaits ? Math.max(0, section.wait ?? 0) : 0;
    const tracks = sectionTracks(name, section);
    let length = 0;
    for (const [, node] of tracks) {
      const wait = sectionWait + (withWaits ? Math.max(0, node.wait ?? 0) : 0);
      length = Math.max(length, wait + measureSpan(node.play));
    }
    for (const [trackName, node] of tracks) {
      const list = listFor(trackName);
      const startBar = cursor + sectionWait + (withWaits ? Math.max(0, node.wait ?? 0) : 0);
      // An empty numbered measure syncs the beat cursor to the entry bar, so
      // leading directives (tempo words, prop overrides) land at the right time.
      list.push({ [startBar + 1]: '' });
      const overrides: PlayDirective = {};
      for (const key of DIRECTIVE_PROPS) {
        if (node[key] !== undefined) (overrides as Record<string, unknown>)[key] = node[key];
      }
      if (node.set !== undefined) overrides.set = node.set;
      if (Object.keys(overrides).length) list.push(overrides);

      let rel = 0; // section-relative bar of the next plain measure string
      for (const item of playItems(node.play ?? [], pass)) {
        if (item && typeof item === 'object') {
          const rekeyed: PlayDirective = {};
          for (const [key, value] of Object.entries(item)) {
            if (/^\d+$/.test(key)) {
              // Numbered measures inside a section are section-relative.
              const target = parseInt(key, 10);
              rekeyed[startBar + target] = value as string | undefined;
              rel = target - 1;
              if (typeof value === 'string' && occupiesBar(value)) rel++;
            } else {
              (rekeyed as Record<string, unknown>)[key] = value;
            }
          }
          list.push(rekeyed);
          continue;
        }
        const text = String(item);
        list.push({ [startBar + rel + 1]: text });
        if (occupiesBar(text)) rel++;
      }
    }
    cursor += length;
  };

  const entries = Object.entries(doc.sections);
  const cycle: [string, SectionNode][] = [];
  for (const [name, raw] of entries) {
    const section = raw ?? {};
    const loop = section.loop ?? true;
    if (loop === true) {
      cycle.push([name, section]);
      continue;
    }
    if (cycle.length) {
      throw new Error(
        `Section "${name}" comes after the forever-looping tail of the song — ` +
          `give it "loop: true" or move it before the loop.`,
      );
    }
    const times = loop === false ? 1 : Math.max(0, Math.floor(loop));
    for (let pass = 0; pass < times; pass++) emit(name, section, pass === 0, pass);
  }
  if (cycle.length) {
    // Waits inside the looping tail play once: compile a waited pass before
    // the loop point, then the clean pass that repeats forever.
    const hasWaits = cycle.some(([name, section]) =>
      (section.wait ?? 0) > 0 ||
      sectionTracks(name, section).some(([, node]) => (node.wait ?? 0) > 0));
    if (hasWaits) for (const [name, section] of cycle) emit(name, section, true);
    loopStartBar = cursor;
    for (const [name, section] of cycle) emit(name, section, !hasWaits, hasWaits ? 1 : 0);
  }

  const baseTracks = doc.tracks ?? {};
  const tracks: Record<string, TrackNode> = {};
  for (const name of order) {
    tracks[name] = { ...(baseTracks[name] ?? {}), play: lists.get(name)! };
  }
  const { sections: _sections, ...rest } = doc;
  return { doc: { ...rest, tracks }, loopStartBar };
}

// ---------------------------------------------------------------------------
// Document compilation (recursive tracks with inheritance)
// ---------------------------------------------------------------------------

/** Every TrackProps key: a child track inherits all of them. */
const INHERITED = [
  'tempo', 'measure', 'preset', 'scale', 'octave', 'transpose', 'channel', 'program', 'velocity',
  'gate', 'rubato', 'dynamic', 'articulation', 'release', 'controls', 'strum', 'voices', 'strumTail', 'kit',
  'pedal', 'seed', 'chance', 'humanize', 'velocityRange',
] as const satisfies readonly (keyof TrackProps)[];
// A new TrackProps key must be listed above, or it would silently not inherit.
const _everyPropInherits: Exclude<keyof TrackProps, (typeof INHERITED)[number]> extends never ? true : never = true;
void _everyPropInherits;

/** Keys a track may hold besides the inherited props. */
const TRACK_KEYS = new Set<string>([...INHERITED, 'title', 'wait', 'lyrics', 'set', 'play', 'tracks']);
/** Keys only the root may hold: the printed header and the song form. */
const ROOT_KEYS = new Set<string>(['composer', 'key', 'tempo text', 'metronome marks', 'sections']);

/** Edit distance, for "did you mean" hints on misspelled keys. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

/** The closest known key, when one is close enough to be a typo. */
function suggestKey(key: string, known: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(key.length / 3)) + 1;
  for (const candidate of known) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Refuse keys the compiler would otherwise skip without a word: a typo like
 * `instrumnet:` used to leave the track on the default piano.
 */
function checkTrackKeys(node: TrackNode, where: string, isRoot: boolean): void {
  for (const key of Object.keys(node)) {
    if (TRACK_KEYS.has(key) || (isRoot && ROOT_KEYS.has(key))) continue;
    if (key === 'sample' || key === 'instrument') {
      throw new Error(`${where}: "${key}:" is now "preset:" (preset: ${node[key as keyof TrackNode]}).`);
    }
    const known = isRoot ? [...TRACK_KEYS, ...ROOT_KEYS] : [...TRACK_KEYS];
    const hint = suggestKey(key, known);
    const tracksHint = !isRoot || hint ? '' : ` A track goes under "tracks:".`;
    throw new Error(
      `${where}: unknown key "${key}".` +
        (hint ? ` Did you mean "${hint}"?` : '') + tracksHint,
    );
  }
}

/** Dynamics are spelled out; the abbreviation each word is printed as. */
const DYNAMIC_ABBREVIATIONS: Record<string, string> = {
  ppp: 'pianississimo', pp: 'pianissimo', p: 'piano', mp: 'mezzopiano',
  mf: 'mezzoforte', f: 'forte', ff: 'fortissimo', fff: 'fortississimo',
};

/**
 * `dynamic:` and `articulation:` take words of performance. A word that
 * parses as something else (`dynamic: f` is the key of F) would be dropped.
 */
function checkWorded(key: 'dynamic' | 'articulation', value: unknown, where: string): void {
  if (value === undefined || value === null) return;
  const text = String(value);
  for (const word of text.split(',').map((w) => w.trim().toLowerCase())) {
    if (DYNAMIC_ABBREVIATIONS[word]) {
      throw new Error(
        `${where}: ${key}: "${word}" is an abbreviation. Dynamics are spelled out: write "${DYNAMIC_ABBREVIATIONS[word]}".`,
      );
    }
  }
  let patch: SetPatch;
  try {
    patch = parseSet(text, {}, { ignoreMissingControls: true });
  } catch (error) {
    throw new Error(`${where}: ${key}: ${error instanceof Error ? error.message : error}`);
  }
  const stray = (['scale', 'octave', 'octaveDelta', 'measure', 'tempo'] as const)
    .find((k) => patch[k] !== undefined);
  if (stray) {
    throw new Error(
      `${where}: ${key}: "${text}" is a ${stray === 'octaveDelta' ? 'octave' : stray}, not a ${key}. ` +
        `Put it on its own key (${stray === 'octaveDelta' ? 'octave' : stray}:) or in "set:".`,
    );
  }
}

/**
 * The static half of a `set` patch applied to a track's props: what a track
 * opens on. Hairpins, tempo ramps and control drifts are motions, so they
 * belong in a play list and are ignored here.
 */
function patchProps(props: TrackProps, patch: SetPatch): TrackProps {
  const out: TrackProps = { ...props };
  if (patch.scale) out.scale = patch.scale;
  if (patch.octave !== undefined) out.octave = patch.octave;
  if (patch.octaveDelta) out.octave = (out.octave ?? DEFAULT_OCTAVE) + patch.octaveDelta;
  if (patch.velocity !== undefined) out.velocity = patch.velocity;
  if (patch.velocityDelta) out.velocity = (out.velocity ?? DEFAULT_VELOCITY) + patch.velocityDelta;
  if (patch.tempo?.bpm !== undefined) out.tempo = patch.tempo.bpm;
  else if (patch.tempo?.scale !== undefined) out.tempo = (out.tempo ?? DEFAULT_TEMPO) * patch.tempo.scale;
  if (patch.measure !== undefined) out.measure = patch.measure;
  if (patch.gate !== undefined) out.gate = patch.gate;
  if (patch.strum !== undefined) out.strum = patch.strum;
  if (patch.voices !== undefined) out.voices = patch.voices;
  if (patch.strumTail !== undefined) out.strumTail = patch.strumTail;
  if (patch.rubato !== undefined) out.rubato = patch.rubato;
  if (patch.pedal !== undefined) out.pedal = patch.pedal;
  if (patch.seed !== undefined) out.seed = patch.seed;
  if (patch.chance !== undefined) out.chance = patch.chance;
  if (patch.humanize !== undefined) out.humanize = patch.humanize ?? undefined;
  return out;
}

/**
 * A node's props: its parent's, its own, then its `set:`. The controls the
 * `set:` declares are the track's opening state, emitted at beat 0.
 */
function effectiveProps(
  node: TrackNode,
  inherited: TrackProps,
  where = 'score',
): { props: TrackProps; opening: ControlEvent[] } {
  checkWorded('dynamic', node.dynamic, where);
  checkWorded('articulation', node.articulation, where);
  let props: TrackProps = { ...inherited };
  for (const key of INHERITED) {
    if (node[key] !== undefined) (props as Record<string, unknown>)[key] = node[key];
  }
  let opening: ControlEvent[] = [];
  if (node.set !== undefined) {
    const patch = parseSet(node.set, props.controls);
    props = patchProps(props, patch);
    opening = (patch.ccs ?? []).map((c) => ({ time: 0, cc: c.cc, value: c.value }));
  }
  return { props, opening };
}

/**
 * Lay `lyrics:` on a track's note onsets, in order. Returns the lyrics and
 * how many syllables found no note.
 */
export function placeLyrics(text: string, onsets: number[]): { lyrics: Lyric[]; extra: number } {
  const words = String(text).split('\n').map(stripComment).join(' ').split(/\s+/).filter(Boolean);
  const lyrics: Lyric[] = [];
  let inWord = false;
  let i = 0;
  let extra = 0;
  for (const word of words) {
    if (i >= onsets.length) {
      if (word !== '_') extra++;
      continue;
    }
    const time = onsets[i++];
    if (word === '_') continue; // the syllable before carries on over this note
    const continues = word.length > 1 && word.endsWith('-');
    const syllabic: Syllabic = continues ? (inWord ? 'middle' : 'begin') : inWord ? 'end' : 'single';
    lyrics.push({ time, text: continues ? word.slice(0, -1) : word, syllabic });
    inWord = continues;
  }
  return { lyrics, extra };
}

/** Bars of `wait:` as a whole number, or an error naming the track. */
function waitBars(value: unknown, where: string): number {
  if (value == null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${where}: "wait:" takes a whole number of bars, not ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * A play value that starts `bars` later: an empty numbered bar moves the
 * cursor to the entry, and the play's own numbered bars move with it.
 */
export function delayPlay(play: PlayInput, bars: number): PlayInput {
  if (bars <= 0) return play;
  const items = Array.isArray(play) ? play : String(play).split('\n');
  const out: Exclude<PlayInput, string> = [{ [bars + 1]: '' }];
  for (const item of items) {
    if (item && typeof item === 'object' && Object.keys(item).some((k) => /^\d+$/.test(k))) {
      const shifted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item)) {
        shifted[/^\d+$/.test(key) ? String(parseInt(key, 10) + bars) : key] = value;
      }
      out.push(shifted as PlayDirective);
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Compile a document (which is itself a track) into flat per-track timelines.
 */
export function compileDoc(doc: SongDoc, options: CompileOptions = {}): CompiledSong {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Score must be a mapping with a "play:", "sections:" or "tracks:" key.');
  }

  const { doc: expanded, loopStartBar } = expandSections(doc);
  doc = expanded;

  // velocity and gate are deliberately left unset here so that their worded
  // forms (`dynamic:` / `articulation:`) can supply them.
  checkTrackKeys(doc, 'score', true);
  const root = effectiveProps(doc, {
    tempo: DEFAULT_TEMPO,
    measure: DEFAULT_MEASURE,
    preset: DEFAULT_PRESET,
    octave: DEFAULT_OCTAVE,
  }, 'score');
  const rootProps = root.props;

  const tracks: CompiledTrack[] = [];
  const warnings: string[] = [];
  const tempoMap: TempoEvent[] = [];
  let lengthBeats = 0;
  let nextChannel = 1;

  const walk = (node: TrackNode, name: string, inherited: TrackProps, parent?: string, waited = 0) => {
    if (node !== doc) checkTrackKeys(node, `track "${name}"`, false);
    const { props, opening } = node === doc ? root : effectiveProps(node, inherited, `track "${name}"`);
    const wait = waited + waitBars(node.wait, node === doc ? 'score' : `track "${name}"`);
    if (node.lyrics != null && node.play == null) {
      throw new Error(`${node === doc ? 'score' : `track "${name}"`}: "lyrics:" needs a "play:" to sit under.`);
    }

    if (node.play != null) {
      const { timeline, controls, tempos, lengthBeats: trackBeats, warnings: trackWarnings, bars } =
        parsePlayFull(delayPlay(node.play, wait), props, opening, options);
      for (const w of trackWarnings) {
        const tagged = `${name}: ${w}`;
        if (!warnings.includes(tagged)) warnings.push(tagged);
      }
      lengthBeats = Math.max(lengthBeats, trackBeats);
      const preset = props.preset ?? DEFAULT_PRESET;
      // Tempo belongs to the song, not a voice — merge every track's changes.
      tempoMap.push(...tempos);
      // Kit tracks live on the GM percussion channel and take no program
      // change; melodic auto-assign skips it so a large score never leaks
      // notes onto the drums.
      if (nextChannel === DRUM_CHANNEL) nextChannel++;
      tracks.push({
        name,
        channel: props.channel ?? (props.kit != null ? DRUM_CHANNEL : nextChannel++),
        preset,
        // `kit: 808` reads as a YAML number — normalize so consumers compare strings.
        kit: props.kit != null ? String(props.kit) : undefined,
        program: props.kit != null ? undefined
          : props.program ?? presetProgram(preset),
        timeline,
        controls: [...opening, ...controls],
      });
      if (bars) tracks[tracks.length - 1].bars = bars;
      if (node.lyrics != null) {
        // Syllables sit on written onsets: a performance's rubato, strum and
        // humanize must not decide which note a word belongs to.
        const writtenLine = options.written ? timeline
          : parsePlayFull(delayPlay(node.play, wait), props, opening, { ...options, written: true }).timeline;
        const onsets = [...new Set(writtenLine.map((e) => e.time))].sort((a, b) => a - b);
        const { lyrics, extra } = placeLyrics(String(node.lyrics), onsets);
        tracks[tracks.length - 1].lyrics = lyrics;
        if (extra) warnings.push(`${name}: lyrics: ${extra} syllable${extra > 1 ? 's' : ''} past the last note`);
      }
      if (bars && parent !== undefined) tracks[tracks.length - 1].parent = parent;
    }

    if (node.tracks && typeof node.tracks === 'object') {
      for (const [childName, child] of Object.entries(node.tracks)) {
        if (child == null) continue; // `name:` with nothing under it: an empty slot
        if (typeof child !== 'object' || Array.isArray(child)) {
          throw new Error(
            `Track "${childName}" must be a mapping (preset:, play:…), not ${JSON.stringify(child)}.`,
          );
        }
        walk(child, childName, props, node === doc ? undefined : name, wait);
      }
    }
  };

  walk(doc, doc.title || 'main', rootProps);

  if (tracks.length === 0) {
    throw new Error('Score has nothing to play — add a "play:" or "tracks:" key.');
  }

  // One tempo change per beat position; a later track's declaration wins.
  const byTime = new Map<number, TempoEvent>();
  for (const t of tempoMap) byTime.set(t.time, t);

  return {
    title: doc.title,
    bpm: rootProps.tempo ?? DEFAULT_TEMPO,
    measureBeats: measureToBeats(rootProps.measure),
    measureSig: notatedMeter(rootProps.measure),
    lengthBeats,
    // Loop markers assume the root meter at the cycle boundary (numbered
    // jumps make the same assumption).
    loopStartBeats: loopStartBar != null
      ? round(loopStartBar * measureToBeats(rootProps.measure))
      : undefined,
    tempoMap: [...byTime.values()].sort((a, b) => a.time - b.time),
    tracks,
    warnings,
  };
}
