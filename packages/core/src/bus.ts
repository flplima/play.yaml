/**
 * bus.ts — the per-track control bus: the living dynamics a physical
 * instrument would have, driven by the score's control stream.
 *
 * Expression (CC11) swells through held notes, vibrato depth/rate (CC1/CC76)
 * drive a shared LFO into every sounding note's detune, bow position (CC74)
 * morphs the tone from fingerboard-dark to bridge-nasal, bow pressure (CC71)
 * adds weight and edge, and play-mode/tremolo switches (CC20/21) pick which
 * recordings a sampler reaches for.
 *
 * This is plain Web Audio — no browser-only APIs — so the browser, the
 * offline MP3 render, the server-side engine and the CLI all shape notes
 * through the same graph rather than each growing its own.
 */

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
  /**
   * Master level for this track, folded into the bus's own gain. Backends use
   * this instead of hanging a GainNode off the output — see the graph note in
   * createTrackBus for why that matters outside the browser.
   */
  setMasterTrim: (value: number, time?: number) => void;
  dispose: () => void;
}

/** Perceptual loudness curve for the expression gain. */
function loudness(value: number): number {
  return Math.pow(Math.max(0, Math.min(127, value)) / 127, 1.85);
}

export interface TrackBusOptions {
  hasExpression: boolean;
  /**
   * Write control changes straight to `param.value` instead of scheduling
   * them. Backends on engines without AudioParam automation (webaudio-node,
   * which renders server-side playback and the CLI) need this — there, a
   * scheduled ramp is silently discarded and the modifier never sounds. The
   * scheduler compensates for the lost time dimension by giving each span of
   * constant control values its own bus.
   */
  immediate?: boolean;
}

export function createTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  opts: TrackBusOptions,
): TrackBus {
  /*
   * Graph shape is load-bearing outside the browser. webaudio-node — which
   * renders server-side playback, the CLI and the offline probe — mixes a
   * multi-input GainNode correctly only while no *other* GainNode sits
   * downstream of it; put one there and every note but the last is silently
   * dropped. Filters downstream are fine, and a filter as the fan-in point
   * drops notes too.
   *
   * So: notes fan into exactly one GainNode, that gain carries all the level
   * automation, and everything after it is filters. Callers that want a
   * master volume use setMasterTrim() rather than adding a gain of their own.
   * Browsers do not care either way.
   */
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

  // Level lives on the fan-in gain: bow-speed loudness (CC11) times bow
  // weight (CC71) times whatever master trim the backend asks for.
  let expressionLevel = opts.hasExpression ? loudness(90) : 1;
  let pressureLevel = 1;
  let sordinoLevel = 1;
  let masterTrim = 1;
  input.gain.value = expressionLevel * pressureLevel * sordinoLevel * masterTrim;
  const writeLevel = (time: number, smoothing = 0.06) => {
    const level = expressionLevel * pressureLevel * sordinoLevel * masterTrim;
    if (opts.immediate) input.gain.value = level;
    else input.gain.setTargetAtTime(level, time, smoothing);
  };

  input.connect(color);
  color.connect(edge);
  edge.connect(sordino);
  sordino.connect(destination);

  // One vibrato LFO per track; notes connect `vibrato` to their detune.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const vibrato = ctx.createGain();
  vibrato.gain.value = 0; // depth in cents, driven by CC1
  lfo.connect(vibrato);
  lfo.start();

  const state: TrackBus['state'] = { playmode: 'default', tremolo: false };

  /** Schedule a smooth move, or write it outright when automation is absent. */
  const glide = (param: AudioParam, value: number, time: number, smoothing: number) => {
    if (opts.immediate) param.value = value;
    else param.setTargetAtTime(value, time, smoothing);
  };

  const applyCC = (cc: number, value: number, time: number) => {
    const v = value / 127;
    switch (cc) {
      case 11: // expression — smooth so staircase ramps become curves
        expressionLevel = loudness(value);
        writeLevel(time);
        break;
      case 1: // vibrato depth → LFO cents
        glide(vibrato.gain, v * 22, time, 0.08);
        break;
      case 76: // vibrato rate
        glide(lfo.frequency, 3.2 + v * 4.5, time, 0.08);
        break;
      case 74: { // bow position: tasto (dark) → ponticello (open + nasal)
        const cutoff = 1100 * Math.pow(9, v); // 1.1k → ~9.9k, exponential
        glide(color.frequency, cutoff, time, 0.1);
        glide(edge.gain, v > 0.55 ? ((v - 0.55) / 0.45) * 9 : 0, time, 0.1);
        break;
      }
      case 71: // bow pressure: weight = a little level and a harder edge
        pressureLevel = 0.75 + v * 0.5;
        writeLevel(time);
        glide(edge.Q, 1.2 + v * 2.5, time, 0.1);
        break;
      case 20: // play mode: arco / pizzicato / col legno (both plucked here)
        state.playmode = value >= 32 ? 'pizz' : 'arco';
        break;
      case 21: // instrument tremolo
        state.tremolo = value >= 32;
        break;
      case 22: {
        // Sordino. A mute is not a gentle tilt — it damps the bridge, so the
        // upper partials go and the whole thing quietens. 3.6 kHz measured as
        // barely a 2% brightness change on real string samples; this lands
        // around 8-15% darker and a shade softer, which is what a mute does.
        const muted = value >= 64;
        glide(sordino.frequency, muted ? 2200 : 16000, time, 0.1);
        sordinoLevel = muted ? 0.85 : 1;
        writeLevel(time, 0.1);
        break;
      }
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
    setMasterTrim: (value: number, time = ctx.currentTime) => {
      masterTrim = Math.max(0, value);
      writeLevel(time, 0.02);
    },
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      lfo.disconnect();
      vibrato.disconnect();
      input.disconnect();
    },
  };
}
