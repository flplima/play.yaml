'use strict';

/**
 * set.ts — the `set` shorthand: "g lydian, octave up" patches several props at
 * once. Used by track-level `set:`, play-list directives, inline `||…||`
 * tokens, and bare expression-mark strings.
 */

import { parseScale } from './theory';
import { isMeasureToken, splitTopLevel } from './tokens';
import { normalizeHumanize } from './generate';
import {
  ARTICULATIONS, CONTROL_TERMS, ControlSpec, DYNAMICS, DYNAMIC_STEP, EXPRESSIONS,
  PEDAL_PATTERNS, PedalPattern, RUBATO_TERMS, TEMPO_GRADUAL, TEMPO_MARKS, TEMPO_RELATIVE,
  controlValue, resolveControl,
} from './vocabulary';

export interface SetPatch {
  /**
   * A pedalling pattern to run from here on, or null to stop pedalling.
   * Undefined leaves whatever is running alone.
   */
  pedal?: PedalPattern | null;
  scale?: string;
  octave?: number;
  octaveDelta?: number;
  velocity?: number;
  /** Relative dynamic step, for "louder" / "softer". */
  velocityDelta?: number;
  /** Gradual dynamic: reach `to` over `overMeasures` measures. */
  velocityRamp?: { to?: number; scale?: number; overMeasures: number };
  gate?: number;
  /** Rubato depth, 0 (strict) to 1 (very free). See `TrackProps.rubato`. */
  rubato?: number;
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
  /** Seed for chance/humanize and seeded generators ("seed 42"). */
  seed?: number;
  /** Probability each struck note sounds, 0..1 ("chance 0.6", "chance off"). */
  chance?: number;
  /** Seeded timing/velocity jitter ("humanize 0.5"); null = off. */
  humanize?: { time: number; velocity: number } | null;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

const clamp127 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** Split a `set:` string on commas, ignoring commas inside quotes. */
function splitClauses(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/**
 * A gradual mark: a stem, then "to <target>" and/or "over <measures>" in
 * either order ("rit. over 2 to 54", "cresc. to ff"). Trailing dots are
 * abbreviations. Null when the word has another shape or the stem does not
 * match `stems`.
 */
function parseGradual(
  word: string,
  stems: RegExp,
): { stem: string; target?: string; overMeasures: number } | null {
  const m = new RegExp(
    `^([a-z]+\\.?)(?:\\s+(to|over)\\s+([a-z]+\\.?|${NUM}))?(?:\\s+(to|over)\\s+([a-z]+\\.?|${NUM}))?$`,
    'i',
  ).exec(word);
  if (!m) return null;
  const stem = m[1].toLowerCase().replace(/\.$/, '');
  if (!stems.test(stem)) return null;
  let target: string | undefined;
  let over: string | undefined;
  for (const [kind, value] of [[m[2], m[3]], [m[4], m[5]]]) {
    if (kind?.toLowerCase() === 'to') target = value.toLowerCase().replace(/\.$/, '');
    else if (kind?.toLowerCase() === 'over') over = value;
  }
  return { stem, target, overMeasures: over ? Number(over) : 1 };
}

/**
 * Parse a `set` value (a string of comma-separated clauses, or an array of
 * such strings) into a prop patch. Clauses:
 *   "g lydian" / "c mix"          → scale (abbreviations welcome)
 *   "octave up" / "oct down"      → relative octave shift
 *   "octave 3" / "oct 3"          → absolute octave
 *   "tempo 60" / "tempo 60 over 2" → tempo, optionally ramped over N measures
 *   "legato" / "detached" / "staccato" / "gate 1.05" → articulation
 *   "rubato" / "molto rubato" / "rubato 0.4" / "a battuta" → rubato depth
 *   "velocity 90"                 → dynamics
 *   "cc74 30"                     → a raw control change
 *   "bow 30"                      → a control change via the track's `controls`
 *
 * `ignoreMissingControls` is classification mode (see isDirectiveString): a
 * technique word counts as a clause even when the track has not mapped its
 * control, and "name value" clauses naming unknown controls are accepted.
 */
export function parseSet(
  value: string | string[],
  controls: Record<string, number | ControlSpec> = {},
  opts: { ignoreMissingControls?: boolean } = {},
): SetPatch {
  const patch: SetPatch = {};
  const clauses = (Array.isArray(value) ? value : [value])
    .flatMap((v) => splitClauses(String(v)))
    .map((c) => c.trim())
    .filter(Boolean);

  const addCc = (cc: number, val: number) => {
    (patch.ccs ??= []).push({ cc, value: clamp127(val) });
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

    // "rubato 0.4" — the worded marks ("molto rubato", "a battuta") come from
    // RUBATO_TERMS below, so this is only the numeric form.
    const rubato = new RegExp(`^rubato\\s+(${NUM})$`, 'i').exec(clause);
    if (rubato) {
      patch.rubato = Math.max(0, Math.min(1, Number(rubato[1])));
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

    if (RUBATO_TERMS[word] !== undefined) {
      patch.rubato = RUBATO_TERMS[word];
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

    // Pedalling patterns are checked before the plain control terms, because
    // "senza pedale" has to both cancel the pattern and lift the dampers.
    if (word in PEDAL_PATTERNS) {
      patch.pedal = PEDAL_PATTERNS[word];
      continue;
    }

    // Playing techniques: "sul tasto", "molto vibrato", "pizzicato".
    if (CONTROL_TERMS[word] !== undefined) {
      const { control, amount } = CONTROL_TERMS[word];
      const spec = resolveControl(controls, control);
      if (spec) {
        addCc(spec.cc, controlValue(spec, amount));
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
          to: clamp127(controlValue(spec, amount)),
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

    // Gradual marks: "ritardando", "rit. over 2 to 54", "allargando to adagio over 3".
    const gradual = parseGradual(word, /^([a-z]+)$/);
    if (gradual && TEMPO_GRADUAL[gradual.stem] !== undefined) {
      if (gradual.target !== undefined) {
        const bpm = TEMPO_MARKS[gradual.target] ?? Number(gradual.target);
        if (!Number.isFinite(bpm)) throw new Error(`Unknown tempo "${gradual.target}" in "${clause}".`);
        patch.tempo = { bpm, overMeasures: gradual.overMeasures };
      } else {
        patch.tempo = { scale: TEMPO_GRADUAL[gradual.stem], overMeasures: gradual.overMeasures };
      }
      continue;
    }

    // "crescendo", "cresc. over 2 to fortissimo", "diminuendo over 4".
    const hairpin = parseGradual(word, /^(crescendo|cresc|diminuendo|dim|decrescendo|decresc)$/);
    if (hairpin) {
      if (hairpin.target !== undefined) {
        const to = DYNAMICS[hairpin.target] ?? Number(hairpin.target);
        if (!Number.isFinite(to)) throw new Error(`Unknown dynamic "${hairpin.target}" in "${clause}".`);
        patch.velocityRamp = { to, overMeasures: hairpin.overMeasures };
      } else {
        const rising = /^cres/.test(hairpin.stem);
        patch.velocityRamp = { scale: rising ? 1.4 : 0.65, overMeasures: hairpin.overMeasures };
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

    // Generative state (docs/generative-design.md): "chance 0.6" ghosts
    // notes, "seed 42" re-rolls every stochastic feature, "humanize 0.5"
    // loosens timing and velocity. All deterministic per (seed, position).
    const chance = new RegExp(`^chance\\s+(off|${NUM})$`, 'i').exec(clause);
    if (chance) {
      const value = chance[1].toLowerCase() === 'off' ? 1 : Number(chance[1]);
      if (value < 0 || value > 1) {
        throw new Error(`"${clause}" — chance is a probability from 0 to 1 (or "off").`);
      }
      patch.chance = value;
      continue;
    }

    const seed = /^seed\s+(-?\d+)$/i.exec(clause);
    if (seed) {
      patch.seed = parseInt(seed[1], 10);
      continue;
    }

    const humanize = new RegExp(`^humanize\\s+(off|${NUM})$`, 'i').exec(clause);
    if (humanize) {
      if (humanize[1].toLowerCase() === 'off') {
        patch.humanize = null;
      } else {
        const amount = Number(humanize[1]);
        if (amount < 0) throw new Error(`"${clause}" — humanize is an intensity from 0 up (0.5 is subtle).`);
        patch.humanize = normalizeHumanize(amount) ?? null;
      }
      continue;
    }

    // Numeric control drifts: "bow to 110 over 4", "cc74 to 90 over 2".
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
      // not a scale
    }
    throw new Error(
      `Unknown set clause "${clause}" — expected a dynamic ("mezzoforte", "dolce", ` +
        `"crescendo to forte over 2"), a tempo ("allegro", "ritardando over 2", ` +
        `"a tempo", "tempo 60", "più lento"), an articulation ("legato", ` +
        `"staccato"), a rubato ("rubato", "molto rubato", "rubato 0.4", ` +
        `"a battuta"), a scale ("g lydian"), an octave ("oct up"), a meter ` +
        `("2/4"), or a control ("cc74 30").`,
    );
  }
  return patch;
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
    parseSet(trimmed, {}, { ignoreMissingControls: true });
    return true;
  } catch {
    return false;
  }
}
