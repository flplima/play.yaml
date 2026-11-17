/**
 * vpoCatalogue.ts — which Virtual Playing Orchestra programs each `preset:`
 * name plays on, and which orchestral percussion key each GM drum maps to.
 * Data only; vpo.ts loads and plays it.
 */

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/** The programs one `preset:` name plays on, all relative to the library root. */
export interface VpoVoicing {
  sustain: string;
  pizz?: string;
  tremolo?: string;
  staccato?: string;
  /** What the instrument does before the score says arco/pizz: a groove bass plucks. */
  defaultMode?: 'arco' | 'pizz';
}

const S = 'Strings';
const W = 'Woodwinds';
const B = 'Brass';
const P = 'Percussion';

const strings = (name: string, kind: 'SOLO' | 'SEC', tremolo = true): VpoVoicing => ({
  sustain: `${S}/${name}-${kind}-normal-mod-wheel.sfz`,
  pizz: `${S}/${name}-${kind}-pizzicato.sfz`,
  tremolo: tremolo ? `${S}/${name}-${kind}-tremolo.sfz` : undefined,
  staccato: `${S}/${name}-${kind}-staccato.sfz`,
});
const wind = (dir: string, name: string, kind: 'SOLO' | 'SEC'): VpoVoicing => ({
  sustain: `${dir}/${name}-${kind}-normal-mod-wheel.sfz`,
  staccato: `${dir}/${name}-${kind}-staccato.sfz`,
});

/** DSL `preset:` names → VPO programs. Aliases share an entry. */
export const VPO_INSTRUMENTS: Record<string, VpoVoicing> = {
  violin: strings('1st-violin', 'SOLO'),
  violins: strings('1st-violin', 'SEC'),
  '2nd-violins': strings('2nd-violin', 'SEC'),
  viola: strings('viola', 'SOLO', false),
  violas: strings('viola', 'SEC'),
  cello: strings('cello', 'SOLO', false),
  cellos: strings('cello', 'SEC'),
  contrabass: strings('bass', 'SOLO', false),
  bass: { ...strings('bass', 'SOLO', false), defaultMode: 'pizz' },
  basses: strings('bass', 'SEC'),
  strings: {
    sustain: `${S}/all-strings-SEC-normal-mod-wheel.sfz`,
    pizz: `${S}/all-strings-SEC-pizzicato.sfz`,
  },
  harp: { sustain: `${S}/harp-sustain.sfz`, staccato: `${S}/harp-dampened.sfz` },

  flute: wind(W, 'flute', 'SOLO'),
  flutes: wind(W, 'flute', 'SEC'),
  ocarina: wind(W, 'flute', 'SOLO'),
  piccolo: wind(W, 'piccolo', 'SOLO'),
  'alto-flute': wind(W, 'alto-flute', 'SOLO'),
  oboe: wind(W, 'oboe', 'SOLO'),
  oboes: wind(W, 'oboe', 'SEC'),
  'english-horn': wind(W, 'english-horn', 'SOLO'),
  clarinet: wind(W, 'clarinet', 'SOLO'),
  clarinets: wind(W, 'clarinet', 'SEC'),
  'bass-clarinet': wind(W, 'bass-clarinet', 'SOLO'),
  bassoon: wind(W, 'bassoon', 'SOLO'),
  bassoons: wind(W, 'bassoon', 'SEC'),
  contrabassoon: wind(W, 'contrabassoon', 'SOLO'),
  woodwinds: { sustain: `${W}/all-woodwinds-SEC-normal-mod-wheel.sfz` },

  trumpet: wind(B, 'trumpet', 'SOLO'),
  trumpets: wind(B, 'trumpet', 'SEC'),
  horn: wind(B, 'french-horn', 'SOLO'),
  horns: wind(B, 'french-horn', 'SEC'),
  trombone: wind(B, 'trombone', 'SOLO'),
  trombones: wind(B, 'trombone', 'SEC'),
  'bass-trombone': wind(B, 'bass-trombone', 'SOLO'),
  tuba: wind(B, 'tuba', 'SOLO'),
  brass: { sustain: `${B}/all-brass-SEC-normal-mod-wheel.sfz` },

  celesta: { sustain: 'Keys/celesta.sfz' },
  glockenspiel: { sustain: `${P}/glockenspiel.sfz` },
  xylophone: { sustain: `${P}/xylophone.sfz` },
  vibraphone: { sustain: `${P}/vibraphone-open.sfz` },
  'tubular-bells': { sustain: `${P}/tubular-bells.sfz` },
  timpani: { sustain: `${P}/timpani-hit.sfz`, tremolo: `${P}/timpani-roll.sfz` },

  choir: { sustain: 'Vocals/choir-MIXED-normal-mod-wheel.sfz' },
  'choir-female': { sustain: 'Vocals/choir-FEMALE-normal-mod-wheel.sfz' },
  'choir-male': { sustain: 'Vocals/choir-MALE-normal-mod-wheel.sfz' },
};

const VPO_ALIASES: Record<string, string> = {
  fiddle: 'violin',
  'double-bass': 'contrabass',
  'upright-bass': 'bass',
  'string-bass': 'contrabass',
  'french-horn': 'horn',
  'cor-anglais': 'english-horn',
  chimes: 'tubular-bells',
  bells: 'tubular-bells',
  glock: 'glockenspiel',
  vibes: 'vibraphone',
  voice: 'choir',
  voices: 'choir',
  vocals: 'choir',
  sopranos: 'choir-female',
  women: 'choir-female',
  tenors: 'choir-male',
  men: 'choir-male',
};

/** The programs for a `preset:` name ("French Horn" → horn), or undefined when the orchestra has none. */
export function vpoVoicingFor(preset: string): VpoVoicing | undefined {
  const key = preset.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return VPO_INSTRUMENTS[VPO_ALIASES[key] ?? key];
}

// ---------------------------------------------------------------------------
// Percussion: GM keys → the orchestra's own
// ---------------------------------------------------------------------------

const KIT = `${P}/bassdrum-snare-cymbals.sfz`;
const MISC = `${P}/misc.sfz`;

/**
 * General MIDI percussion key → [program, key in it]. The kit programs are
 * laid out close to GM already; where GM names something the orchestra has
 * (a snare, a crash, claves) the recording is used, and the rest is left to
 * the synthesized kit. Both programs' keys are as their files spell them.
 */
export const VPO_KIT_KEYS: Record<number, [string, number]> = {
  35: [KIT, 38], // acoustic bass drum → bass drum 2
  36: [KIT, 36], // bass drum 1
  37: [KIT, 56], // side stick → snare 2 tap
  38: [KIT, 49], // snare → snare 1, round-robin hands
  40: [KIT, 54], // electric snare → snare 2, round-robin
  49: [KIT, 61], // crash → cymbals 1 crash lo
  51: [KIT, 68], // ride → cymbals 2 stick hit
  52: [KIT, 70], // china → cymbals 2 crash hi
  53: [KIT, 68], // ride bell
  55: [KIT, 66], // splash → cymbals 2 crash lo
  57: [KIT, 63], // crash 2 → cymbals 1 crash hi
  59: [KIT, 68], // ride 2
  54: [MISC, 54], // tambourine
  56: [MISC, 56], // cowbell
  58: [MISC, 58], // vibraslap
  60: [MISC, 60], // hi bongo → quinto
  61: [MISC, 62], // lo bongo → conga
  62: [MISC, 61], // mute hi conga → quinto tap
  63: [MISC, 62], // open hi conga → conga hit
  64: [MISC, 64], // low conga → tumba
  69: [MISC, 69], // cabasa
  70: [MISC, 70], // maracas → shaker
  75: [MISC, 75], // claves
  76: [MISC, 77], // hi woodblock
  77: [MISC, 76], // lo woodblock
  80: [MISC, 80], // muted triangle
  81: [MISC, 81], // open triangle
  82: [MISC, 70], // shaker
  83: [MISC, 82], // sleigh bells
  84: [MISC, 84], // bell tree
};
