'use strict';

/**
 * synth.ts — the oscillator instrument presets and the synthesized drum kit,
 * shared by every Web Audio backend. Pure fire-and-forget voices: each note
 * builds its own little graph against the caller's context/destination and
 * is garbage-collected when it ends.
 */

import type { CompiledTrack } from './song';
import { loudness } from './bus';

export type InstrumentPreset = 'piano' | 'epiano' | 'strings' | 'flute' | 'bass' | 'lead';

export const SYNTH_PRESETS: Record<string, InstrumentPreset> = {
  piano: 'piano',
  epiano: 'epiano',
  keys: 'epiano',
  synth: 'epiano',
  pluck: 'epiano',
  clav: 'epiano',
  synth_piano: 'epiano',
  bass: 'bass',
  strings: 'strings',
  violin: 'strings', // oscillator fallback — normally the sampler takes over
  cello: 'strings',
  pad: 'strings',
  flute: 'flute',
  ocarina: 'flute',
  lead: 'lead',
};

/**
 * Pick a synth preset from the track's sample. Unknown samples fall back to
 * name keywords, then to the default lead synth.
 */
export function detectPreset(track: CompiledTrack): InstrumentPreset {
  const sample = track.preset?.toLowerCase();
  if (sample && SYNTH_PRESETS[sample]) return SYNTH_PRESETS[sample];
  const name = track.name.toLowerCase();
  if (name.includes('bass')) return 'bass';
  if (name.includes('string') || name.includes('pad') || name.includes('cello')) return 'strings';
  if (name.includes('flute') || name.includes('ocarina') || name.includes('woodwind')) return 'flute';
  if (name.includes('piano') || name.includes('key')) return 'piano';
  return 'lead';
}

/** Schedule one note on an audio context using an instrument preset. */
function playNotePreset(
  ctx: BaseAudioContext,
  destination: AudioNode,
  instrument: InstrumentPreset,
  freq: number,
  startSec: number,
  durationSec: number,
  targetVolume: number,
  vibrato: GainNode,
): void {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const endSec = startSec + durationSec;

  osc.frequency.value = freq;
  osc.frequency.setValueAtTime(freq, startSec);

  const activeNodes: (OscillatorNode)[] = [osc];

  if (instrument === 'bass') {
    osc.type = 'triangle';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500; // Warm roll-off

    osc.connect(filter);
    filter.connect(gainNode);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(targetVolume * 0.4, startSec + 0.12);
    gainNode.gain.linearRampToValueAtTime(0, endSec);
  } else if (instrument === 'piano') {
    osc.type = 'triangle';

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    osc2.frequency.setValueAtTime(freq * 2, startSec);
    activeNodes.push(osc2);

    const gain2 = ctx.createGain();
    gain2.gain.value = targetVolume * 0.25;
    gain2.gain.setValueAtTime(0, startSec);
    gain2.gain.linearRampToValueAtTime(targetVolume * 0.25, startSec + 0.002);
    gain2.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.08);

    osc.connect(gainNode);
    osc2.connect(gain2);
    gain2.connect(destination);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.003);
    gainNode.gain.exponentialRampToValueAtTime(targetVolume * 0.35, startSec + 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endSec + 0.4);
  } else if (instrument === 'epiano') {
    // Two-operator FM electric piano: a decaying modulator gives the tine
    // bark, a quiet 4th-partial sine the bell sparkle on top, and a sharp
    // triangle transient gives the piano-like percussive attack strike.
    osc.type = 'sine';
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    mod.frequency.setValueAtTime(freq * 2, startSec);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 3.5, startSec);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, startSec + 0.35);
    mod.connect(modGain);
    modGain.connect(osc.frequency);
    activeNodes.push(mod);

    const attackOsc = ctx.createOscillator();
    attackOsc.type = 'triangle';
    attackOsc.frequency.value = freq * 4;
    attackOsc.frequency.setValueAtTime(freq * 4, startSec);
    const attackGain = ctx.createGain();
    attackGain.gain.setValueAtTime(0, startSec);
    attackGain.gain.linearRampToValueAtTime(targetVolume * 0.4, startSec + 0.001);
    attackGain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.04);
    attackOsc.connect(attackGain);
    attackGain.connect(destination);
    activeNodes.push(attackOsc);

    const sparkle = ctx.createOscillator();
    sparkle.type = 'sine';
    sparkle.frequency.value = freq * 4;
    sparkle.frequency.setValueAtTime(freq * 4, startSec);
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(targetVolume * 0.15, startSec);
    sparkleGain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.4);
    sparkle.connect(sparkleGain);
    sparkleGain.connect(destination);
    activeNodes.push(sparkle);

    osc.connect(gainNode);
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.002);
    gainNode.gain.exponentialRampToValueAtTime(targetVolume * 0.25, startSec + 0.5);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endSec + 0.3);
  } else if (instrument === 'strings') {
    osc.type = 'sawtooth';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 2.0;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    activeNodes.push(lfo);

    osc.connect(filter);
    filter.connect(gainNode);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.08);
    gainNode.gain.setValueAtTime(targetVolume, Math.max(startSec + 0.08, endSec - 0.04));
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.15);
  } else if (instrument === 'flute') {
    osc.type = 'sine';

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 6.0;
    lfoGain.gain.value = 3.0;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    activeNodes.push(lfo);

    osc.connect(gainNode);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.04);
    gainNode.gain.setValueAtTime(targetVolume, Math.max(startSec + 0.04, endSec - 0.02));
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.06);
  } else {
    osc.type = 'sawtooth';
    osc.connect(gainNode);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.005);
    gainNode.gain.setValueAtTime(targetVolume, Math.max(startSec + 0.005, endSec - 0.01));
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.01);
  }

  gainNode.connect(destination);

  for (const node of activeNodes) {
    // The track bus's vibrato LFO feeds every voice's detune in cents. Without
    // this the `vibrato` family of words moved a control nothing listened to,
    // so vibrato was inaudible on the synth presets (it only ever reached the
    // sampled instruments).
    vibrato.connect(node.detune);
    node.start(startSec);
    node.stop(endSec + 1.0);
  }
}

/** Metronome blip, accented (higher, louder) on the downbeat. */
export function metronomeClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  time: number,
  accent: boolean,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1760 : 1175;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.22 : 0.12, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + 0.08);
}

/** Play one timeline note with a preset at an exact audio-context time. */
export function playNote(
  ctx: BaseAudioContext,
  destination: AudioNode,
  instrument: InstrumentPreset,
  midi: number,
  velocity: number,
  startSec: number,
  durationSec: number,
  /** Track-bus vibrato feed (cents) — connected to every voice's detune. */
  vibrato: GainNode,
): void {
  const maxVolume =
    instrument === 'bass' ? 0.35 : instrument === 'piano' || instrument === 'epiano' ? 0.25 : 0.15;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  playNotePreset(ctx, destination, instrument, freq, startSec, durationSec, maxVolume * loudness(velocity), vibrato);
}

// ---------------------------------------------------------------------------
// The synthesized drum kit (the `808` kit, and the fallback for every kit)
// ---------------------------------------------------------------------------

/** One shared second of white noise per context — sources are cheap, buffers not. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

interface NoiseVoice {
  gain: number;
  decay: number;
  /** highpass cutoff */
  hp?: number;
  /** bandpass centre (used instead of hp when set) */
  bp?: number;
  q?: number;
  delay?: number;
}

function noiseHit(ctx: BaseAudioContext, destination: AudioNode, time: number, v: NoiseVoice): void {
  const at = time + (v.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  if (v.bp) {
    filter.type = 'bandpass';
    filter.frequency.value = v.bp;
  } else {
    filter.type = 'highpass';
    filter.frequency.value = v.hp ?? 3000;
  }
  filter.Q.value = v.q ?? 0.7;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(v.gain, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + v.decay);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(at);
  source.stop(at + v.decay + 0.05);
}

interface ToneVoice {
  gain: number;
  decay: number;
  freq: number;
  /** pitch glide target — the drop that makes a kick a kick */
  to?: number;
  glide?: number;
  type?: OscillatorType;
}

function toneHit(ctx: BaseAudioContext, destination: AudioNode, time: number, v: ToneVoice): void {
  const osc = ctx.createOscillator();
  osc.type = v.type ?? 'sine';
  osc.frequency.setValueAtTime(v.freq, time);
  if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, time + (v.glide ?? 0.08));
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(v.gain, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + v.decay);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + v.decay + 0.05);
}

const TOM_FREQS: Record<number, number> = { 41: 75, 43: 85, 45: 100, 47: 120, 48: 140, 50: 165 };
const CONGA_FREQS: Record<number, number> = { 60: 400, 61: 300, 62: 370, 63: 310, 64: 230, 65: 300, 66: 240 };

/**
 * Play one drum hit — 808-style synthesis keyed by the GM percussion note.
 * Used directly by the `808` kit and as the fallback when a sampled kit
 * hasn't loaded. One-shots: duration comes from the recipe, not the slot.
 */
export function playDrum(
  ctx: BaseAudioContext,
  destination: AudioNode,
  midi: number,
  velocity: number,
  time: number,
): void {
  const level = loudness(velocity);
  const noise = (v: NoiseVoice) => noiseHit(ctx, destination, time, { ...v, gain: v.gain * level });
  const tone = (v: ToneVoice) => toneHit(ctx, destination, time, { ...v, gain: v.gain * level });

  switch (midi) {
    case 35: case 36: // kick: falling sine + attack click
      tone({ freq: 130, to: 42, glide: 0.1, decay: 0.42, gain: 1.0 });
      noise({ hp: 1500, decay: 0.02, gain: 0.35 });
      break;
    case 38: case 40: // snare: bright noise over a short tuned thump
      noise({ bp: 1700, q: 0.8, decay: 0.19, gain: 0.8 });
      tone({ freq: 190, to: 150, decay: 0.12, gain: 0.35, type: 'triangle' });
      break;
    case 37: // side stick
      tone({ freq: 1750, decay: 0.03, gain: 0.25, type: 'square' });
      noise({ bp: 3200, q: 2, decay: 0.025, gain: 0.3 });
      break;
    case 39: // clap: three fast bursts and a tail
      for (const delay of [0, 0.011, 0.022]) noise({ bp: 1150, q: 1.6, decay: 0.035, gain: 0.7, delay });
      noise({ bp: 1150, q: 1.6, decay: 0.24, gain: 0.5, delay: 0.026 });
      break;
    case 42: noise({ hp: 7500, decay: 0.05, gain: 0.35 }); break; // closed hat
    case 44: noise({ hp: 6500, decay: 0.035, gain: 0.25 }); break; // pedal hat
    case 46: noise({ hp: 6500, decay: 0.45, gain: 0.32 }); break; // open hat
    case 41: case 43: case 45: case 47: case 48: case 50: { // toms
      const f = TOM_FREQS[midi];
      tone({ freq: f * 1.35, to: f, decay: 0.3, gain: 0.8 });
      noise({ bp: f * 8, q: 0.5, decay: 0.03, gain: 0.15 });
      break;
    }
    case 49: case 57: // crashes
      noise({ hp: 4500, decay: 1.4, gain: 0.5 });
      noise({ bp: 9000, q: 0.4, decay: 0.9, gain: 0.25 });
      break;
    case 55: noise({ hp: 6000, decay: 0.5, gain: 0.45 }); break; // splash
    case 52: noise({ bp: 3300, q: 0.3, decay: 1.0, gain: 0.5 }); break; // china (trashy)
    case 51: case 59: // rides: airy wash + a faint stick ping
      noise({ hp: 8000, decay: 0.9, gain: 0.2 });
      tone({ freq: 520, decay: 0.35, gain: 0.05, type: 'square' });
      break;
    case 53: // ride bell
      tone({ freq: 590, decay: 0.35, gain: 0.16, type: 'square' });
      tone({ freq: 875, decay: 0.3, gain: 0.12, type: 'square' });
      break;
    case 56: // cowbell — the classic two detuned squares
      tone({ freq: 540, decay: 0.28, gain: 0.28, type: 'square' });
      tone({ freq: 800, decay: 0.22, gain: 0.22, type: 'square' });
      break;
    case 54: // tambourine
      noise({ hp: 6000, decay: 0.12, gain: 0.3 });
      noise({ bp: 9500, q: 1.5, decay: 0.2, gain: 0.2 });
      break;
    case 58: noise({ bp: 2200, q: 4, decay: 0.55, gain: 0.35 }); break; // vibraslap
    case 69: noise({ hp: 5500, decay: 0.08, gain: 0.3 }); break; // cabasa
    case 70: noise({ hp: 6000, decay: 0.06, gain: 0.3 }); break; // maracas
    case 82: noise({ hp: 5800, decay: 0.09, gain: 0.3 }); break; // shaker
    case 60: case 61: case 62: case 63: case 64: case 65: case 66: { // bongos/congas/timbales
      const f = CONGA_FREQS[midi];
      tone({ freq: f * 1.15, to: f, glide: 0.02, decay: midi >= 65 ? 0.22 : 0.16, gain: 0.55 });
      if (midi >= 65) noise({ bp: 2400, q: 1, decay: 0.08, gain: 0.2 }); // timbale rim air
      break;
    }
    case 67: tone({ freq: 900, decay: 0.2, gain: 0.22, type: 'square' }); break; // agogo hi
    case 68: tone({ freq: 620, decay: 0.22, gain: 0.22, type: 'square' }); break; // agogo lo
    case 73: noise({ bp: 2300, q: 2.5, decay: 0.12, gain: 0.28 }); break; // guiro short
    case 74: noise({ bp: 2100, q: 2.5, decay: 0.3, gain: 0.28 }); break; // guiro long
    case 75: tone({ freq: 2500, decay: 0.035, gain: 0.4 }); break; // claves
    case 76: tone({ freq: 1600, decay: 0.05, gain: 0.4 }); break; // woodblock hi
    case 77: tone({ freq: 1100, decay: 0.055, gain: 0.4 }); break; // woodblock lo
    case 78: tone({ freq: 420, to: 330, decay: 0.2, gain: 0.25, type: 'sawtooth' }); break; // cuica mute
    case 79: tone({ freq: 330, to: 480, glide: 0.15, decay: 0.28, gain: 0.25, type: 'sawtooth' }); break; // cuica open
    case 80: // muted triangle
      tone({ freq: 4050, decay: 0.09, gain: 0.18 });
      tone({ freq: 6200, decay: 0.07, gain: 0.1 });
      break;
    case 81: // open triangle
      tone({ freq: 4050, decay: 1.1, gain: 0.18 });
      tone({ freq: 6200, decay: 0.9, gain: 0.1 });
      break;
    case 71: tone({ freq: 2300, decay: 0.12, gain: 0.2 }); break; // short whistle
    case 72: tone({ freq: 2100, decay: 0.45, gain: 0.2 }); break; // long whistle
    case 83: noise({ bp: 8000, q: 2, decay: 0.35, gain: 0.3 }); break; // sleigh bells
    case 84: noise({ hp: 9000, decay: 1.0, gain: 0.15 }); break; // bell tree
    default: // unmapped GM key — a neutral, short percussive blip
      noise({ bp: 2000, q: 1, decay: 0.1, gain: 0.3 });
      break;
  }
}
