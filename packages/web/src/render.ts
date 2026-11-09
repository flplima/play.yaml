/**
 * render.ts — offline render of a compiled song with the built-in sounds
 * (the orchestra + synth presets), and an MP3 encoder for the Download button.
 *
 * Unlike live playback (Tone.js transport), this schedules directly in
 * seconds on an OfflineAudioContext, using core's tempo mapping — so tempo
 * words, ramps and rubato are baked into the file.
 */

import { Mp3Encoder } from '@breezystack/lamejs';
import {
  CompiledSong, beatsToSeconds, prepareVpo, scheduleSong, songEndBeat, tempoSegments,
} from '@play.yaml/core';
import { httpAssets } from './vpo';

const SAMPLE_RATE = 44100;
/** Ring-out after the last note, in seconds. */
const TAIL = 1.5;

/** Render the whole song to an AudioBuffer. */
export async function renderSong(song: CompiledSong): Promise<AudioBuffer> {
  const endSec = Math.max(1, beatsToSeconds(tempoSegments(song.bpm, song.tempoMap), songEndBeat(song)));
  const ctx = new OfflineAudioContext(2, Math.ceil((endSec + TAIL) * SAMPLE_RATE), SAMPLE_RATE);
  const orchestra = await prepareVpo(ctx, httpAssets, song);
  scheduleSong(ctx, ctx.destination, song, { originTime: 0, orchestra });
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
  const BLOCK = 1152; // one MP3 frame
  for (let i = 0, block = 0; i < l.length; i += BLOCK, block++) {
    const data = encoder.encodeBuffer(l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK));
    if (data.length > 0) chunks.push(data);
    if (block % 400 === 0) await new Promise((resolve) => setTimeout(resolve));
  }
  const flush = encoder.flush();
  if (flush.length > 0) chunks.push(flush);
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}
