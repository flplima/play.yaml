'use strict';

/**
 * vocabulary.ts — the musical words the DSL understands: dynamics,
 * articulations, tempo marks, character marks, playing techniques, and the
 * named-control machinery that turns technique words into MIDI CCs.
 */

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

/** How a named control maps onto a CC, and over what range. */
export interface ControlSpec {
  cc: number;
  min?: number;
  max?: number;
}

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

/** One drum voice: its GM percussion key, and the choke group it silences. */
export interface DrumSpec {
  /** General MIDI percussion note (channel 10). */
  note: number;
  /** Sounding voices in the same group stop when this one starts (hi-hats). */
  choke?: string;
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
  hh: { note: 42, choke: 'hh' }, // closed hi-hat
  ph: { note: 44, choke: 'hh' }, // pedal hi-hat
  oh: { note: 46, choke: 'hh' }, // open hi-hat
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
