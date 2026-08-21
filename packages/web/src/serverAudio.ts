/**
 * serverAudio.ts — playing the server's render in this browser.
 *
 * Server mode normally means the score sounds where the server is. With
 * Speaker set to Client the same render is played here instead, which is what
 * you want when the rack lives in another room from the person listening.
 *
 * The audio is not streamed as it plays. The server renders the whole pass
 * ahead of time (`/api/server-prepare`) and this pulls the finished PCM down
 * as one buffer the moment it is ready, so pressing Play starts an AudioBuffer
 * already sitting in memory — no socket to open, no first-chunk latency, and
 * nothing that can stutter halfway through because the network hiccuped.
 *
 * The wire format is raw interleaved stereo 16-bit at the render's rate, with
 * the rate and channel count in the response headers. decodeAudioData is no
 * use for headerless PCM, so the conversion is done here; it is a single pass
 * over the samples and costs a few tens of milliseconds for a whole score.
 */

export interface PreparedAudio {
  /** The render this covers — compare against the server's prepared key. */
  key: string;
  buffer: AudioBuffer;
}

export interface ServerAudioPlayback {
  stop: () => void;
  setVolume: (volume: number) => void;
}

/**
 * Pull the standing render down and decode it into an AudioBuffer.
 *
 * Returns null when the server has nothing prepared, or has prepared a score
 * whose tracks all go out as MIDI and so rendered no audio at all — neither is
 * an error, they just mean there is nothing for this browser to play.
 */
export async function fetchPreparedAudio(
  ctx: BaseAudioContext,
  url = '/api/server-audio-buffer',
): Promise<PreparedAudio | null> {
  const res = await fetch(url);
  if (res.status === 409) return null; // nothing rendered (yet)
  if (!res.ok) throw new Error(`server audio unavailable (${res.status})`);

  const key = res.headers.get('X-Prepared-Key') ?? '';
  const sampleRate = Number(res.headers.get('X-Sample-Rate')) || 44100;
  const channels = Number(res.headers.get('X-Channels')) || 2;
  const samples = new Int16Array(await res.arrayBuffer());
  const frames = Math.floor(samples.length / channels);
  if (!frames) return null;

  // The buffer keeps the render's own rate even when the context runs at
  // another; an AudioBufferSourceNode resamples on playback, which is both
  // cheaper and truer than resampling the whole thing here.
  const buffer = ctx.createBuffer(channels, frames, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < frames; i++) data[i] = samples[i * channels + ch] / 0x8000;
  }
  return { key, buffer };
}

/**
 * Start a prepared buffer. `lead` places it slightly ahead of the clock so the
 * very first samples are never late off a click.
 */
export function playPreparedAudio(
  ctx: AudioContext,
  destination: AudioNode,
  audio: PreparedAudio,
  opts: { loop?: boolean; volume?: number; lead?: number; onEnded?: () => void } = {},
): ServerAudioPlayback {
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, opts.volume ?? 1));
  gain.connect(destination);

  const node = ctx.createBufferSource();
  node.buffer = audio.buffer;
  node.loop = Boolean(opts.loop);
  node.connect(gain);
  node.onended = () => opts.onEnded?.();
  node.start(ctx.currentTime + (opts.lead ?? 0.06));

  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Already finished.
      }
      node.disconnect();
      gain.disconnect();
    },
    setVolume: (volume: number) => {
      // A ramp rather than a jump: an abrupt gain change on sounding audio
      // clicks, and the master slider is dragged, not typed.
      const v = Math.max(0, Math.min(1, volume));
      gain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    },
  };
}
