/**
 * @play.yaml/node-audio — rendering a score to audio on Node, and getting it
 * out of the speakers.
 *
 * Shared by the studio's dev-server plugin (server-side playback) and the CLI
 * player: both want the browser's sound out of this machine's speakers, and
 * both hit the same engine constraints, so neither grows its own copy.
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
 *   • The rendered audio is fixed. Master volume still works live (it scales
 *     samples on their way to the sink), but anything that would change the
 *     *rendering* — editing the score, changing an instrument — needs a new
 *     render, so there is no hot-swap on the server the way there is in the
 *     browser's live transport.
 *   • Seeking is limited to what the caller asks for at render time.
 *   • Output goes to whatever `aplay` picks; there is no per-track routing to
 *     separate audio devices the way MIDI has per-track ports.
 *   • The orchestra is read off disk from the VPO library (`vpoRoot()`), the
 *     same files jukebox plays; a machine without it renders every track on
 *     the synth presets.
 *
 * Verified parity against the browser's own render, measured over an identical
 * 4 s window: cello centroid 1313 Hz both sides, piano 674 vs 673 Hz, RMS
 * within 0.4%, violin bit-identical.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scheduleSong, songEndBeat, tempoSegments, beatsToSeconds, secondsToBeats, prepareVpo,
} from '@play.yaml/core';
import type { CompiledSong, CompiledTrack, SfzAssets } from '@play.yaml/core';

let offlineCtor: any = null;
let enginePromise: Promise<any> | null = null;

/**
 * Load the render engine on first use. Lazy on purpose: it is a ~40 MB native
 * module, and the commands that only export MIDI or score fidelity should not
 * pay for it.
 */
function engine(): Promise<any> {
  if (!enginePromise) {
    enginePromise = import('node-web-audio-api')
      .then((mod: any) => {
        offlineCtor = mod.OfflineAudioContext ?? mod.default?.OfflineAudioContext;
        return offlineCtor;
      })
      .catch(() => null); // Rendering unavailable; MIDI output still works.
  }
  return enginePromise;
}

export const SAMPLE_RATE = 44100;
const CHANNELS = 2;
/** Ring-out kept after the last note, matching the browser's MP3 render. */
const TAIL_SEC = 1.5;

export async function audioRenderingAvailable(): Promise<boolean> {
  return Boolean(await engine());
}

// ───────────────────────────────── render ─────────────────────────────────

/**
 * Where the Virtual Playing Orchestra lives on this machine.
 *
 * The same directory jukebox's `jukebox.yaml` points its VPO channels at, so
 * the server's own renders and the rack play identical recordings. Override
 * with PLAY_YAML_VPO for a library kept elsewhere.
 */
export function vpoRoot(): string {
  return path.resolve(
    process.env.PLAY_YAML_VPO ?? path.join(os.homedir(), 'samples/VPO/Virtual-Playing-Orchestra3'),
  );
}

/**
 * A library path → the file on disk, or null if there is none.
 *
 * Case-insensitive on purpose: two dozen of VPO's programs spell a directory
 * `samples/` that the library ships as `Samples/`, which a Windows sampler
 * never notices and a Linux one turns into silence. Each segment is matched
 * exactly first and by case-folded name second, so the exact library never
 * pays for the fix. Anything that escapes the root resolves to null.
 */
export function resolveVpoFile(root: string, relative: string): string | null {
  const parts = relative.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  let current = root;
  for (const part of parts) {
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return null;
    }
    const folded = part.toLowerCase();
    const match = entries.find((e) => e.toLowerCase() === folded);
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
}

/** The library as the sampler reads it: text and bytes by library path. */
function diskAssets(root: string): SfzAssets {
  const file = (relative: string) => {
    const resolved = resolveVpoFile(root, relative);
    if (!resolved) throw new Error(`${relative} is not in the VPO library at ${root}`);
    return resolved;
  };
  return {
    text: (relative) => fs.promises.readFile(file(relative), 'utf8'),
    audio: async (relative) => {
      const buf = await fs.promises.readFile(file(relative));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
}

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
  opts: { onlyTracks?: string[]; fromBeat?: number } = {},
): Promise<ChunkedRender> {
  if (!(await engine())) throw new Error('node-web-audio-api is not available on this machine');

  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const fromBeat = opts.fromBeat ?? 0;
  const startSec = beatsToSeconds(segments, fromBeat);
  const durationSec =
    Math.max(0, beatsToSeconds(segments, songEndBeat(song)) - startSec) + TAIL_SEC;

  const scratch = new offlineCtor(1, SAMPLE_RATE, SAMPLE_RATE);
  // A machine without the library renders on the synth presets, as the
  // browser does when a fetch fails; a track the orchestra cannot load says
  // so in the log rather than failing the render.
  const orchestra = fs.existsSync(vpoRoot())
    ? await prepareVpo(scratch, diskAssets(vpoRoot()), song, { onlyTracks: opts.onlyTracks })
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
      onlyTracks: opts.onlyTracks,
      instrumentFor: (track: CompiledTrack) => orchestra.get(track.name) ?? null,
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
 * Render a whole score in one pass. Fine for short things (the Test button);
 * use createChunkedRender for anything score-length — see the note about
 * quadratic cost at the top of this file.
 */
export async function renderSongToPcm(
  song: CompiledSong,
  opts: { onlyTracks?: string[]; fromBeat?: number } = {},
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

let cachedSink: Sink | null | undefined;

export function detectSink(): Sink | null {
  if (cachedSink !== undefined) return cachedSink;
  cachedSink = SINKS.find((s) => spawnSync('which', [s.command]).status === 0) ?? null;
  if (!cachedSink) {
    console.warn('[server-audio] no PCM sink found (looked for: ' + SINKS.map((s) => s.command).join(', ') + ')');
  }
  return cachedSink;
}

export interface PcmPlayback {
  stop: () => void;
  setVolume: (volume: number) => void;
  /** Seconds of audio handed to the sink so far — the playhead. */
  positionSec: () => number;
  /** Resolves when playback finishes on its own (never, while looping). */
  done: Promise<void>;
}

/** How far ahead of the wall clock we keep the sink's buffer. */
const LEAD_SEC = 0.25;
const TICK_MS = 50;

/**
 * Stream rendered PCM to the audio sink, paced against the wall clock.
 *
 * Pacing rather than dumping the whole buffer is what keeps stop and volume
 * responsive: only a quarter second of audio is ever committed, so a change
 * takes effect almost immediately instead of after everything already queued.
 * It also means the playhead this reports stays in step with the MIDI stepper,
 * which is driven by the same wall clock.
 */
export function playPcm(
  render: RenderResult,
  opts: { volume?: number; loop?: boolean; startAtMs?: number },
): PcmPlayback {
  let index = 0;
  return playChunks(
    {
      sampleRate: render.sampleRate,
      durationSec: render.durationSec,
      chunkCount: 1,
      chunkSec: render.durationSec,
      renderChunk: async () => (index++ === 0 ? render.pcm : new Float32Array(0)),
    },
    opts,
  );
}

/**
 * Stream a chunked render to the audio sink, paced against the wall clock.
 *
 * Pacing rather than dumping everything is what keeps stop and volume
 * responsive: only a quarter second of audio is ever committed, so a change
 * takes effect almost immediately instead of after a queue drains. It also
 * keeps the playhead this reports in step with the MIDI stepper, which runs
 * off the same wall clock.
 *
 * Chunks are rendered one ahead of what is being written. Rendering runs far
 * faster than realtime, so the writer never catches up — but if it ever did,
 * the pump simply waits rather than emitting a gap.
 */
export function playChunks(
  render: ChunkedRender,
  opts: { volume?: number; loop?: boolean; startAtMs?: number },
): PcmPlayback {
  const sink = detectSink();
  if (!sink) throw new Error('No audio sink available on this server (install alsa-utils or ffmpeg)');

  const { sampleRate } = render;
  let volume = Math.max(0, Math.min(1, opts.volume ?? 1));
  const loop = Boolean(opts.loop);
  const startAtMs = opts.startAtMs ?? Date.now();

  const child: ChildProcess = spawn(sink.command, sink.args(sampleRate, CHANNELS), {
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  const ready = new Map<number, Float32Array>();
  const inflight = new Set<number>();
  let nextChunk = 0; // chunk the writer wants next
  let current: Float32Array | null = null; // chunk being written out
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
  child.on('error', finish);
  child.on('exit', finish);
  child.stdin?.on('error', () => { /* EPIPE when the sink goes away first */ });

  /** Keep one chunk rendered ahead of the writer. */
  const prefetch = (from: number) => {
    for (let i = from; i < Math.min(from + 2, render.chunkCount); i++) {
      if (ready.has(i) || inflight.has(i)) continue;
      inflight.add(i);
      void render
        .renderChunk(i)
        .then((pcm) => { ready.set(i, pcm); })
        .catch((err) => { console.warn('[server-audio] chunk render failed:', err); ready.set(i, new Float32Array(0)); })
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
        if (!loop) {
          const remainingMs = (framesWritten / sampleRate - elapsedSec) * 1000;
          timer = setTimeout(finish, Math.max(0, remainingMs) + 250);
          return;
        }
        nextChunk = 0;
        ready.clear();
        prefetch(0);
      }
      if (!current) {
        const pcm = ready.get(nextChunk);
        if (!pcm) {
          // Render has not caught up. Wait rather than write silence.
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

      // Write only as far as the lead window reaches, not the whole chunk:
      // everything committed to the sink is already fixed at the volume it was
      // converted with, so a large write would make the master slider lag.
      const chunkFrames = current.length / CHANNELS;
      const take = Math.min(chunkFrames - currentFrame, wantFrames - framesWritten);
      const from = currentFrame * CHANNELS;
      const to = (currentFrame + take) * CHANNELS;
      const out = Buffer.allocUnsafe((to - from) * 2);
      for (let i = from; i < to; i++) {
        const v = current[i] * volume;
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
    setVolume: (v: number) => { volume = Math.max(0, Math.min(1, v)); },
    positionSec: () => Math.max(0, (Date.now() - startAtMs) / 1000),
    done,
  };
}
