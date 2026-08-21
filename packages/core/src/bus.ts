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
 * Past the instrument's own body come the mix controls every General MIDI
 * device has: volume (CC7), pan (CC10), a send into a shared reverb (CC91)
 * and a chorus (CC93). Those four are built only when the score actually
 * sends them, so a score that never asks for reverb renders through exactly
 * the graph it did before they existed.
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

/**
 * `setTargetAtTime`, but with the parameter's current value pinned at the
 * start of the move.
 *
 * A bare `setTargetAtTime` leaves the curve's left edge undefined, and
 * node-web-audio-api extrapolates it *backwards* rather than holding: over
 * half a second with a 8 ms time constant that is exp(62) ≈ 1e27, which turns
 * a hi-hat choke or an expression swell into a track rendered at 1e38.
 * Browsers hold the old value instead, so this only ever bit the offline
 * renders. Anchoring is correct on every implementation and costs one event.
 */
export function glideParam(param: AudioParam, value: number, time: number, smoothing: number): void {
  param.setValueAtTime(param.value, time);
  param.setTargetAtTime(value, time, smoothing);
}

/** Perceptual loudness curve for the expression gain. */
function loudness(value: number): number {
  return Math.pow(Math.max(0, Math.min(127, value)) / 127, 1.85);
}

/**
 * Not every engine that renders a score has the whole node set — bus.ts runs
 * on four of them. A missing node means that effect is silently unavailable,
 * which is the same thing a synth does with a CC it has no circuit for.
 */
function can(ctx: BaseAudioContext, method: string): boolean {
  return typeof (ctx as unknown as Record<string, unknown>)[method] === 'function';
}

/**
 * Seeded PRNG for the reverb's impulse response.
 *
 * The IR is noise, but it must not be *random*: the golden digests and the
 * browser/server render-parity checks both compare renders of the same score,
 * and a fresh IR per process would make them differ every run. Same seed,
 * same room, every engine.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reverb decay. Deliberately shorter than the 1.5 s ring-out the renderers
 * keep after the last note, so an exported file does not end mid-tail.
 */
const REVERB_SECONDS = 1.4;

/**
 * A medium room: noise under an exponential decay, darkened by a one-pole
 * lowpass because air and soft furnishings eat the top of a tail first, and
 * offset by a short pre-delay so the early reflections do not smear the
 * attack that triggered them.
 */
function impulseResponse(ctx: BaseAudioContext): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * REVERB_SECONDS));
  const preDelay = Math.floor(ctx.sampleRate * 0.012);
  const ir = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    // A different seed per channel is what makes the tail wide: two identical
    // channels would collapse to a mono image in the middle of the stereo field.
    const rand = mulberry32(ch === 0 ? 0x51f0 : 0x9e37);
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = preDelay; i < frames; i++) {
      const t = (i - preDelay) / (frames - preDelay);
      lp += (rand() * 2 - 1 - lp) * 0.36;
      data[i] = lp * Math.pow(1 - t, 2.6);
    }
  }
  return ir;
}

/**
 * One reverb per destination, not per track.
 *
 * Tracks share a room — that is what a room *is*, and it is also the cheap
 * way round: a convolver per track would multiply the most expensive node in
 * the graph by the track count, and in segmented control mode by the number
 * of control changes. Keyed weakly on the destination so a finished render's
 * reverb goes away with it.
 */
const sharedReverbs = new WeakMap<AudioNode, GainNode>();

function sharedReverb(ctx: BaseAudioContext, destination: AudioNode): GainNode | null {
  if (!can(ctx, 'createConvolver')) return null;
  let input = sharedReverbs.get(destination);
  if (!input) {
    input = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = impulseResponse(ctx);
    input.connect(convolver);
    convolver.connect(destination);
    sharedReverbs.set(destination, input);
  }
  return input;
}

export interface TrackBusOptions {
  hasExpression: boolean;
  /**
   * Which CCs this track's stream contains, so the mix effects those CCs
   * drive (pan, reverb send, chorus) can be built up front rather than
   * spliced into a graph that is already sounding.
   *
   * Leaving it out is safe: an effect whose CC arrives unannounced is built
   * on the spot. It is only the reconnection *during* playback that this
   * avoids, which is worth avoiding — a pan or chorus insert reroutes the
   * chain, and rerouting a live graph can click.
   */
  usesCC?: Iterable<number>;
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
   * Notes fan into exactly one GainNode and that gain carries all the level
   * automation. Callers that want a master volume use setMasterTrim() rather
   * than adding a gain of their own — a second gain in series would be a
   * second place to look for a level.
   *
   * This shape used to be load-bearing for a different reason: webaudio-node,
   * the engine that once rendered server-side playback and the CLI, dropped
   * every note but the last if any GainNode sat downstream of the fan-in. That
   * engine is gone — node-audio renders on node-web-audio-api now — and the
   * bug does not reproduce there (measured: five overlapping notes, identical
   * RMS with and without a downstream gain). The mix stages below therefore
   * use gains freely.
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

  /**
   * When the bus was built. A control landing at or before this is not a move
   * but the instrument's starting state — the bow position a score opens on,
   * a fader planted at bar 1 — and it is written outright instead of glided
   * into. Gliding it would let the first note through at the *default* value
   * for the ~200 ms the smoothing takes, which in an offline render (where
   * everything starts exactly at the origin) is audible: a score opening on
   * "hard left, fade out" would begin centred and loud.
   */
  const built = ctx.currentTime;

  // Level lives on the fan-in gain: bow-speed loudness (CC11) times bow
  // weight (CC71) times the channel fader (CC7) times the pan law's makeup
  // times whatever master trim the backend asks for.
  let expressionLevel = opts.hasExpression ? loudness(90) : 1;
  let pressureLevel = 1;
  let sordinoLevel = 1;
  let volumeLevel = 1;
  let panTrim = 1;
  let masterTrim = 1;
  const currentLevel = () =>
    expressionLevel * pressureLevel * sordinoLevel * volumeLevel * panTrim * masterTrim;
  input.gain.value = currentLevel();
  const writeLevel = (time: number, smoothing = 0.06) => {
    if (opts.immediate || time <= built) input.gain.value = currentLevel();
    else glideParam(input.gain, currentLevel(), time, smoothing);
  };

  input.connect(color);
  color.connect(edge);
  edge.connect(sordino);

  /*
   * ── the mix stages ──
   *
   * Everything above is the instrument; everything here is what happens to it
   * on the way to the room. Each stage is null until its CC turns up, and
   * `relink` rebuilds the run from the sordino outwards in a fixed order —
   * chorus, then pan, then out to the destination and the reverb send. The
   * send is post-pan on purpose: a violin on the left should reverberate from
   * the left, the way a desk's post-pan send behaves.
   */
  let chorusIn: GainNode | null = null;
  let chorusOut: GainNode | null = null;
  const chorusWet: GainNode[] = [];
  const chorusDepth: GainNode[] = [];
  const chorusLfos: OscillatorNode[] = [];
  let panner: StereoPannerNode | null = null;
  let reverbSend: GainNode | null = null;

  const relink = () => {
    sordino.disconnect();
    chorusOut?.disconnect();
    panner?.disconnect();
    let tail: AudioNode = sordino;
    if (chorusIn && chorusOut) {
      tail.connect(chorusIn);
      tail = chorusOut;
    }
    if (panner) {
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(destination);
    if (reverbSend) tail.connect(reverbSend);
  };
  relink();

  /**
   * Two detuned delay lines, panned apart — the classic chorus. One line only
   * ever sounds like a vibrato; the second, at a different rate, is what turns
   * it into more than one player. Both start dry (wet gain 0), so building the
   * stage changes nothing until CC93 asks for a value.
   */
  const ensureChorus = () => {
    if (chorusIn || !can(ctx, 'createDelay')) return;
    chorusIn = ctx.createGain();
    chorusOut = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1;
    chorusIn.connect(dry);
    dry.connect(chorusOut);

    // Rates are deliberately not in any simple ratio: two voices that line up
    // periodically beat against each other instead of drifting.
    const voices: [number, number, number][] = [
      [0.011, 0.53, -0.7], // base delay (s), LFO rate (Hz), pan
      [0.017, 0.79, 0.7],
    ];
    for (const [base, rate, pan] of voices) {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0; // seconds of sweep, driven by CC93
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      lfo.start();
      const wet = ctx.createGain();
      wet.gain.value = 0;
      chorusIn.connect(delay);
      delay.connect(wet);
      // Width is optional: an engine without a panner still gets the chorus,
      // just centred.
      if (can(ctx, 'createStereoPanner')) {
        const spread = ctx.createStereoPanner();
        spread.pan.value = pan;
        wet.connect(spread);
        spread.connect(chorusOut);
      } else {
        wet.connect(chorusOut);
      }
      chorusWet.push(wet);
      chorusDepth.push(depth);
      chorusLfos.push(lfo);
    }
    relink();
  };

  /**
   * Pan, plus the makeup gain its law needs.
   *
   * A StereoPannerNode has two laws, and which one it uses depends on whether
   * its input happens to be mono — so with a chorus upstream the same pan
   * value would mean something different. Pinning the input to two channels
   * picks one law for good: a mono signal is upmixed the same way the
   * destination would have upmixed it, and centre passes through untouched.
   * That is what makes "pan centre" identical to never panning at all.
   *
   * What that law does *not* do is hold the level: a correlated signal panned
   * hard over sums into one channel at double amplitude, 3 dB up in power. So
   * the pan position carries a makeup gain, 1/√(1+sin(|pan|·π/2)), which is
   * unity at centre and 0.707 at the extremes. Pan then moves the image and
   * nothing else, which is the whole job.
   */
  const panMakeup = (pan: number) => 1 / Math.sqrt(1 + Math.sin((Math.abs(pan) * Math.PI) / 2));

  // A fresh panner sits at centre, where the makeup is unity — so building one
  // needs no level write. CC10 sets both together.
  const ensurePanner = () => {
    if (panner || !can(ctx, 'createStereoPanner')) return;
    panner = ctx.createStereoPanner();
    panner.channelCount = 2;
    panner.channelCountMode = 'explicit';
    relink();
  };

  const ensureReverbSend = () => {
    if (reverbSend) return;
    const room = sharedReverb(ctx, destination);
    if (!room) return;
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0;
    reverbSend.connect(room);
    relink();
  };

  // Build up front whatever the score is going to ask for, so no stage has to
  // be spliced into a graph that is already sounding.
  for (const cc of opts.usesCC ?? []) {
    if (cc === 10) ensurePanner();
    else if (cc === 91) ensureReverbSend();
    else if (cc === 93) ensureChorus();
  }

  // One vibrato LFO per track; notes connect `vibrato` to their detune.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const vibrato = ctx.createGain();
  vibrato.gain.value = 0; // depth in cents, driven by CC1
  lfo.connect(vibrato);
  lfo.start();

  const state: TrackBus['state'] = { playmode: 'default', tremolo: false };

  /**
   * Schedule a smooth move — or write it outright, when the engine has no
   * automation to schedule onto, or when this is the state the bus starts in
   * rather than a move away from it.
   */
  const glide = (param: AudioParam, value: number, time: number, smoothing: number) => {
    if (opts.immediate || time <= built) param.value = value;
    else glideParam(param, value, time, smoothing);
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
      case 7: // channel volume — the fader, not the playing
        // Curved like expression, and multiplied by it: on a real device the
        // fader and the player's dynamics are two independent things that both
        // scale what you hear, which is exactly what a product does.
        volumeLevel = loudness(value);
        writeLevel(time);
        break;
      case 10: { // pan
        ensurePanner();
        // 64 is centre, and it has to land exactly there — a score that never
        // touches pan and one that writes "pan centre" must sound the same.
        const position = Math.max(-1, Math.min(1, (value - 64) / 63));
        if (panner) {
          glide(panner.pan, position, time, 0.05);
          panTrim = panMakeup(position);
          writeLevel(time, 0.05);
        }
        break;
      }
      case 91: { // reverb send
        ensureReverbSend();
        // Curved, because a linear send is unusable at the bottom: 20 already
        // sounds like a small room, and everything above 80 sounds the same.
        if (reverbSend) glide(reverbSend.gain, Math.pow(v, 1.4) * 0.9, time, 0.12);
        break;
      }
      case 93: { // chorus depth
        ensureChorus();
        // Depth moves with the mix: a wide sweep at a low wet level is a
        // detuned smear, and a narrow one at full wet is a flanger. Real
        // chorus units open both together.
        for (const wet of chorusWet) glide(wet.gain, v * 0.7, time, 0.12);
        for (const depth of chorusDepth) glide(depth.gain, 0.0012 + v * 0.0038, time, 0.12);
        break;
      }
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
      for (const osc of [lfo, ...chorusLfos]) {
        try {
          osc.stop();
        } catch {
          // Already stopped.
        }
        osc.disconnect();
      }
      vibrato.disconnect();
      input.disconnect();
      // The shared reverb outlives the bus deliberately: dropping the send
      // stops feeding it, and whatever tail is already inside the convolver
      // rings out instead of being cut off.
      sordino.disconnect();
      chorusOut?.disconnect();
      panner?.disconnect();
      reverbSend?.disconnect();
    },
  };
}
