/**
 * sampler.ts — the built-in expressive violin, and the per-track control bus.
 *
 * Tier-2 playback: real recorded notes (VSCO 2 CE solo violin, CC0) shaped by
 * the score's control stream. The samples provide the timbre; the bus provides
 * the living dynamics a physical instrument would: expression (CC11) swells
 * through held notes, vibrato depth/rate (CC1/CC76) drive a shared LFO into
 * every sounding note's detune, bow position (CC74) morphs the tone from
 * fingerboard-dark to bridge-nasal, and play-mode/tremolo switches (CC20/21)
 * pick pizzicato or tremolo recordings instead of arco sustains.
 */

export interface TrackBus {
  /** Where notes are fed. */
  input: AudioNode;
  ctx: BaseAudioContext;
  /** Apply a control event at an exact audio-context time. */
  applyCC: (cc: number, value: number, time: number) => void;
  /** Per-note vibrato feed — connect to each source's detune (cents). */
  vibrato: GainNode;
  /** Articulation flags consumed at note-on. */
  state: { pizz: boolean; tremolo: boolean };
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

  const state = { pizz: false, tremolo: false };

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
        state.pizz = value >= 32;
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
// The sampled violin
// ---------------------------------------------------------------------------

interface ManifestNote {
  midi: number;
  layer?: string;
  url: string;
}

interface Manifest {
  sustain: ManifestNote[];
  pizz: ManifestNote[];
  spiccato: ManifestNote[];
  tremolo: ManifestNote[];
}

type BufferMap = Map<number, AudioBuffer>;

export interface ViolinSampler {
  play: (
    bus: TrackBus,
    midi: number,
    velocity: number,
    startSec: number,
    durationSec: number,
  ) => void;
}

/** Notes shorter than this play from the spiccato recordings when bowed. */
const SPICCATO_MAX_SEC = 0.22;
/** Sustain layer boundary: below plays the `p` recording, above the `f`. */
const LAYER_SPLIT = 76;

let loadPromise: Promise<ViolinSampler | null> | null = null;

/**
 * Load the violin sample set (≈5 MB, cached by the browser after the first
 * time). Resolves to null when the samples can't be fetched, so callers fall
 * back to the oscillator synth.
 */
export function loadViolin(ctx: BaseAudioContext): Promise<ViolinSampler | null> {
  loadPromise ??= (async () => {
    try {
      const base = `${import.meta.env.BASE_URL}samples/violin/`;
      const manifest: Manifest = await (await fetch(`${base}manifest.json`)).json();

      const fetchMap = async (notes: ManifestNote[], filter?: (n: ManifestNote) => boolean) => {
        const map: BufferMap = new Map();
        await Promise.all(
          notes.filter((n) => !filter || filter(n)).map(async (n) => {
            const data = await (await fetch(base + n.url)).arrayBuffer();
            map.set(n.midi, await ctx.decodeAudioData(data));
          }),
        );
        return map;
      };

      const [susP, susF, pizz, spiccato, tremolo] = await Promise.all([
        fetchMap(manifest.sustain, (n) => n.layer === 'p'),
        fetchMap(manifest.sustain, (n) => n.layer === 'f'),
        fetchMap(manifest.pizz),
        fetchMap(manifest.spiccato),
        fetchMap(manifest.tremolo),
      ]);

      const nearest = (map: BufferMap, midi: number): [number, AudioBuffer] => {
        let bestMidi = -1;
        for (const m of map.keys()) {
          if (bestMidi === -1 || Math.abs(m - midi) < Math.abs(bestMidi - midi)) bestMidi = m;
        }
        return [bestMidi, map.get(bestMidi)!];
      };

      const play = (
        bus: TrackBus,
        midi: number,
        velocity: number,
        startSec: number,
        durationSec: number,
      ) => {
        let map: BufferMap;
        let sustained = false;
        if (bus.state.pizz) map = pizz;
        else if (bus.state.tremolo) map = tremolo.size ? tremolo : susF;
        else if (durationSec <= SPICCATO_MAX_SEC) map = spiccato;
        else {
          map = velocity < LAYER_SPLIT && susP.size ? susP : susF;
          sustained = true;
        }
        if (map.size === 0) map = susF;
        const [sampleMidi, buffer] = nearest(map, midi);

        const source = bus.ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12);
        bus.vibrato.connect(source.detune);

        // Long holds loop inside the sample's steady region.
        if (sustained && durationSec > buffer.duration - 0.6) {
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

      return { play };
    } catch (err) {
      console.warn('Violin samples unavailable, falling back to synth:', err);
      return null;
    }
  })();
  return loadPromise;
}
