/**
 * sampler.ts — the built-in sampled instruments, and the per-track control bus.
 *
 * Tier-2 playback: real recorded notes (VSCO 2 CE / VCSL, both CC0) shaped by
 * the score's control stream. The samples provide the timbre; the bus provides
 * the living dynamics a physical instrument would: expression (CC11) swells
 * through held notes, vibrato depth/rate (CC1/CC76) drive a shared LFO into
 * every sounding note's detune, bow position (CC74) morphs the tone from
 * fingerboard-dark to bridge-nasal, and play-mode/tremolo switches (CC20/21)
 * pick pizzicato or tremolo recordings instead of arco sustains.
 *
 * Every instrument is described by /samples/<name>/manifest.json:
 *   melodic — { sustain: [{midi, layer?, url}], pizz: [...], spiccato: [...],
 *              tremolo: [...], defaultMode?: "pizz" }
 *   drums   — { kit: true, notes: { "36": [{vel, url}, ...], ... } }
 */

import { drumChoke, playDrum } from '@play.yaml/core';

/** How the score has set the string in motion; 'default' = the instrument's habit. */
type PlayMode = 'default' | 'arco' | 'pizz';

interface ChokeableVoice {
  gain: GainNode;
  source: AudioBufferSourceNode;
}

export interface TrackBus {
  /** Where notes are fed. */
  input: AudioNode;
  ctx: BaseAudioContext;
  /** Apply a control event at an exact audio-context time. */
  applyCC: (cc: number, value: number, time: number) => void;
  /** Per-note vibrato feed — connect to each source's detune (cents). */
  vibrato: GainNode;
  /** Articulation flags consumed at note-on. */
  state: { playmode: PlayMode; tremolo: boolean };
  /** Sounding drum voices by choke group — a new hit silences its group. */
  chokes: Map<string, Set<ChokeableVoice>>;
  /** The track declares an expression stream, so velocity is attack only. */
  hasExpression: boolean;
  dispose: () => void;
}

/** Perceptual loudness curve for the expression gain. */
function loudness(value: number): number {
  return Math.pow(Math.max(0, Math.min(127, value)) / 127, 1.6);
}

export function createTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  opts: { hasExpression: boolean },
): TrackBus {
  const input = ctx.createGain();

  // Bow position: a lowpass that opens toward the bridge plus a presence
  // peak that only appears sul ponticello (the nasal edge).
  const color = ctx.createBiquadFilter();
  color.type = 'lowpass';
  color.frequency.value = 5200; // ordinario
  color.Q.value = 0.4;
  const edge = ctx.createBiquadFilter();
  edge.type = 'peaking';
  edge.frequency.value = 2800;
  edge.Q.value = 1.2;
  edge.gain.value = 0;

  // Sordino: a second lowpass, wide open until the mute goes on.
  const sordino = ctx.createBiquadFilter();
  sordino.type = 'lowpass';
  sordino.frequency.value = 16000;

  // Expression: the bow-speed loudness. Starts at full and only moves when
  // the score actually streams CC11 (declared `expression` control).
  const expression = ctx.createGain();
  expression.gain.value = opts.hasExpression ? loudness(90) : 1;

  input.connect(color);
  color.connect(edge);
  edge.connect(sordino);
  sordino.connect(expression);
  expression.connect(destination);

  // One vibrato LFO per track; notes connect `vibrato` to their detune.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const vibrato = ctx.createGain();
  vibrato.gain.value = 0; // depth in cents, driven by CC1
  lfo.connect(vibrato);
  lfo.start();

  const state: TrackBus['state'] = { playmode: 'default', tremolo: false };

  const applyCC = (cc: number, value: number, time: number) => {
    const v = value / 127;
    switch (cc) {
      case 11: // expression — smooth so staircase ramps become curves
        expression.gain.setTargetAtTime(loudness(value), time, 0.06);
        break;
      case 1: // vibrato depth → LFO cents
        vibrato.gain.setTargetAtTime(v * 22, time, 0.08);
        break;
      case 76: // vibrato rate
        lfo.frequency.setTargetAtTime(3.2 + v * 4.5, time, 0.08);
        break;
      case 74: { // bow position: tasto (dark) → ponticello (open + nasal)
        const cutoff = 1100 * Math.pow(9, v); // 1.1k → ~9.9k, exponential
        color.frequency.setTargetAtTime(cutoff, time, 0.1);
        edge.gain.setTargetAtTime(v > 0.55 ? ((v - 0.55) / 0.45) * 9 : 0, time, 0.1);
        break;
      }
      case 71: // bow pressure: weight = a little level and a harder edge
        input.gain.setTargetAtTime(0.75 + v * 0.5, time, 0.1);
        edge.Q.setTargetAtTime(1.2 + v * 2.5, time, 0.1);
        break;
      case 20: // play mode: arco / pizzicato / col legno (both plucked here)
        state.playmode = value >= 32 ? 'pizz' : 'arco';
        break;
      case 21: // instrument tremolo
        state.tremolo = value >= 32;
        break;
      case 22: // sordino
        sordino.frequency.setTargetAtTime(value >= 64 ? 3600 : 16000, time, 0.1);
        break;
      default:
        // portamento/bowlift/harmonics/fingering have no browser equivalent
        // yet — the model-specific CCs pass silently, as on any synth.
        break;
    }
  };

  return {
    input,
    ctx,
    applyCC,
    vibrato,
    state,
    chokes: new Map(),
    hasExpression: opts.hasExpression,
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      lfo.disconnect();
      vibrato.disconnect();
      expression.disconnect();
    },
  };
}

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
}

interface DrumLayer {
  vel: number;
  url: string;
}

interface DrumManifest {
  kit: true;
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

/** Notes shorter than this play from the spiccato recordings when bowed. */
const SPICCATO_MAX_SEC = 0.22;
/** Sustain layer boundary: below plays the `p` recording, above the `f`. */
const LAYER_SPLIT = 76;

const loadPromises = new Map<string, Promise<Sampler | null>>();

/**
 * Load a sampled instrument by name (lazily; browser-cached afterwards).
 * Resolves to null when the samples can't be fetched, so callers fall back
 * to the synth presets.
 */
export function loadInstrument(ctx: BaseAudioContext, name: string): Promise<Sampler | null> {
  let promise = loadPromises.get(name);
  if (!promise) {
    promise = load(ctx, name).catch((err) => {
      console.warn(`Samples for "${name}" unavailable, falling back to synth:`, err);
      return null;
    });
    loadPromises.set(name, promise);
  }
  return promise;
}

async function load(ctx: BaseAudioContext, name: string): Promise<Sampler | null> {
  const base = `${import.meta.env.BASE_URL}samples/${name}/`;
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) throw new Error(`${response.status} for ${name}/manifest.json`);
  const manifest = await response.json();
  return manifest.kit ? loadDrums(ctx, base, manifest) : loadMelodic(ctx, base, manifest);
}

async function fetchBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const data = await (await fetch(url)).arrayBuffer();
  return ctx.decodeAudioData(data);
}

// ---------------------------------------------------------------------------
// Melodic instruments
// ---------------------------------------------------------------------------

async function loadMelodic(
  ctx: BaseAudioContext,
  base: string,
  manifest: MelodicManifest,
): Promise<MelodicSampler> {
  const fetchMap = async (notes: ManifestNote[] = [], filter?: (n: ManifestNote) => boolean) => {
    const map: BufferMap = new Map();
    await Promise.all(
      notes.filter((n) => !filter || filter(n)).map(async (n) => {
        map.set(n.midi, await fetchBuffer(ctx, base + n.url));
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
    else if (durationSec <= SPICCATO_MAX_SEC && spiccato.size) map = spiccato;
    else {
      map = velocity < LAYER_SPLIT && susP.size ? susP : susF;
      sustained = true;
    }
    if (map.size === 0) map = susF;
    if (map.size === 0) return;
    const [sampleMidi, buffer] = nearest(map, midi);

    const source = bus.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12);
    bus.vibrato.connect(source.detune);

    // Long holds loop inside the sample's steady region.
    if (allowLoop && sustained && durationSec > buffer.duration - 0.6) {
      source.loop = true;
      source.loopStart = Math.min(1.0, buffer.duration / 3);
      source.loopEnd = buffer.duration - 0.35;
    }

    // With an expression stream the bus carries the loudness and velocity
    // only shades the attack; otherwise velocity is the whole dynamic.
    const level = bus.hasExpression
      ? 0.72 + 0.28 * (velocity / 127)
      : Math.pow(velocity / 127, 1.4);

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
        bus.vibrato.disconnect(source.detune);
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
  ctx: BaseAudioContext,
  base: string,
  manifest: DrumManifest,
): Promise<DrumSampler> {
  const notes = new Map<number, { vel: number; buffers: AudioBuffer[] }[]>();
  await Promise.all(
    Object.entries(manifest.notes).map(async ([note, layers]) => {
      // Group files by velocity layer, quietest first; same-vel files are RRs.
      const byVel = new Map<number, AudioBuffer[]>();
      await Promise.all(
        layers.map(async (l) => {
          const buffer = await fetchBuffer(ctx, base + l.url);
          (byVel.get(l.vel) ?? byVel.set(l.vel, []).get(l.vel)!).push(buffer);
        }),
      );
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
    gain.gain.value = 0.55 + 0.45 * (velocity / 127);
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
