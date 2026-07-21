/**
 * render.ts — offline render of a compiled song with the built-in sounds
 * (samplers + synth presets), and an MP3 encoder for the Download button.
 *
 * Unlike live playback (Tone.js transport), this schedules directly in
 * seconds on an OfflineAudioContext, using core's tempo mapping — so tempo
 * words, ramps and rubato are baked into the file.
 */

import { Mp3Encoder } from '@breezystack/lamejs';
import {
  CompiledSong, CompiledTrack, beatsToSeconds, detectPreset, playDrum, playNote, tempoSegments,
} from '@play.yaml/core';
import {
  createTrackBus, DRUM_LIBRARY, loadInstrument, Sampler, SAMPLE_LIBRARIES,
} from './sampler';

const SAMPLE_RATE = 44100;
/** Ring-out after the last note, in seconds. */
const TAIL = 1.5;

/** The sampled libraries a track set needs (kits share the drum library). */
export function librariesFor(tracks: CompiledTrack[]): Set<string> {
  const wanted = new Set<string>();
  for (const track of tracks) {
    if (track.kit) {
      if (track.kit !== '808') wanted.add(DRUM_LIBRARY);
    } else {
      const library = SAMPLE_LIBRARIES[track.sample?.toLowerCase() ?? ''];
      if (library) wanted.add(library);
    }
  }
  return wanted;
}

/** Render the whole song (or its first `maxBeats`) to an AudioBuffer. */
export async function renderSong(
  song: CompiledSong,
  opts: { maxBeats?: number; onlyTracks?: string[] } = {},
): Promise<AudioBuffer> {
  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const at = (beat: number) => beatsToSeconds(segments, beat);
  const tracks = song.tracks.filter(
    (t) => !opts.onlyTracks || opts.onlyTracks.includes(t.name),
  );
  const limit = opts.maxBeats ?? Infinity;

  let endSec = 1;
  for (const track of tracks) {
    for (const note of track.timeline) {
      if (note.time >= limit) continue;
      endSec = Math.max(endSec, at(Math.min(note.time + note.duration, limit)));
    }
  }
  const ctx = new OfflineAudioContext(2, Math.ceil((endSec + TAIL) * SAMPLE_RATE), SAMPLE_RATE);

  const samplers = new Map<string, Sampler | null>();
  await Promise.all([...librariesFor(tracks)].map(async (name) => {
    samplers.set(name, await loadInstrument(ctx, name));
  }));

  for (const track of tracks) {
    const bus = createTrackBus(ctx, ctx.destination, {
      hasExpression: (track.controls ?? []).some((c) => c.cc === 11),
    });
    const preset = track.kit ? null : detectPreset(track);
    const sampled = track.kit
      ? (track.kit !== '808' ? samplers.get(DRUM_LIBRARY) : null)
      : samplers.get(SAMPLE_LIBRARIES[track.sample?.toLowerCase() ?? '']) || null;

    for (const control of track.controls ?? []) {
      if (control.time >= limit) continue;
      bus.applyCC(control.cc, control.value, at(control.time));
    }
    for (const note of track.timeline) {
      if (note.time >= limit) continue;
      const start = at(note.time);
      const duration = at(note.time + note.duration) - start; // tempo-aware
      if (track.kit) {
        if (sampled?.kind === 'drums') sampled.play(bus, note.midi, note.velocity, start);
        else playDrum(ctx, bus.input, note.midi, note.velocity, start);
      } else if (sampled?.kind === 'melodic') {
        sampled.play(bus, note.midi, note.velocity, start, duration);
      } else {
        playNote(ctx, bus.input, preset!, note.midi, note.velocity, start, duration);
      }
    }
  }

  return ctx.startRendering();
}

/** AudioBuffer → MP3 blob (joint stereo, 192 kbps). Yields to keep the UI alive. */
export async function encodeMp3(buffer: AudioBuffer): Promise<Blob> {
  const encoder = new Mp3Encoder(2, buffer.sampleRate, 192);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const toInt16 = (data: Float32Array) => {
    const out = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = Math.max(-1, Math.min(1, data[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  };
  const l = toInt16(left);
  const r = toInt16(right);
  const chunks: Uint8Array[] = [];
  const BLOCK = 1152;
  for (let i = 0, block = 0; i < l.length; i += BLOCK, block++) {
    const data = encoder.encodeBuffer(l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK));
    if (data.length > 0) chunks.push(data);
    if (block % 400 === 0) await new Promise((resolve) => setTimeout(resolve));
  }
  const flush = encoder.flush();
  if (flush.length > 0) chunks.push(flush);
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}
