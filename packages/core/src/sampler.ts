/**
 * sampler.ts — the built-in sampled instruments.
 *
 * Tier-2 playback: real recorded notes (VSCO 2 CE / VCSL, both CC0) shaped by
 * the score's control stream. The samples provide the timbre; core's track bus
 * provides the living dynamics a physical instrument would.
 *
 * Every instrument is described by /samples/<name>/manifest.json:
 *   melodic — { sustain: [{midi, layer?, url}], pizz: [...], spiccato: [...],
 *              tremolo: [...], defaultMode?: "pizz" }
 *   drums   — { kit: true, notes: { "36": [{vel, url}, ...], ... } }
 */

import { playDrum } from './synth';
import { drumChoke } from './vocabulary';
import type { TrackBus } from './bus';

// ---------------------------------------------------------------------------
// Instrument loading
// ---------------------------------------------------------------------------

interface ManifestNote {
  midi: number;
  layer?: string;
  url: string;
}

interface MelodicManifest {
  sustain?: ManifestNote[];
  pizz?: ManifestNote[];
  spiccato?: ManifestNote[];
  tremolo?: ManifestNote[];
  /** What the instrument does before the score says arco/pizz ("pizz" = a groove bass). */
  defaultMode?: 'arco' | 'pizz';
  /** false = never loop long holds (a struck string's decay must just decay). */
  loop?: boolean;
  /** Level trim: the raw recordings are not normalized across instruments. */
  gain?: number;
  /** Below this many seconds a bowed/blown note uses the short recordings. */
  spiccatoMaxSec?: number;
}

interface DrumLayer {
  vel: number;
  url: string;
}

interface DrumManifest {
  kit: true;
  /** Level trim for the whole library. */
  gain?: number;
  notes: Record<string, DrumLayer[]>;
}

type BufferMap = Map<number, AudioBuffer>;

export interface MelodicSampler {
  kind: 'melodic';
  play: (bus: TrackBus, midi: number, velocity: number, startSec: number, durationSec: number) => void;
}

export interface DrumSampler {
  kind: 'drums';
  play: (bus: TrackBus, midi: number, velocity: number, startSec: number) => void;
}

export type Sampler = MelodicSampler | DrumSampler;

/** DSL sample names → sampled set under public/samples/ (ocarina rides the flute). */
export const SAMPLE_LIBRARIES: Record<string, string> = {
  violin: 'violin',
  cello: 'cello',
  flute: 'flute',
  ocarina: 'flute',
  bass: 'bass',
  piano: 'piano',
};

/** Every sampled kit shares one drum library; the 808 kit is pure synthesis. */
export const DRUM_LIBRARY = 'drums';

/** Which sampled library a compiled track needs, if any. */
export function libraryForTrack(track: { sample?: string; kit?: string }): string | null {
  if (track.kit) return track.kit === '808' ? null : DRUM_LIBRARY;
  return SAMPLE_LIBRARIES[track.sample?.toLowerCase() ?? ''] ?? null;
}

/** Every library a track set needs (kits share the drum library). */
export function librariesForTracks(tracks: { sample?: string; kit?: string }[]): Set<string> {
  const wanted = new Set<string>();
  for (const track of tracks) {
    const library = libraryForTrack(track);
    if (library) wanted.add(library);
  }
  return wanted;
}

/** Notes shorter than this play from the spiccato recordings when bowed. */
const SPICCATO_MAX_SEC = 0.22;
/** Sustain layer boundary: below plays the `p` recording, above the `f`. */
const LAYER_SPLIT = 76;

/**
 * How a backend gets at the sample files. The browser fetches them over HTTP;
 * the server reads the same directory off disk. Injecting this is what lets
 * both play the identical recordings instead of the server silently dropping
 * to the oscillator presets.
 */
export interface SampleAssets {
  manifest: (library: string) => Promise<any>;
  audio: (library: string, file: string) => Promise<ArrayBuffer>;
}

/**
 * Load a sampled instrument by name. Resolves to null when the samples can't
 * be read, so callers fall back to the synth presets.
 */
export async function loadSampleLibrary(
  ctx: BaseAudioContext,
  name: string,
  assets: SampleAssets,
): Promise<Sampler | null> {
  const manifest = await assets.manifest(name);
  const read = (file: string, align: 'silence' | 'transient' = 'silence') =>
    readBuffer(ctx, assets, name, file, align);
  return manifest.kit ? loadDrums(read, manifest) : loadMelodic(read, manifest);
}

/** A reader bound to one library, handed down to the manifest walkers. */
type ReadBuffer = (file: string, align?: 'silence' | 'transient') => Promise<AudioBuffer>;

async function readBuffer(
  ctx: BaseAudioContext,
  assets: SampleAssets,
  library: string,
  file: string,
  align: 'silence' | 'transient' = 'silence',
): Promise<AudioBuffer> {
  const buffer = await ctx.decodeAudioData(await assets.audio(library, file));
  return trimStart(ctx, buffer, startOf(buffer, align));
}

/**
 * Where a sample's sound really begins. 'silence' drops AAC encoder-priming
 * quiet (a few ms) and suits slow bowed/blown attacks; 'transient' aligns
 * percussive hits on their attack — the raw recordings put it anywhere from
 * 0 to ~67 ms in (varying per velocity layer and round-robin), which made
 * grooves audibly lumpy.
 */
function startOf(buffer: AudioBuffer, align: 'silence' | 'transient'): number {
  const data = buffer.getChannelData(0);
  const cap = Math.min(data.length, Math.floor(buffer.sampleRate * 0.1));
  if (align === 'transient') {
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const threshold = peak * 0.3;
    let attack = 0;
    while (attack < cap && Math.abs(data[attack]) < threshold) attack++;
    // Keep 3 ms of the natural rise ahead of the attack point.
    return Math.max(0, attack - Math.floor(buffer.sampleRate * 0.003));
  }
  let start = 0;
  while (start < cap && Math.abs(data[start]) < 0.004) start++;
  return start;
}

function trimStart(ctx: BaseAudioContext, buffer: AudioBuffer, start: number): AudioBuffer {
  if (start < buffer.sampleRate * 0.002 || start >= buffer.length) return buffer;
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length - start, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(start));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Melodic instruments
// ---------------------------------------------------------------------------

async function loadMelodic(
  read: ReadBuffer,
  manifest: MelodicManifest,
): Promise<MelodicSampler> {
  const fetchMap = async (notes: ManifestNote[] = [], filter?: (n: ManifestNote) => boolean) => {
    const map: BufferMap = new Map();
    await Promise.all(
      notes.filter((n) => !filter || filter(n)).map(async (n) => {
        try {
          map.set(n.midi, await read(n.url));
        } catch (err) {
          // One bad fetch/decode must not silence the instrument — the
          // nearest playable neighbour covers this pitch instead.
          console.warn(`Skipping sample ${n.url}:`, err);
        }
      }),
    );
    return map;
  };

  const layered = (manifest.sustain ?? []).some((n) => n.layer === 'p');
  const [susP, susF, pizz, spiccato, tremolo] = await Promise.all([
    fetchMap(manifest.sustain, (n) => (layered ? n.layer === 'p' : false)),
    fetchMap(manifest.sustain, (n) => (layered ? n.layer !== 'p' : true)),
    fetchMap(manifest.pizz),
    fetchMap(manifest.spiccato),
    fetchMap(manifest.tremolo),
  ]);
  const defaultPizz = manifest.defaultMode === 'pizz';
  const allowLoop = manifest.loop !== false;
  const trim = manifest.gain ?? 1;
  const spiccatoMaxSec = manifest.spiccatoMaxSec ?? SPICCATO_MAX_SEC;

  const nearest = (map: BufferMap, midi: number): [number, AudioBuffer] => {
    let bestMidi = -1;
    for (const m of map.keys()) {
      if (bestMidi === -1 || Math.abs(m - midi) < Math.abs(bestMidi - midi)) bestMidi = m;
    }
    return [bestMidi, map.get(bestMidi)!];
  };

  const play = (bus: TrackBus, midi: number, velocity: number, startSec: number, durationSec: number) => {
    const plucked = bus.state.playmode === 'pizz' || (bus.state.playmode === 'default' && defaultPizz);
    let map: BufferMap;
    let sustained = false;
    if (plucked && pizz.size) map = pizz;
    else if (bus.state.tremolo) map = tremolo.size ? tremolo : susF;
    else if (durationSec <= spiccatoMaxSec && spiccato.size) map = spiccato;
    else {
      map = velocity < LAYER_SPLIT && susP.size ? susP : susF;
      sustained = true;
    }
    if (map.size === 0) map = susF;
    if (map.size === 0) return;
    const [sampleMidi, buffer] = nearest(map, midi);

    const source = bus.ctx.createBufferSource();
    source.buffer = buffer;
    const rate = Math.pow(2, (midi - sampleMidi) / 12);
    source.playbackRate.value = rate;
    // Feed the track's vibrato LFO (in cents) into the note's pitch. Tone's
    // live context is the standardized-audio-context shim, which never
    // implemented AudioBufferSourceNode.detune — connecting to it there threw
    // before source.start(), silencing every sampled note in live playback
    // (offline renders use a native context and were fine). Fall back to
    // playbackRate: 1 cent ≈ rate·ln2/1200.
    let vibratoSink: AudioParam | GainNode;
    if (source.detune) {
      vibratoSink = source.detune;
      bus.vibrato.connect(source.detune);
    } else {
      const centsToRate = bus.ctx.createGain();
      centsToRate.gain.value = (rate * Math.LN2) / 1200;
      bus.vibrato.connect(centsToRate);
      centsToRate.connect(source.playbackRate);
      vibratoSink = centsToRate;
    }

    // Long holds loop inside the sample's steady region.
    if (allowLoop && sustained && durationSec > buffer.duration - 0.6) {
      source.loop = true;
      source.loopStart = Math.min(1.0, buffer.duration / 3);
      source.loopEnd = buffer.duration - 0.35;
    }

    // With an expression stream the bus carries the loudness and velocity
    // only shades the attack; otherwise velocity is the whole dynamic.
    const level = trim * (bus.hasExpression
      ? 0.25 + 0.75 * Math.pow(velocity / 127, 1.85)
      : Math.pow(velocity / 127, 1.85));

    const gain = bus.ctx.createGain();
    const end = startSec + durationSec;
    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(level, startSec + 0.012);
    if (sustained) {
      // Bowed: release when the slot ends (slur overlaps come from gate).
      gain.gain.setValueAtTime(level, Math.max(startSec + 0.012, end - 0.02));
      gain.gain.linearRampToValueAtTime(0, end + 0.09);
      source.start(startSec);
      source.stop(end + 0.15);
    } else {
      // Plucked/bounced: let the recording ring its natural length.
      source.start(startSec);
      source.stop(startSec + Math.min(buffer.duration, durationSec + 2.5));
    }

    source.connect(gain);
    gain.connect(bus.input);
    source.onended = () => {
      try {
        bus.vibrato.disconnect(vibratoSink as AudioParam);
      } catch {
        // Bus already disposed.
      }
      gain.disconnect();
    };
  };

  return { kind: 'melodic', play };
}

// ---------------------------------------------------------------------------
// Drum kits
// ---------------------------------------------------------------------------

async function loadDrums(
  read: ReadBuffer,
  manifest: DrumManifest,
): Promise<DrumSampler> {
  const notes = new Map<number, { vel: number; buffers: AudioBuffer[] }[]>();
  await Promise.all(
    Object.entries(manifest.notes).map(async ([note, layers]) => {
      // Group files by velocity layer, quietest first; same-vel files are RRs.
      const byVel = new Map<number, AudioBuffer[]>();
      await Promise.all(
        layers.map(async (l) => {
          try {
            const buffer = await read(l.url, 'transient');
            (byVel.get(l.vel) ?? byVel.set(l.vel, []).get(l.vel)!).push(buffer);
          } catch (err) {
            // A bad hit drops out of the round-robin; the synth kit covers
            // the key entirely if none survive.
            console.warn(`Skipping drum sample ${l.url}:`, err);
          }
        }),
      );
      if (byVel.size === 0) return;
      notes.set(
        parseInt(note, 10),
        [...byVel.entries()].sort((a, b) => a[0] - b[0]).map(([vel, buffers]) => ({ vel, buffers })),
      );
    }),
  );

  const play = (bus: TrackBus, midi: number, velocity: number, startSec: number) => {
    const layers = notes.get(midi);
    if (!layers) {
      // No recording for this GM key — the synthesized kit fills the gap.
      playDrum(bus.ctx, bus.input, midi, velocity, startSec);
      return;
    }
    const layer = layers.find((l) => velocity <= l.vel) ?? layers[layers.length - 1];
    const buffer = layer.buffers[Math.floor(Math.random() * layer.buffers.length)];

    const gain = bus.ctx.createGain();
    // Shade inside the chosen layer so repeated hits still breathe.
    gain.gain.value = (manifest.gain ?? 1) * (0.55 + 0.45 * (velocity / 127));
    const source = bus.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(bus.input);

    // Hi-hat behaviour: a new hit in a choke group stops what still rings.
    const group = drumChoke(midi);
    if (group) {
      const voices = bus.chokes.get(group) ?? bus.chokes.set(group, new Set()).get(group)!;
      for (const voice of voices) {
        voice.gain.gain.setTargetAtTime(0, startSec, 0.008);
        try {
          voice.source.stop(startSec + 0.05);
        } catch {
          // Already stopped.
        }
      }
      voices.clear();
      const voice = { gain, source };
      voices.add(voice);
      source.onended = () => {
        voices.delete(voice);
        gain.disconnect();
      };
    } else {
      source.onended = () => gain.disconnect();
    }
    source.start(startSec);
  };

  return { kind: 'drums', play };
}
