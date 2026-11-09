/**
 * @play.yaml/node-audio — rendering a score to audio on Node, and getting it
 * out of the speakers. The CLI player is built on it.
 *
 * ── Why it is built this way ──────────────────────────────────────────────
 *
 * The obvious design is a realtime AudioContext in Node, and that is what this
 * used to be. Two measured problems killed it:
 *
 *   • webaudio-node 0.8.0 implements no AudioParam automation whatsoever —
 *     setValueAtTime, the ramps, setTargetAtTime and setValueCurveAtTime are
 *     all accepted and silently dropped. Every note came out as a rectangle
 *     with no attack or decay, and none of the score's control stream
 *     (expression, bow position, sordino) reached the sound.
 *   • node-web-audio-api renders correctly but its realtime output on this
 *     machine runs at roughly a third of wall-clock speed.
 *
 * So: render *offline* with node-web-audio-api — where the DSP is exactly the
 * browser's, envelopes and all — then push the finished PCM to a system audio
 * sink at the right rate. No realtime Web Audio engine is involved, which is
 * what makes the result match what the studio plays in the browser.
 *
 * ── What this costs ───────────────────────────────────────────────────────
 *
 *   • Playback starts after the first chunk renders (well under a second),
 *     not after the whole score. Rendering is chunked and streamed for a
 *     reason: node-web-audio-api never drops stopped source nodes, so a single
 *     context's render cost is quadratic in note count — measured 195 s to
 *     render 119 s of BWV 846 in one pass. Chunking keeps the live node count
 *     bounded and makes it linear (~18x realtime), which is also what lets
 *     playback start early and stay ahead.
 *   • A note that began more than one pre-roll before a chunk boundary is not
 *     re-attacked into that chunk. The pre-roll is sized from the score's own
 *     longest note, so this only bites on held notes longer than PRE_ROLL_MAX.
 *   • The rendered audio is fixed: there is no hot-swap the way there is in
 *     the browser's live transport.
 *   • Output goes to whatever `aplay` picks; there is no per-track routing to
 *     separate audio devices the way MIDI has per-track ports.
 *   • The orchestra is read off disk from the VPO library (vpoDisk.ts); a
 *     machine without it renders every track on the synth presets.
 *
 * Verified parity against the browser's own render, measured over an identical
 * 4 s window: cello centroid 1313 Hz both sides, piano 674 vs 673 Hz, RMS
 * within 0.4%, violin bit-identical.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import {
  scheduleSong, songEndBeat, tempoSegments, beatsToSeconds, secondsToBeats, prepareVpo,
} from '@play.yaml/core';
import type { CompiledSong, Orchestra } from '@play.yaml/core';
import { diskAssets, vpoInstalled, vpoRoot } from './vpoDisk';

let offlineCtor: any = null;
let enginePromise: Promise<any> | null = null;

/**
 * Load the render engine on first use. Lazy on purpose: it is a ~40 MB native
 * module, and the commands that only export MIDI or score fidelity should not
 * pay for it. Rejects with the import error when the module is unusable.
 */
function engine(): Promise<any> {
  enginePromise ??= import('node-web-audio-api').then((mod: any) => {
    offlineCtor = mod.OfflineAudioContext ?? mod.default?.OfflineAudioContext;
    return offlineCtor;
  });
  return enginePromise;
}

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
/** Ring-out kept after the last note, matching the browser's MP3 render. */
const TAIL_SEC = 1.5;

// ───────────────────────────────── render ─────────────────────────────────

export interface RenderResult {
  /** Interleaved stereo float samples. */
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
}

/** Longest pre-roll we will re-render to keep a held note intact. */
const PRE_ROLL_MAX = 12;
const CHUNK_SEC = 8;

/** A score prepared for chunk-at-a-time rendering. */
export interface ChunkedRender {
  sampleRate: number;
  durationSec: number;
  chunkCount: number;
  chunkSec: number;
  /** Interleaved stereo PCM for chunk `index`. */
  renderChunk: (index: number) => Promise<Float32Array>;
}

/** Longest note in the score, in seconds — sizes the chunk pre-roll. */
function longestNoteSec(song: CompiledSong, segments: ReturnType<typeof tempoSegments>): number {
  let longest = 0;
  for (const track of song.tracks) {
    for (const note of track.timeline) {
      longest = Math.max(
        longest,
        beatsToSeconds(segments, note.time + note.duration) - beatsToSeconds(segments, note.time),
      );
    }
  }
  return longest;
}

/**
 * Prepare a score for streamed rendering.
 *
 * The orchestra is loaded once, against a scratch context, and its decoded
 * samples are reused by every chunk — an AudioBuffer is not bound to the
 * context that decoded it, and re-decoding per chunk would cost more than
 * the render.
 */
export async function createChunkedRender(
  song: CompiledSong,
  opts: { fromBeat?: number } = {},
): Promise<ChunkedRender> {
  try {
    await engine();
  } catch (err) {
    throw new Error(`node-web-audio-api is not available on this machine: ${err instanceof Error ? err.message : err}`);
  }

  const segments = tempoSegments(song.bpm, song.tempoMap);
  const fromBeat = opts.fromBeat ?? 0;
  const startSec = beatsToSeconds(segments, fromBeat);
  const durationSec =
    Math.max(0, beatsToSeconds(segments, songEndBeat(song)) - startSec) + TAIL_SEC;

  const scratch = new offlineCtor(1, SAMPLE_RATE, SAMPLE_RATE);
  // A machine without the library renders on the synth presets, as the
  // browser does when a fetch fails; a track the orchestra cannot load says
  // so in the log rather than failing the render.
  const orchestra: Orchestra = vpoInstalled()
    ? await prepareVpo(scratch, diskAssets(vpoRoot()), song)
    : new Map();

  const preRollSec = Math.min(PRE_ROLL_MAX, longestNoteSec(song, segments) + TAIL_SEC);
  const chunkCount = Math.max(1, Math.ceil(durationSec / CHUNK_SEC));

  const renderChunk = async (index: number): Promise<Float32Array> => {
    const chunkStart = index * CHUNK_SEC;
    const chunkLen = Math.min(CHUNK_SEC, durationSec - chunkStart);
    if (chunkLen <= 0) return new Float32Array(0);

    // Render the pre-roll too, then throw it away: notes that began before the
    // boundary keep their real attack and arrive mid-decay, as they should.
    //
    // The window is expressed in *beats* rather than by shifting the origin
    // backwards. A negative origin would ask the engine to start sources at a
    // negative time, which it rejects outright — and every note before the
    // chunk would have hit that path.
    const windowStartSec = Math.max(0, startSec + chunkStart - preRollSec);
    const preFrames = Math.round((startSec + chunkStart - windowStartSec) * SAMPLE_RATE);
    const windowFromBeat = Math.max(fromBeat, secondsToBeats(segments, windowStartSec));
    const windowToBeat = secondsToBeats(segments, startSec + chunkStart + chunkLen);
    const frames = Math.ceil(chunkLen * SAMPLE_RATE) + preFrames;
    const ctx = new offlineCtor(CHANNELS, frames, SAMPLE_RATE);

    scheduleSong(ctx, ctx.destination, song, {
      originTime: 0,
      fromBeat: windowFromBeat,
      maxBeats: windowToBeat,
      orchestra,
    });

    const buffer = await ctx.startRendering();
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const outFrames = Math.min(left.length - preFrames, Math.ceil(chunkLen * SAMPLE_RATE));
    const pcm = new Float32Array(Math.max(0, outFrames) * CHANNELS);
    for (let i = 0; i < outFrames; i++) {
      pcm[i * 2] = left[preFrames + i];
      pcm[i * 2 + 1] = right[preFrames + i];
    }
    return pcm;
  };

  return { sampleRate: SAMPLE_RATE, durationSec, chunkCount, chunkSec: CHUNK_SEC, renderChunk };
}

/**
 * Render a whole score in one pass. Fine for short things; use
 * createChunkedRender for anything score-length — see the note about
 * quadratic cost at the top of this file.
 */
export async function renderSongToPcm(
  song: CompiledSong,
  opts: { fromBeat?: number } = {},
): Promise<RenderResult> {
  const chunked = await createChunkedRender(song, opts);
  const parts: Float32Array[] = [];
  let total = 0;
  for (let i = 0; i < chunked.chunkCount; i++) {
    const part = await chunked.renderChunk(i);
    parts.push(part);
    total += part.length;
  }
  const pcm = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    pcm.set(part, at);
    at += part.length;
  }
  return { pcm, sampleRate: chunked.sampleRate, durationSec: total / CHANNELS / chunked.sampleRate };
}

// ────────────────────────────────── sink ──────────────────────────────────

interface Sink {
  command: string;
  args: (sampleRate: number, channels: number) => string[];
}

/*
 * Raw PCM on stdin. `aplay` is preferred because it takes the format on the
 * command line and needs no header; `pw-play` refuses "-" as a file, so it is
 * not usable this way and is deliberately absent. ffplay is the fallback.
 */
const SINKS: Sink[] = [
  { command: 'aplay', args: (sr, ch) => ['-q', '-f', 'S16_LE', '-r', String(sr), '-c', String(ch), '-'] },
  {
    command: 'ffplay',
    args: (sr, ch) => [
      '-hide_banner', '-loglevel', 'error', '-nodisp', '-autoexit',
      '-f', 's16le', '-ar', String(sr), '-ch_layout', ch === 2 ? 'stereo' : 'mono', '-i', '-',
    ],
  },
];

function detectSink(): Sink | null {
  return SINKS.find((s) => spawnSync('which', [s.command]).status === 0) ?? null;
}

export interface PcmPlayback {
  stop: () => void;
  /** Resolves when playback finishes on its own. */
  done: Promise<void>;
}

/** How far ahead of the wall clock we keep the sink's buffer. */
const LEAD_SEC = 0.25;
const TICK_MS = 50;

/**
 * Stream a chunked render to the audio sink, paced against the wall clock.
 *
 * Pacing rather than dumping everything is what keeps stop responsive: only a
 * quarter second of audio is ever committed, so a stop silences the speakers
 * almost immediately instead of after a queue drains.
 *
 * Chunks are rendered ahead of what is being written. Rendering runs far
 * faster than realtime, so the writer never catches up — but if it ever did,
 * the pump waits rather than emitting a gap.
 */
export function playChunks(render: ChunkedRender, opts: { startAtMs?: number } = {}): PcmPlayback {
  const sink = detectSink();
  if (!sink) {
    throw new Error(`No audio sink available (looked for ${SINKS.map((s) => s.command).join(', ')}; install alsa-utils or ffmpeg)`);
  }

  const { sampleRate } = render;
  const startAtMs = opts.startAtMs ?? Date.now();

  const child: ChildProcess = spawn(sink.command, sink.args(sampleRate, CHANNELS), {
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  const ready = new Map<number, Float32Array>();
  const inflight = new Set<number>();
  let nextChunk = 0;
  let current: Float32Array | null = null;
  let currentFrame = 0;
  let framesWritten = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });

  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    try { child.stdin?.end(); } catch { /* already closed */ }
    resolveDone();
  };

  // The sink dying (device grabbed, user killed it) must not wedge the transport.
  child.on('error', (err) => { console.warn(`play-yaml: audio sink failed: ${err.message}`); finish(); });
  child.on('exit', finish);
  child.stdin?.on('error', () => { /* EPIPE when the sink goes away first */ });

  /** Keep two chunks rendered ahead of the writer. */
  const prefetch = (from: number) => {
    for (let i = from; i < Math.min(from + 2, render.chunkCount); i++) {
      if (ready.has(i) || inflight.has(i)) continue;
      inflight.add(i);
      void render
        .renderChunk(i)
        .then((pcm) => { ready.set(i, pcm); })
        .catch((err) => { console.warn('play-yaml: chunk render failed:', err); ready.set(i, new Float32Array(0)); })
        .finally(() => { inflight.delete(i); });
    }
  };

  prefetch(0);

  const pump = () => {
    if (stopped) return;
    const elapsedSec = (Date.now() - startAtMs) / 1000;
    const wantFrames = Math.ceil((elapsedSec + LEAD_SEC) * sampleRate);

    while (framesWritten < wantFrames) {
      if (nextChunk >= render.chunkCount) {
        const remainingMs = (framesWritten / sampleRate - elapsedSec) * 1000;
        timer = setTimeout(finish, Math.max(0, remainingMs) + 250);
        return;
      }
      if (!current) {
        const pcm = ready.get(nextChunk);
        if (!pcm) {
          prefetch(nextChunk);
          timer = setTimeout(pump, TICK_MS);
          return;
        }
        ready.delete(nextChunk);
        nextChunk++;
        prefetch(nextChunk);
        if (!pcm.length) continue;
        current = pcm;
        currentFrame = 0;
      }

      // Write only as far as the lead window reaches, not the whole chunk, so
      // a stop never has more than the lead already committed to the sink.
      const chunkFrames = current.length / CHANNELS;
      const take = Math.min(chunkFrames - currentFrame, wantFrames - framesWritten);
      const from = currentFrame * CHANNELS;
      const to = (currentFrame + take) * CHANNELS;
      const out = Buffer.allocUnsafe((to - from) * 2);
      for (let i = from; i < to; i++) {
        const v = current[i];
        const clamped = v > 1 ? 1 : v < -1 ? -1 : v;
        out.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), (i - from) * 2);
      }
      try {
        child.stdin?.write(out);
      } catch {
        finish();
        return;
      }
      currentFrame += take;
      framesWritten += take;
      if (currentFrame >= chunkFrames) current = null;
    }
    timer = setTimeout(pump, TICK_MS);
  };

  pump();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      // Kill rather than drain: a stop should silence the speakers now, not
      // after the quarter second already committed to the sink.
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolveDone();
    },
    done,
  };
}
