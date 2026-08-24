/**
 * vpo.ts — the Virtual Playing Orchestra as play.yaml's built-in instruments.
 *
 * VPO (virtualplaying.com, free) is the orchestra jukebox hosts on its
 * channels 4–6, so the studio's own playback uses the very same recordings:
 * a score previewed in the browser and the same score played on the rack
 * differ in the engine, not the sound. Every `sample:` name a score can use
 * maps here to a family of SFZ programs — a sustain program plus, where the
 * library has them, pizzicato, tremolo and staccato ones, chosen per note
 * from what the control stream says (`pizzicato`, `tremolo`) and how short
 * the note is. Kit tracks land on the orchestral percussion, key by key, and
 * fall through to the synthesized kit for anything the orchestra does not
 * own (a hi-hat, a cuica).
 *
 * Nothing is bundled. A program is fetched when a track first needs it and
 * only the samples the track's notes reach are downloaded; the browser gets
 * them from the dev server's `/vpo/` route, the server reads the library off
 * disk, and both go through `SfzAssets`.
 *
 * There is no piano in VPO. `piano`, `keys` and the synth names keep the
 * oscillator presets in synth.ts.
 */

import type { CompiledSong, CompiledTrack } from './song';
import type { TrackBus } from './bus';
import type { ScheduleDrums, ScheduleInstrument, ScheduleMelodic } from './schedule';
import { SfzProgram, startNote, type NoteRequest, type SfzAssets } from './sfzSampler';
import { playDrum } from './synth';

export type { SfzAssets } from './sfzSampler';

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/** The programs one `sample:` name plays on, all relative to the library root. */
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

/** DSL `sample:` names → VPO programs. Aliases share an entry. */
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

/** Canonical catalogue key for a `sample:` name ("French Horn" → "horn"), or undefined. */
export function vpoNameFor(sample: string | undefined): string | undefined {
  if (!sample) return undefined;
  const key = sample.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const name = VPO_ALIASES[key] ?? key;
  return VPO_INSTRUMENTS[name] ? name : undefined;
}

export function vpoVoicingFor(sample: string | undefined): VpoVoicing | undefined {
  const name = vpoNameFor(sample);
  return name ? VPO_INSTRUMENTS[name] : undefined;
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

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Notes shorter than this play from the staccato recordings. */
const STACCATO_MAX_SEC = 0.18;
/**
 * The orchestra against the synth presets. VPO's own `volume` opcodes are
 * balanced for a DAW with headroom to spare — a forte solo cello renders at
 * -13 dBFS, twenty decibels over the synth piano — so the whole library is
 * brought down 12 dB, which puts a solo line above a synth accompaniment
 * without four tracks clipping the master.
 */
const VPO_TRIM = 0.25;
const PLAYMODE_CC = 20;
const TREMOLO_CC = 21;

/**
 * One library per context: programs parsed once and shared by every track
 * that plays them, and every render that runs on that context.
 */
const libraries = new WeakMap<BaseAudioContext, Map<string, Promise<SfzProgram>>>();

function program(ctx: BaseAudioContext, assets: SfzAssets, path: string): Promise<SfzProgram> {
  let programs = libraries.get(ctx);
  if (!programs) libraries.set(ctx, (programs = new Map()));
  let promise = programs.get(path);
  if (!promise) {
    promise = SfzProgram.load(ctx, assets, path).catch((err) => {
      programs!.delete(path);
      throw err;
    });
    programs.set(path, promise);
  }
  return promise;
}

/** The notes a track will ask a program for, for `prepare`. */
function requests(track: CompiledTrack): NoteRequest[] {
  return track.timeline.map((n) => ({ midi: n.midi, velocity: n.velocity }));
}

/** Seconds a note lasts at the song's root tempo — enough to tell staccato from held. */
function noteSeconds(song: CompiledSong, duration: number): number {
  return (duration * 60) / (song.bpm || 120);
}

/**
 * Load a melodic track's instrument: the programs its control stream and
 * note lengths will reach, and their samples for the notes it plays.
 */
async function loadMelodic(
  ctx: BaseAudioContext,
  assets: SfzAssets,
  song: CompiledSong,
  track: CompiledTrack,
  voicing: VpoVoicing,
): Promise<ScheduleMelodic> {
  const controls = track.controls ?? [];
  const wantsPizz = voicing.defaultMode === 'pizz' || controls.some((c) => c.cc === PLAYMODE_CC && c.value >= 32);
  const wantsArco = voicing.defaultMode !== 'pizz' || controls.some((c) => c.cc === PLAYMODE_CC && c.value < 32);
  const wantsTremolo = controls.some((c) => c.cc === TREMOLO_CC && c.value >= 32);
  const wantsStaccato = track.timeline.some((n) => noteSeconds(song, n.duration) <= STACCATO_MAX_SEC);

  const paths = {
    sustain: wantsArco || !voicing.pizz ? voicing.sustain : undefined,
    pizz: wantsPizz ? voicing.pizz : undefined,
    tremolo: wantsTremolo ? voicing.tremolo : undefined,
    staccato: wantsStaccato && wantsArco ? voicing.staccato : undefined,
  };
  const notes = requests(track);
  const loaded: Partial<Record<keyof typeof paths, SfzProgram>> = {};
  await Promise.all(
    (Object.keys(paths) as Array<keyof typeof paths>).map(async (kind) => {
      const path = paths[kind];
      if (!path) return;
      try {
        const p = await program(ctx, assets, path);
        await p.prepare(notes);
        loaded[kind] = p;
      } catch (err) {
        // A program that will not load leaves its articulation to the
        // sustain one; a sustain that will not load leaves the track silent,
        // and says so once.
        console.warn(`vpo: ${path} unavailable:`, err);
      }
    }),
  );

  const defaultPizz = voicing.defaultMode === 'pizz';
  const play = (bus: TrackBus, midi: number, velocity: number, time: number, duration: number) => {
    const plucked = bus.state.playmode === 'pizz' || (bus.state.playmode === 'default' && defaultPizz);
    let chosen: SfzProgram | undefined;
    if (plucked) chosen = loaded.pizz;
    else if (bus.state.tremolo) chosen = loaded.tremolo;
    else if (duration <= STACCATO_MAX_SEC) chosen = loaded.staccato;
    chosen ??= loaded.sustain ?? loaded.pizz;
    if (!chosen) return;
    startNote({
      program: chosen,
      bus,
      midi,
      velocity,
      start: time,
      end: time + duration,
      flattenVelocity: bus.hasExpression,
      trim: VPO_TRIM,
    });
  };
  return { kind: 'melodic', play };
}

async function loadKit(
  ctx: BaseAudioContext,
  assets: SfzAssets,
  track: CompiledTrack,
): Promise<ScheduleDrums> {
  // Which programs this track's hits reach, and which keys in each.
  const wanted = new Map<string, NoteRequest[]>();
  for (const note of track.timeline) {
    const mapped = VPO_KIT_KEYS[note.midi];
    if (!mapped) continue;
    const list = wanted.get(mapped[0]) ?? wanted.set(mapped[0], []).get(mapped[0])!;
    list.push({ midi: mapped[1], velocity: note.velocity });
  }
  const loaded = new Map<string, SfzProgram>();
  await Promise.all(
    [...wanted].map(async ([path, notes]) => {
      try {
        const p = await program(ctx, assets, path);
        await p.prepare(notes);
        loaded.set(path, p);
      } catch (err) {
        console.warn(`vpo: ${path} unavailable:`, err);
      }
    }),
  );

  const play = (bus: TrackBus, midi: number, velocity: number, time: number) => {
    const mapped = VPO_KIT_KEYS[midi];
    const p = mapped && loaded.get(mapped[0]);
    // A key the orchestra has no recording for is the synthesized kit's —
    // so one score can mix a real snare with an 808 hi-hat.
    const started = p
      ? startNote({ program: p, bus, midi: mapped[1], velocity, start: time, end: Infinity, flattenVelocity: false, trim: VPO_TRIM })
      : 0;
    if (!started) playDrum(bus.ctx, bus.input, midi, velocity, time);
  };
  return { kind: 'drums', play };
}

/**
 * The orchestra for a song: one instrument per track that has one, samples
 * for its notes already fetched. Tracks the orchestra does not cover (a
 * piano, a synth pad, the 808 kit) are absent, and the caller plays them on
 * the synth presets as before. Hand the result to `scheduleSong`'s
 * `instrumentFor`, or to the live player, by track name.
 */
export async function prepareVpo(
  ctx: BaseAudioContext,
  assets: SfzAssets,
  song: CompiledSong,
  opts: { onlyTracks?: string[] } = {},
): Promise<Map<string, ScheduleInstrument>> {
  const instruments = new Map<string, ScheduleInstrument>();
  const tracks = song.tracks.filter((t) => !opts.onlyTracks || opts.onlyTracks.includes(t.name));
  await Promise.all(
    tracks.map(async (track) => {
      if (!track.timeline.length) return;
      if (track.kit) {
        if (track.kit === '808') return;
        instruments.set(track.name, await loadKit(ctx, assets, track));
        return;
      }
      const voicing = vpoVoicingFor(track.sample);
      if (!voicing) return;
      instruments.set(track.name, await loadMelodic(ctx, assets, song, track, voicing));
    }),
  );
  return instruments;
}

/** Whether a track plays on the orchestra at all (as opposed to a synth preset). */
export function tracksOnVpo(track: { sample?: string; kit?: string }): boolean {
  if (track.kit) return track.kit !== '808';
  return vpoVoicingFor(track.sample) !== undefined;
}
