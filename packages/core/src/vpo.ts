/**
 * vpo.ts — the Virtual Playing Orchestra as play.yaml's built-in instruments
 * (the catalogue itself is vpoCatalogue.ts).
 *
 * VPO (virtualplaying.com, free) is the sample library behind every
 * orchestral `sample:` name. Every `sample:` name a score can use
 * maps here to a family of SFZ programs — a sustain program plus, where the
 * library has them, pizzicato, tremolo and staccato ones, chosen per note
 * from what the control stream says (`pizzicato`, `tremolo`) and how short
 * the note is. Kit tracks land on the orchestral percussion, key by key, and
 * fall through to the synthesized kit for anything the orchestra does not
 * own (a hi-hat, a cuica).
 *
 * Nothing is bundled. A program is fetched when a track first needs it and
 * only the samples the track's notes reach are downloaded; the browser gets
 * them from the dev server's `/vpo/` route, the CLI reads the library off
 * disk, and both go through `SfzAssets`.
 *
 * There is no piano in VPO. `piano`, `keys` and the synth names keep the
 * oscillator presets in synth.ts.
 */

import type { CompiledSong, CompiledTrack } from './song';
import type { TrackBus } from './bus';
import type { Orchestra, ScheduleDrums, ScheduleMelodic } from './schedule';
import { SfzProgram, startNote, type NoteRequest, type SfzAssets } from './sfzSampler';
import { playDrum } from './synth';
import { tempoSegments, beatsToSeconds } from './time';
import { CC, SYNTH_KIT } from './vocabulary';
import { VPO_KIT_KEYS, VpoVoicing, vpoVoicingFor } from './vpoCatalogue';

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
/** Playmode and tremolo switch at the top of the lower half of the CC range. */
const SWITCH_ON = 32;

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

function requests(track: CompiledTrack): NoteRequest[] {
  return track.timeline.map((n) => ({ midi: n.midi, velocity: n.velocity }));
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
  const controls = track.controls;
  const defaultPizz = voicing.defaultMode === 'pizz';
  const wantsPizz = defaultPizz || controls.some((c) => c.cc === CC.playmode && c.value >= SWITCH_ON);
  const wantsArco = !defaultPizz || controls.some((c) => c.cc === CC.playmode && c.value < SWITCH_ON);
  const wantsTremolo = controls.some((c) => c.cc === CC.tremolo && c.value >= SWITCH_ON);
  // Note lengths as they will sound, so a ritardando never asks for a
  // staccato recording that was not loaded.
  const segments = tempoSegments(song.bpm, song.tempoMap);
  const seconds = (n: { time: number; duration: number }) =>
    beatsToSeconds(segments, n.time + n.duration) - beatsToSeconds(segments, n.time);
  const wantsStaccato = track.timeline.some((n) => seconds(n) <= STACCATO_MAX_SEC);

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
        // sustain one, and says so once.
        console.warn(`vpo: ${path} unavailable:`, err);
      }
    }),
  );
  // Nothing loaded at all — the library is not installed, or not where we
  // looked. Say so rather than returning an instrument that plays silence:
  // `prepareVpo` then leaves the track to a synth preset.
  if (Object.keys(loaded).length === 0) {
    throw new Error(`no orchestral program could be loaded for "${track.sample}" (is the VPO library installed?)`);
  }

  // The articulation is what the control stream says at the note's own
  // time, read from the bus's history — not the last value applied, which
  // in an offline render is the end of the score.
  const play = (bus: TrackBus, midi: number, velocity: number, time: number, duration: number) => {
    const playmode = bus.ccAt(CC.playmode, time);
    const plucked = playmode === undefined ? defaultPizz : playmode >= SWITCH_ON;
    let chosen: SfzProgram | undefined;
    if (plucked) chosen = loaded.pizz;
    else if ((bus.ccAt(CC.tremolo, time) ?? 0) >= SWITCH_ON) chosen = loaded.tremolo;
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
  if (wanted.size > 0 && loaded.size === 0) {
    throw new Error(`no orchestral percussion could be loaded for kit "${track.kit}" (is the VPO library installed?)`);
  }

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
 * the synth presets as before. Hand the result to `scheduleSong` as
 * `orchestra`, or to the live player.
 */
export async function prepareVpo(
  ctx: BaseAudioContext,
  assets: SfzAssets,
  song: CompiledSong,
  opts: {
    onlyTracks?: string[];
    /**
     * Called for a track whose orchestral program could not be loaded —
     * typically because the VPO library is not installed on this machine.
     * The track is left out of the result and plays on a synth preset
     * instead; by default a warning is logged and nothing else happens.
     */
    onMissing?: (trackName: string, err: unknown) => void;
  } = {},
): Promise<Orchestra> {
  const instruments: Orchestra = new Map();
  const tracks = song.tracks.filter((t) => !opts.onlyTracks || opts.onlyTracks.includes(t.name));
  const missing = opts.onMissing ?? ((name: string, err: unknown) => {
    console.warn(`play.yaml: "${name}" falls back to a synth preset — the orchestra could not load:`, err);
  });
  await Promise.all(
    tracks.map(async (track) => {
      if (!track.timeline.length) return;
      try {
        if (track.kit) {
          if (track.kit === SYNTH_KIT) return;
          instruments.set(track.name, await loadKit(ctx, assets, track));
          return;
        }
        const voicing = vpoVoicingFor(track.sample);
        if (!voicing) return;
        instruments.set(track.name, await loadMelodic(ctx, assets, song, track, voicing));
      } catch (err) {
        missing(track.name, err);
      }
    }),
  );
  return instruments;
}
