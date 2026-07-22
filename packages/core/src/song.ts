'use strict';

/**
 * song.ts — the compiler: measure strings + track props → per-track timelines
 * of notes, control changes and tempo changes, and whole documents (recursive
 * tracks with prop inheritance) → a CompiledSong.
 */

import {
  DEFAULT_MEASURE, DEFAULT_OCTAVE, ScaleInfo, degreeToMidi, measureToBeats,
  midiToName, noteToMidi, parseScale,
} from './theory';
import {
  ACCENT_STEP, ControlSpec, DEFAULT_GATE, DEFAULT_STRUM, SAMPLE_PROGRAMS,
  drumName, resolveControl, resolveDrum,
} from './vocabulary';
import { SetPatch, parseSet } from './set';
import { HOLD, isDirectiveString, isScaleToken, isSetToken, setTokenBody, splitTopLevel } from './tokens';

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
   * Names a drum kit ("acoustic", "808", "percussion") and switches the
   * track's tokens from pitches to drum names: `bd hh sd hh` instead of
   * notes. Kit tracks default to MIDI channel 10 (GM percussion) and take no
   * program change. A `~` suffix rolls a hit (`sd~` = snare roll); scale and
   * octave are ignored. (`kit: 808` arrives as a YAML number — both work.)
   */
  kit?: string | number;
  /**
   * Named MIDI controls: alias → CC number, or → { cc, min, max } when the
   * instrument's mapping uses a narrower band or runs the other way round
   * (`{ cc: 74, min: 127, max: 0 }` inverts it).
   */
  controls?: Record<string, number | ControlSpec>;
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

export type PlayInput = string | (string | PlayDirective | PlayRepeat)[];

export interface TrackNode extends TrackProps {
  title?: string; // meaningful at the root
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
export interface SectionTrack extends Pick<
  TrackProps, 'scale' | 'octave' | 'velocity' | 'gate' | 'tempo' | 'measure' | 'strum' | 'voices'
> {
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

export type SongDoc = TrackNode & { sections?: Record<string, SectionNode> };

export interface CompiledTrack {
  name: string;
  channel: number;
  sample?: string;
  /** The drum kit this track plays, when it is a `kit:` track. */
  kit?: string;
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
  /**
   * Where the forever-loop begins, in beats, when the document's sections
   * declare one (everything before it — the intro — plays once). Undefined =
   * no loop declared; players fall back to looping the whole song.
   */
  loopStartBeats?: number;
  /** Tempo changes in beat order; empty when the song holds one tempo. */
  tempoMap: TempoEvent[];
  tracks: CompiledTrack[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPO = 80;
export const DEFAULT_SAMPLE = 'piano';
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

  // Kit tracks: the token is a drum name ("bd", "snare") or a raw GM key.
  if (ctx.drums) {
    const spec = resolveDrum(tok);
    if (!spec) return; // unknown token → rest, same policy as pitches
    const pitch = drumName(spec.note) ?? String(spec.note);
    const baseVelocity = clampVelocity(velocityAt(ctx, start) + boost);
    if (strumMarks > 0) {
      // `sd~` is a roll: retriggered hits filling the slot at 32nd-note pace
      // (`~~` at 64ths), swelling into the beat it lands on. Retriggers keep
      // the roll audible on any GM synth and in the .mid export.
      const step = 0.125 / strumMarks;
      const hits = Math.max(2, Math.round(span / step));
      for (let i = 0; i < hits; i++) {
        const t = hits > 1 ? i / (hits - 1) : 1;
        ctx.events.push({
          time: round(start + (i * span) / hits),
          pitch,
          duration: round((span / hits) * 0.9),
          velocity: clampVelocity(baseVelocity * (0.6 + 0.4 * t)),
          midi: spec.note,
        });
      }
      ctx.held = { events: [ctx.events[ctx.events.length - 1]], span: span / hits };
      return;
    }
    const event: TimelineEvent = {
      time: round(start),
      pitch,
      duration: round(span * ctx.gate),
      velocity: baseVelocity,
      midi: spec.note,
    };
    ctx.events.push(event);
    ctx.held = { events: [event], span };
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

// ---------------------------------------------------------------------------
// Play lists
// ---------------------------------------------------------------------------

const REPEAT_KEY = /^(\d+)x$/;

/**
 * Flatten a `play` value into its items, expanding inline `Nx:` repeats
 * (recursively — repeats may nest). Every consumer of a play list goes
 * through here, so repeats work identically for compiling, measure counting,
 * sections and editor highlighting.
 */
function playItems(play: PlayInput): (string | PlayDirective)[] {
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
        const inner = playItems(content as PlayInput);
        for (const entry of inner) {
          if (entry && typeof entry === 'object' && Object.keys(entry).some((k) => /^\d+$/.test(k))) {
            throw new Error(
              `Numbered measures can't sit inside a "${key}:" repeat — a repeat has no fixed bar to anchor them to.`,
            );
          }
        }
        for (let pass = 0; pass < parseInt(match[1], 10); pass++) out.push(...inner);
      }
      continue;
    }
    out.push(item as string | PlayDirective);
  }
  return out;
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
    drums: props.kit != null,
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
      // A directive item is the mapping form of a `set` patch — route both
      // through applyPatch so tempo/velocity bookkeeping stays in one place.
      applyPatch({
        scale: item.scale,
        octave: item.octave,
        velocity: item.velocity,
        gate: item.gate,
        strum: item.strum,
        voices: item.voices,
        measure: item.measure,
        tempo: item.tempo !== undefined ? { bpm: item.tempo, overMeasures: 0 } : undefined,
      }, beat);
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
// Sections — named song parts with parallel instrument tracks inside
// ---------------------------------------------------------------------------

/** Keys of a section mapping that are NOT instrument tracks. */
const SECTION_KEYS = new Set(['loop', 'wait']);

/** Section-track props that compile into play directives. */
const SECTION_DIRECTIVE_PROPS = [
  'scale', 'octave', 'velocity', 'gate', 'tempo', 'measure', 'strum', 'voices',
] as const;

const SECTION_TRACK_KEYS = new Set(['wait', 'set', 'play', ...SECTION_DIRECTIVE_PROPS]);

/** Does this measure string occupy a bar slot (vs a directive that takes none)? */
function occupiesBar(text: string): boolean {
  return text.trim() !== '' && !isDirectiveString(text) &&
    splitTopLevel(text).some((t) => !isSetToken(t) && !isScaleToken(t));
}

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
  for (const [name, node] of Object.entries(doc.tracks ?? {})) {
    if (node && typeof node === 'object' && (node.play != null || node.tracks)) {
      throw new Error(
        `With "sections:", the top-level track "${name}" declares the instrument only ` +
          `(sample, kit, controls…) — its music lives inside the sections.`,
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
  const emit = (name: string, section: SectionNode, withWaits: boolean) => {
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
      for (const key of SECTION_DIRECTIVE_PROPS) {
        if (node[key] !== undefined) (overrides as Record<string, unknown>)[key] = node[key];
      }
      if (node.set !== undefined) overrides.set = node.set;
      if (Object.keys(overrides).length) list.push(overrides);

      let rel = 0; // section-relative bar of the next plain measure string
      for (const item of playItems(node.play ?? [])) {
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
    for (let pass = 0; pass < times; pass++) emit(name, section, pass === 0);
  }
  if (cycle.length) {
    // Waits inside the looping tail play once: compile a waited pass before
    // the loop point, then the clean pass that repeats forever.
    const hasWaits = cycle.some(([name, section]) =>
      (section.wait ?? 0) > 0 ||
      sectionTracks(name, section).some(([, node]) => (node.wait ?? 0) > 0));
    if (hasWaits) for (const [name, section] of cycle) emit(name, section, true);
    loopStartBar = cursor;
    for (const [name, section] of cycle) emit(name, section, !hasWaits);
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

const INHERITED: (keyof TrackProps)[] = [
  'tempo', 'measure', 'sample', 'scale', 'octave', 'channel', 'program', 'velocity',
  'gate', 'dynamic', 'articulation', 'controls', 'strum', 'voices', 'strumTail', 'kit',
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
    if (patch.strum !== undefined) props.strum = patch.strum;
    if (patch.voices !== undefined) props.voices = patch.voices;
    if (patch.strumTail !== undefined) props.strumTail = patch.strumTail;
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
    throw new Error('Score must be a mapping with a "play:", "sections:" or "tracks:" key.');
  }

  const { doc: expanded, loopStartBar } = expandSections(doc);
  doc = expanded;

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
      // Kit tracks live on GM percussion channel 10 (all of them — that is
      // the channel's job) and take no program change; melodic auto-assign
      // skips 10 so a large score never leaks notes onto the drum channel.
      if (nextChannel === 10) nextChannel++;
      tracks.push({
        name,
        channel: props.channel ?? (props.kit != null ? 10 : nextChannel++),
        sample,
        // `kit: 808` reads as a YAML number — normalize so consumers compare strings.
        kit: props.kit != null ? String(props.kit) : undefined,
        program: props.kit != null ? undefined
          : props.program ?? SAMPLE_PROGRAMS[sample.toLowerCase()],
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
    // Loop markers assume the root meter at the cycle boundary (numbered
    // jumps make the same assumption).
    loopStartBeats: loopStartBar != null
      ? round(loopStartBar * measureToBeats(rootProps.measure))
      : undefined,
    tempoMap: [...byTime.values()].sort((a, b) => a.time - b.time),
    tracks,
  };
}
