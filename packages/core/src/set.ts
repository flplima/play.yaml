'use strict';

/**
 * set.ts — the `set` shorthand: "g lydian, octave up" patches several props at
 * once. Used by track-level `set:`, play-list directives, inline `||…||`
 * tokens, and bare expression-mark strings.
 */

import { parseScale } from './theory';
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
  measure?: string | number;
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

const clamp127 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

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
    const gradualMatch = new RegExp(
      `^([a-z]+\\.?)(?:\\s+(to|over)\\s+([a-z]+\\.?|${NUM}))?(?:\\s+(to|over)\\s+([a-z]+\\.?|${NUM}))?$`,
      'i',
    ).exec(word);

    if (gradualMatch) {
      const stem = gradualMatch[1].toLowerCase().replace(/\.$/, '');
      if (TEMPO_GRADUAL[stem] !== undefined) {
        let targetStr: string | undefined;
        let overStr: string | undefined;

        const p1Type = gradualMatch[2]?.toLowerCase();
        const p1Val = gradualMatch[3];
        const p2Type = gradualMatch[4]?.toLowerCase();
        const p2Val = gradualMatch[5];

        if (p1Type === 'to') targetStr = p1Val;
        else if (p1Type === 'over') overStr = p1Val;

        if (p2Type === 'to') targetStr = p2Val;
        else if (p2Type === 'over') overStr = p2Val;

        const overMeasures = overStr ? Number(overStr) : 1;

        if (targetStr !== undefined) {
          const cleanTarget = targetStr.toLowerCase().replace(/\.$/, '');
          const bpm = TEMPO_MARKS[cleanTarget] ?? Number(cleanTarget);
          if (!Number.isFinite(bpm)) {
            throw new Error(`Unknown tempo "${targetStr}" in "${clause}".`);
          }
          patch.tempo = { bpm, overMeasures };
        } else {
          patch.tempo = { scale: TEMPO_GRADUAL[stem], overMeasures };
        }
        continue;
      }
    }

    // "crescendo", "cresc. over 2 to fortissimo", "diminuendo over 4".
    const hairpinMatch = new RegExp(
      `^(crescendo|cresc|diminuendo|dim|decrescendo|decresc)\\.?` +
        `(?:\\s+(to|over)\\s+([a-z]+\\.?|${NUM}))?(?:\\s+(to|over)\\s+([a-z]+\\.?|${NUM}))?$`,
      'i',
    ).exec(word);

    if (hairpinMatch) {
      const rising = /^cres/i.test(hairpinMatch[1]);
      let targetStr: string | undefined;
      let overStr: string | undefined;

      const p1Type = hairpinMatch[2]?.toLowerCase();
      const p1Val = hairpinMatch[3];
      const p2Type = hairpinMatch[4]?.toLowerCase();
      const p2Val = hairpinMatch[5];

      if (p1Type === 'to') targetStr = p1Val;
      else if (p1Type === 'over') overStr = p1Val;

      if (p2Type === 'to') targetStr = p2Val;
      else if (p2Type === 'over') overStr = p2Val;

      const overMeasures = overStr ? Number(overStr) : 1;

      if (targetStr !== undefined) {
        const cleanTarget = targetStr.toLowerCase().replace(/\.$/, '');
        const to = DYNAMICS[cleanTarget] ?? Number(cleanTarget);
        if (!Number.isFinite(to)) {
          throw new Error(`Unknown dynamic "${targetStr}" in "${clause}".`);
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
