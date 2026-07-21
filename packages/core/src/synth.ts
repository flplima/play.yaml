'use strict';

/**
 * synth.ts — the oscillator instrument presets, shared by every Web Audio
 * backend (the browser player and the CLI via webaudio-node). Pure
 * fire-and-forget voices: each note builds its own little graph against the
 * caller's context/destination and is garbage-collected when it ends.
 */

import type { CompiledTrack } from './song';

export type InstrumentPreset = 'piano' | 'strings' | 'flute' | 'bass' | 'lead';

/** Known sample names → built-in synth preset. */
const SAMPLE_PRESETS: Record<string, InstrumentPreset> = {
  piano: 'piano',
  keys: 'piano',
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
  const sample = track.sample?.toLowerCase();
  if (sample && SAMPLE_PRESETS[sample]) return SAMPLE_PRESETS[sample];
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
    osc.type = 'triangle'; // Mellow fundamental

    // Add a sine overtone for key strike transient (2nd harmonic)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    osc2.frequency.setValueAtTime(freq * 2, startSec);
    activeNodes.push(osc2);

    const gain2 = ctx.createGain();
    gain2.gain.value = targetVolume * 0.25;
    gain2.gain.setValueAtTime(0, startSec);
    gain2.gain.linearRampToValueAtTime(targetVolume * 0.25, startSec + 0.002);
    gain2.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.08); // Quick key hit decay

    osc.connect(gainNode);
    osc2.connect(gain2);
    gain2.connect(destination);

    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.003);
    gainNode.gain.exponentialRampToValueAtTime(targetVolume * 0.35, startSec + 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endSec + 0.4); // Long sustain tail
  } else if (instrument === 'strings') {
    osc.type = 'sawtooth';

    // Warm strings filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    // Vibrato LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 2.0; // Pitch variation depth

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    activeNodes.push(lfo);

    osc.connect(filter);
    filter.connect(gainNode);

    // Slow bowed string envelope
    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.08); // Slow attack
    gainNode.gain.setValueAtTime(targetVolume, Math.max(startSec + 0.08, endSec - 0.04));
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.15); // Long release
  } else if (instrument === 'flute') {
    osc.type = 'sine';

    // Soft vibrato
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 6.0;
    lfoGain.gain.value = 3.0;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    activeNodes.push(lfo);

    osc.connect(gainNode);

    // Wind instrument envelope
    gainNode.gain.value = targetVolume;
    gainNode.gain.setValueAtTime(0, startSec);
    gainNode.gain.linearRampToValueAtTime(targetVolume, startSec + 0.04);
    gainNode.gain.setValueAtTime(targetVolume, Math.max(startSec + 0.04, endSec - 0.02));
    gainNode.gain.linearRampToValueAtTime(0, endSec + 0.06);
  } else {
    // Default synth lead (sawtooth)
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
    node.start(startSec);
    node.stop(endSec + 1.0); // Stop safely after decay/release
  }
}

/** Short metronome blip — accented (higher, louder) on the downbeat. */
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
): void {
  const maxVolume = instrument === 'bass' ? 0.35 : instrument === 'piano' ? 0.25 : 0.15;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  playNotePreset(ctx, destination, instrument, freq, startSec, durationSec, maxVolume * (velocity / 127));
}
