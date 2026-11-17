'use strict';

/**
 * vocabulary.ts — the musical words the DSL understands: dynamics,
 * articulations, tempo marks, character marks, playing techniques, and the
 * named-control machinery that turns technique words into MIDI CCs.
 */

/** GM percussion channel (1-based): every kit track plays here. */
export const DRUM_CHANNEL = 10;
/** The kit that is synthesized rather than sampled from the orchestra. */
export const SYNTH_KIT = '808';
/**
 * The controllers the built-in instruments (bus.ts, vpo.ts) listen on.
 *
 * The General MIDI ones are also DEFAULT_CONTROLS, so a score reaches them
 * by name without declaring anything. The instrument-specific ones (playmode,
 * tremolo, sordino, vibratoRate) deliberately have no default: every sampler
 * maps them differently, so a score declares them under `controls:` — and to
 * hear them on the built-in orchestra it must use these numbers
 * (`controls: { playmode: 20, tremolo: 21 }`, as the README shows).
 */
export const CC = {
  vibrato: 1,
  /** Wind-controller expression; physical models read it beside `expression`. */
  breath: 2,
  volume: 7,
  pan: 10,
  expression: 11,
  sustain: 64,
  sostenuto: 66,
  soft: 67,
  pressure: 71,
  bow: 74,
  vibratoRate: 76,
  reverb: 91,
  chorus: 93,
  playmode: 20,
  tremolo: 21,
  sordino: 22,
} as const;

/** Fraction of a slot a note actually sounds, so repeated notes re-articulate. */
export const DEFAULT_GATE = 0.9;

/**
 * Named articulations → gate. Values above 1 overlap into the next slot, which
 * is what tells a physical-model instrument to slur instead of re-attacking.
 */
export const ARTICULATIONS: Record<string, number> = {
  staccatissimo: 0.25,
  spiccato: 0.3, // off-the-string bounce (pair with `off the string` on a modelled instrument)
  staccato: 0.4,
  short: 0.4,
  portato: 0.7,
  detached: DEFAULT_GATE,
  separate: DEFAULT_GATE,
  tenuto: 0.98,
  // Sustained — notes given their full value and a shade more. Gate only, so
  // it shapes length without touching the dynamic it follows.
  sostenuto: 1.02,
  legato: 1.05,
  smooth: 1.05,
  slurred: 1.05,
  slur: 1.05,
};

/** Dynamic marks → MIDI velocity. */
export const DYNAMICS: Record<string, number> = {
  pianississimo: 16,
  pianissimo: 32,
  piano: 48,
  quiet: 48,
  mezzopiano: 64,
  mezzoforte: 80,
  forte: 96,
  loud: 96,
  fortissimo: 112,
  fortississimo: 127,
};

/** How much one "louder" / "softer" step moves the velocity. */
export const DYNAMIC_STEP = 16;

/** How much velocity one `>` accent adds to a note. */
export const ACCENT_STEP = 16;

/** Default roll spread for `~`-marked chords, in beats between notes. */
export const DEFAULT_STRUM = 0.03;

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
 * Immediate relative tempo words → the ratio applied to the running tempo.
 * Unlike the gradual words below these take effect at once, the way a player
 * reads "più lento" at a section boundary.
 */
export const TEMPO_RELATIVE: Record<string, number> = {
  'piu lento': 0.75,
  'meno mosso': 0.8,
  'piu mosso': 1.25,
};

/** Gradual tempo words → the ratio they move the pulse by. */
export const TEMPO_GRADUAL: Record<string, number> = {
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

/**
 * Rubato — "stolen time" — as depth, 0 (strict) to 1 (very free). The marks
 * that cancel it are the ones a score uses: `a battuta` ("to the beat") and
 * `tempo giusto` ("strict time") both mean stop stretching and play straight.
 */
export const RUBATO_TERMS: Record<string, number> = {
  rubato: 0.5,
  'tempo rubato': 0.5,
  'poco rubato': 0.25,
  'molto rubato': 0.85,
  'senza rubato': 0,
  'no rubato': 0,
  'a battuta': 0,
  'tempo giusto': 0,
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
 * Pedalling *patterns* — the part a single CC value cannot express.
 *
 * A held damper is a static value; real pedalling is a rhythm. These say when
 * the pedal moves, and the compiler emits the changes bar by bar so the
 * pattern follows meter changes and tempo without being written out by hand.
 *
 *   pedale sincopato  the pianist's legato pedal: lift exactly on the new
 *                     harmony and catch it again immediately, so the bass
 *                     connects and the previous bar does not smear into it.
 *                     This is the pedalling BWV 846 is always played with.
 *   pedal per bar     press on the downbeat, release before the next — each
 *                     bar rings alone, nothing carries across the barline.
 *   pedal per beat    the same, once a beat, for slow harmonic rhythm.
 *   senza pedale      cancel the pattern and let the dampers down.
 */
export interface PedalPattern {
  /** 'legato' lifts on the beat and re-takes; 'direct' presses and releases. */
  style: 'legato' | 'direct';
  unit: 'bar' | 'beat';
  /** How far down, as a 0-to-1 amount along the pedal control's range. */
  depth: number;
}

export const PEDAL_PATTERNS: Record<string, PedalPattern | null> = {
  'pedale sincopato': { style: 'legato', unit: 'bar', depth: 1 },
  'syncopated pedal': { style: 'legato', unit: 'bar', depth: 1 },
  'legato pedal': { style: 'legato', unit: 'bar', depth: 1 },
  'pedal per bar': { style: 'direct', unit: 'bar', depth: 1 },
  'pedale per battuta': { style: 'direct', unit: 'bar', depth: 1 },
  'pedal per beat': { style: 'direct', unit: 'beat', depth: 1 },
  'half pedal per bar': { style: 'legato', unit: 'bar', depth: 0.5 },
  'senza pedale': null,
  'pedal off': null,
  'no pedal': null,
};

/** How a named control maps onto a CC, and over what range. */
export interface ControlSpec {
  cc: number;
  min?: number;
  max?: number;
  /**
   * How a 0-to-1 technique amount lands on this control's CC:
   *
   *   range: 110            → 0 … 110   (a ceiling; the pedal that only ever
   *                                      goes three-quarters down)
   *   range: [40, 100]      → 40 … 100  (a usable band; write it backwards to
   *                                      invert a control that runs the other way)
   *   range: [0, 20, 90, 110] → a curve through those breakpoints, evenly
   *                             spaced across the amount. Instruments are
   *                             rarely linear — this is where you say that the
   *                             first half of the pedal does almost nothing
   *                             and the last quarter does most of the damping.
   *
   * `min`/`max` still work and mean the same as the two-value form.
   */
  range?: number | number[];
}

/** The breakpoints an amount is interpolated across. */
function controlCurve(spec: ControlSpec): number[] {
  if (Array.isArray(spec.range) && spec.range.length) {
    return spec.range.length === 1 ? [0, spec.range[0]] : [...spec.range];
  }
  if (typeof spec.range === 'number') return [0, spec.range];
  return [spec.min ?? 0, spec.max ?? 127];
}

/**
 * Place a 0-to-1 technique amount on a control, following its curve. Two
 * breakpoints is the straight line this always used to be.
 */
export function controlValue(spec: ControlSpec, amount: number): number {
  const points = controlCurve(spec);
  if (points.length === 1) return points[0];
  const t = Math.max(0, Math.min(1, amount));
  const spans = points.length - 1;
  const pos = t * spans;
  const i = Math.min(spans - 1, Math.floor(pos));
  return points[i] + (points[i + 1] - points[i]) * (pos - i);
}

/**
 * Conventional CCs for the named controls, so the playing-technique words
 * below work untouched. Override per track with `controls:` to match your
 * instrument's own MIDI mapping.
 */
export const DEFAULT_CONTROLS: Record<string, ControlSpec> = {
  bow: { cc: CC.bow }, // bow position / brightness
  pressure: { cc: CC.pressure },
  vibrato: { cc: CC.vibrato }, // modulation, the near-universal vibrato control
  pedal: { cc: CC.sustain }, // damper — the piano pedal every score means by "pedal"
  sostenuto: { cc: CC.sostenuto }, // middle pedal: holds what is already down
  soft: { cc: CC.soft }, // una corda
  // The mix controls. Unlike the instrument controls above — where every
  // sampler has its own idea of which CC does what — these four are fixed by
  // General MIDI, so a score can reach for them without declaring anything.
  volume: { cc: CC.volume }, // the channel fader, not the playing
  pan: { cc: CC.pan }, // 64 is centre
  reverb: { cc: CC.reverb }, // send into the room, not a room of its own
  chorus: { cc: CC.chorus },
};

/**
 * Other names a score may have declared the same control under, so
 * `controls: { sustain: … }` still answers to the pedal words.
 */
const CONTROL_ALIASES: Record<string, string[]> = {
  pedal: ['sustain', 'damper'],
  soft: ['una corda', 'softpedal'],
  sostenuto: ['middle'],
  expression: ['expr'],
};

/**
 * Playing techniques → a position from 0 to 1 along a named control, which is
 * then scaled into that control's range. Bow position runs from over the
 * fingerboard (0) to at the bridge (1); if your instrument maps it the other
 * way, invert the range in `controls:` rather than rewriting the score.
 */
export const CONTROL_TERMS: Record<string, { control: string; amount: number }> = {
  // ── the piano pedals ──
  // Depth, not timing. `range:` on the control decides what "full" is worth,
  // so an instrument whose damper only wants 110 says so once in `controls:`.
  'senza pedale': { control: 'pedal', amount: 0 },
  'pedal up': { control: 'pedal', amount: 0 },
  'quarter pedal': { control: 'pedal', amount: 0.25 },
  'mezzo pedale': { control: 'pedal', amount: 0.5 },
  'half pedal': { control: 'pedal', amount: 0.5 },
  'three quarter pedal': { control: 'pedal', amount: 0.75 },
  'con pedale': { control: 'pedal', amount: 1 },
  'pedal down': { control: 'pedal', amount: 1 },
  'una corda': { control: 'soft', amount: 1 },
  'tre corde': { control: 'soft', amount: 0 },

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
  scratch: { control: 'pressure', amount: 1 }, // full bow overpressure

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

  // ── bowed tremolo (the instrument's own auto-tremolo, not written-out 32nds) ──
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

  // ── left-hand position (a modelled instrument's fingering option): where notes are
  //    fingered, and whether open strings are allowed to ring ──
  'mid position': { control: 'fingering', amount: 0 },
  'high position': { control: 'fingering', amount: 0.5 }, // near the bridge
  'open strings': { control: 'fingering', amount: 1 }, // near the nut + open

  // ── the room (CC91) ──
  // One send into one shared room, so these words say how far back in it the
  // player stands — not which hall it is. "cathedral" is a track drenched in
  // the same reverb "room" barely touches.
  secco: { control: 'reverb', amount: 0 },
  dry: { control: 'reverb', amount: 0 },
  'no reverb': { control: 'reverb', amount: 0 },
  'senza riverbero': { control: 'reverb', amount: 0 },
  'small room': { control: 'reverb', amount: 0.2 },
  room: { control: 'reverb', amount: 0.3 },
  stage: { control: 'reverb', amount: 0.45 },
  reverb: { control: 'reverb', amount: 0.5 },
  hall: { control: 'reverb', amount: 0.62 },
  church: { control: 'reverb', amount: 0.8 },
  'in chiesa': { control: 'reverb', amount: 0.8 },
  cathedral: { control: 'reverb', amount: 0.95 },

  // ── chorus (CC93) ──
  // The organ and string-machine names are here because that is what those
  // stops are: ranks tuned slightly apart, beating against each other.
  'no chorus': { control: 'chorus', amount: 0 },
  'senza chorus': { control: 'chorus', amount: 0 },
  'unda maris': { control: 'chorus', amount: 0.35 }, // the gentler celeste rank
  'light chorus': { control: 'chorus', amount: 0.3 },
  chorus: { control: 'chorus', amount: 0.55 },
  celeste: { control: 'chorus', amount: 0.6 },
  'voix celeste': { control: 'chorus', amount: 0.6 },
  ensemble: { control: 'chorus', amount: 0.7 },
  'wide chorus': { control: 'chorus', amount: 0.85 },

  // ── pan (CC10) ──
  // Where the player sits. Centre is 0.5 and lands exactly on 64.
  'hard left': { control: 'pan', amount: 0 },
  'pan left': { control: 'pan', amount: 0.25 },
  'pan centre': { control: 'pan', amount: 0.5 },
  'pan center': { control: 'pan', amount: 0.5 },
  'pan right': { control: 'pan', amount: 0.75 },
  'hard right': { control: 'pan', amount: 1 },

  // ── the fader (CC7) ──
  // Not a dynamic: "piano" is how the part is played, "fade out" is the
  // channel being pulled down under it. Both worth having, and they multiply.
  //
  // These are worth most with a span — "fade out over 4" — but a drift starts
  // from wherever the fader last sat, so a score that has never touched CC7
  // needs to plant it first: `set: volume 0` then `fade in over 4`.
  'fade out': { control: 'volume', amount: 0 },
  'fade in': { control: 'volume', amount: 1 },
  'full volume': { control: 'volume', amount: 1 },
};

/** Resolve a named control to its CC and range, falling back to convention. */
export function resolveControl(
  controls: Record<string, number | ControlSpec> | undefined,
  name: string,
): ControlSpec | undefined {
  let declared = controls?.[name];
  // A score that wrote `sustain:` still means the pedal.
  if (declared === undefined) {
    for (const alias of CONTROL_ALIASES[name] ?? []) {
      if (controls?.[alias] !== undefined) {
        declared = controls[alias];
        break;
      }
    }
  }
  const spec = typeof declared === 'number' ? { cc: declared } : declared ?? DEFAULT_CONTROLS[name];
  return spec && { min: 0, max: 127, ...spec };
}

/** One drum voice: its GM percussion key. */
export interface DrumSpec {
  note: number;
}

/**
 * Drum tokens for `kit:` tracks → General MIDI percussion keys, so scores
 * play on any GM synth and export cleanly to .mid. Aliases point at the same
 * spec; the sampler maps the same names onto recorded hits.
 */
export const DRUMS: Record<string, DrumSpec> = {
  // ── the kit ──
  bd: { note: 36 }, // bass drum
  sd: { note: 38 }, // snare
  rim: { note: 37 }, // side stick
  cp: { note: 39 }, // hand clap
  hh: { note: 42 }, // closed hi-hat
  ph: { note: 44 }, // pedal hi-hat
  oh: { note: 46 }, // open hi-hat
  ft: { note: 41 }, // floor tom
  lt: { note: 45 }, // low tom
  mt: { note: 47 }, // mid tom
  ht: { note: 50 }, // high tom
  cy: { note: 49 }, // crash
  crash2: { note: 57 },
  splash: { note: 55 },
  china: { note: 52 },
  rd: { note: 51 }, // ride
  rb: { note: 53 }, // ride bell

  // ── hand percussion ──
  cb: { note: 56 }, // cowbell
  tamb: { note: 54 },
  vibraslap: { note: 58 },
  bongo: { note: 60 }, // high bongo
  lbongo: { note: 61 },
  quinto: { note: 62 }, // the high conga (GM mute hi conga slot)
  conga: { note: 63 }, // open hi conga
  tumba: { note: 64 }, // the low conga
  timbale: { note: 65 },
  ltimbale: { note: 66 },
  agogo: { note: 67 },
  lagogo: { note: 68 },
  cabasa: { note: 69 },
  maracas: { note: 70 },
  guiro: { note: 74 }, // long stroke
  sguiro: { note: 73 }, // short stroke
  clave: { note: 75 },
  wb: { note: 76 }, // high woodblock
  lwb: { note: 77 },
  cuica: { note: 79 },
  mcuica: { note: 78 },
  tri: { note: 81 }, // open triangle
  mtri: { note: 80 }, // muted triangle
  whistle: { note: 72 },
  swhistle: { note: 71 },
  shaker: { note: 82 }, // GM2; falls back near maracas on GM1 synths
  sleigh: { note: 83 }, // GM2 jingle bell
  belltree: { note: 84 }, // GM2 bell tree
};

/** Longhand spellings → the canonical drum tokens above. */
const DRUM_ALIASES: Record<string, string> = {
  kick: 'bd', bassdrum: 'bd',
  sn: 'sd', snare: 'sd',
  rs: 'rim', sidestick: 'rim',
  clap: 'cp',
  ch: 'hh', hat: 'hh', closedhat: 'hh',
  pedalhat: 'ph',
  openhat: 'oh',
  floortom: 'ft', lowtom: 'lt', midtom: 'mt', hightom: 'ht', tom: 'mt',
  crash: 'cy',
  ride: 'rd', ridebell: 'rb',
  cowbell: 'cb',
  tambourine: 'tamb',
  claves: 'clave',
  woodblock: 'wb',
  triangle: 'tri',
};
for (const [alias, canonical] of Object.entries(DRUM_ALIASES)) {
  DRUMS[alias] = DRUMS[canonical];
}

// Canonical names come before their aliases above, so first-wins is canonical.
const DRUM_NAMES: Record<number, string> = {};
for (const [name, spec] of Object.entries(DRUMS)) {
  DRUM_NAMES[spec.note] ??= name;
}

/** Canonical name for a GM percussion key (aliases resolve to the short form). */
export function drumName(note: number): string | undefined {
  return DRUM_NAMES[note];
}

/** Resolve a drum token ("bd", "snare", or a raw GM number) in a kit track. */
export function resolveDrum(token: string): DrumSpec | undefined {
  if (/^\d+$/.test(token)) return { note: parseInt(token, 10) & 0x7f };
  return DRUMS[token.toLowerCase()];
}

/**
 * Built-in sample names → General MIDI program, for .mid export. The
 * orchestral names are the ones the VPO sampler plays (core/src/vpo.ts);
 * sections share their solo instrument's program, as GM has no other.
 */
export const PRESET_PROGRAMS: Record<string, number> = {
  piano: 0,
  epiano: 4,
  keys: 4,
  celesta: 8,
  glockenspiel: 9,
  vibraphone: 11,
  xylophone: 13,
  'tubular-bells': 14,
  chimes: 14,
  bells: 14,
  glock: 9,
  vibes: 11,
  clav: 7,
  pluck: 45,
  synth: 80,
  synth_piano: 4,
  voice: 52,
  voices: 52,
  vocals: 52,
  sopranos: 52,
  women: 52,
  tenors: 52,
  men: 52,
  bass: 33,
  violin: 40,
  violins: 40,
  '2nd-violins': 40, // GM has one violin program; the second section shares it
  fiddle: 40,
  viola: 41,
  violas: 41,
  cello: 42,
  cellos: 42,
  contrabass: 43,
  'double-bass': 43,
  'string-bass': 43,
  'upright-bass': 32,
  basses: 43,
  harp: 46,
  timpani: 47,
  strings: 48,
  choir: 52,
  'choir-female': 52,
  'choir-male': 52,
  trumpet: 56,
  trumpets: 56,
  trombone: 57,
  trombones: 57,
  'bass-trombone': 57,
  tuba: 58,
  horn: 60,
  'french-horn': 60,
  horns: 60,
  brass: 61,
  oboe: 68,
  oboes: 68,
  'english-horn': 69,
  'cor-anglais': 69,
  bassoon: 70,
  bassoons: 70,
  contrabassoon: 70,
  clarinet: 71,
  clarinets: 71,
  'bass-clarinet': 71,
  woodwinds: 71,
  piccolo: 72,
  flute: 73,
  flutes: 73,
  'alto-flute': 73,
  ocarina: 79,
  lead: 81,
  pad: 89,
};

/** The GM program for a `preset:` name ("French Horn" → 60), or undefined when we have none. */
export function presetProgram(preset: string): number | undefined {
  return PRESET_PROGRAMS[preset.trim().toLowerCase().replace(/[\s_]+/g, '-')]
    ?? PRESET_PROGRAMS[preset.trim().toLowerCase()];
}
