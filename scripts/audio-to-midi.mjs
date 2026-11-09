/**
 * audio-to-midi.mjs — a recording → note events → `.mid`, on Node alone.
 *
 * Transcription is statistical and this script does not pretend otherwise: its
 * job is to produce a *draft* `.mid` for `play-yaml-import` to turn into a
 * score, and — more importantly — to let you **measure** how good that draft
 * is before trusting it.
 *
 *   node scripts/audio-to-midi.mjs take.wav -o take.mid --bpm 120
 *   node scripts/audio-to-midi.mjs --render examples/twinkle.play.yaml --score
 *   node scripts/audio-to-midi.mjs mix.wav --score songs/x/x.play.yaml --sweep
 *
 * ── Why this shape ────────────────────────────────────────────────────────
 *
 * A compiled `.play.yaml` is exact ground truth, and `@play.yaml/node-audio`
 * renders one to audio. So the accuracy of any transcriber can be measured
 * in-tree, on our own material, with nothing copyrighted involved:
 *
 *     score → render → transcribe → compare against the score's own notes
 *
 * `--render` does exactly that. What it measures on synthetic renders is an
 * optimistic ceiling (dry, one instrument, no room), but it makes regressions
 * visible and gives the thresholds somewhere to be fitted.
 *
 * ── What it found ─────────────────────────────────────────────────────────
 *
 * Three post-processing steps matter more than the model choice, and all three
 * are implemented here:
 *
 *   1. **Thresholds.** Basic Pitch's defaults are tuned for pop stems. On
 *      dense solo piano (BWV 846), moving the onset threshold 0.5 → 0.85 took
 *      F1 from 58 to 99.7. `--sweep` fits them: note decoding is cheap
 *      post-processing over one cached CNN pass, so a whole grid costs one
 *      transcription.
 *   2. **Harmonic partials.** The characteristic error is a phantom note at
 *      +12/+19/+24 semitones above a simultaneous louder one. Dropping those
 *      was worth ~13 F1 points on BWV 846 at default thresholds.
 *   3. **Latency.** Onsets come out systematically late (measured +56 ms on a
 *      sax line); subtracting the median offset took precision to 100%.
 *
 * ── Requirements ──────────────────────────────────────────────────────────
 *
 *   ffmpeg on PATH, and the transcription model:
 *     npm i -D @spotify/basic-pitch @tensorflow/tfjs
 *
 * It is a devDependency of nothing on purpose — the model pulls in TensorFlow,
 * and only this script needs it.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { compileDoc, encodeMidi, parseYaml } from '../packages/core/src/index.ts';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Basic Pitch's fixed input rate. */
const MODEL_RATE = 22050;
/** Partial intervals a phantom note sits at above its real fundamental. */
const PARTIALS = new Set([12, 19, 24, 28, 31]);

// ───────────────────────────────── input ─────────────────────────────────

/** Any audio file → mono Float32Array at the model's rate, via ffmpeg. */
export function loadAudio(file) {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(MODEL_RATE), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

/** Render a score to mono audio at the model's rate — the self-test input. */
export async function renderScore(scorePath) {
  const { renderSongToPcm } = await import('../packages/node-audio/src/index.ts');
  const song = compileDoc(parseYaml(fs.readFileSync(scorePath, 'utf8')));
  const { pcm, sampleRate } = await renderSongToPcm(song);

  const frames = pcm.length / 2;
  const mono = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    mono[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2;
    peak = Math.max(peak, Math.abs(mono[i]));
  }
  // Normalize: summed tracks routinely pass 1.0, and the model hears clipping
  // as noise.
  if (peak > 0) for (let i = 0; i < frames; i++) mono[i] *= 0.708 / peak;

  // Resample to the model rate by linear interpolation — good enough for a
  // 22 kHz mono feature front end, and keeps ffmpeg out of the loop.
  const ratio = MODEL_RATE / sampleRate;
  const out = new Float32Array(Math.floor(frames * ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const frac = src - i0;
    out[i] = mono[i0] * (1 - frac) + (mono[i0 + 1] ?? mono[i0]) * frac;
  }
  return { audio: out, song };
}

// ────────────────────────────── transcription ─────────────────────────────

/**
 * Run the model once and hand back its raw frame/onset/contour matrices.
 *
 * They are kept rather than decoded immediately because note decoding is
 * cheap: `--sweep` tries dozens of threshold combinations against this one
 * expensive pass.
 */
export async function runModel(audio) {
  let basicPitch;
  try {
    basicPitch = require('@spotify/basic-pitch');
  } catch {
    throw new Error(
      'The transcription model is not installed. Run:\n' +
      '  npm i -D @spotify/basic-pitch',
    );
  }

  // tfjs's browser build can only fetch a model over HTTP, and pulling in
  // tfjs-node just for a file:// loader means a native build. A throwaway
  // server over the package's own model directory is cheaper.
  const modelDir = path.join(ROOT, 'node_modules/@spotify/basic-pitch/model');
  const server = http.createServer((req, res) => {
    try {
      res.end(fs.readFileSync(path.join(modelDir, path.basename(req.url))));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const model = new basicPitch.BasicPitch(`http://127.0.0.1:${server.address().port}/model.json`);
    const frames = [];
    const onsets = [];
    const contours = [];
    await model.evaluateModel(
      audio,
      (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
      () => {},
    );
    return { frames, onsets, contours, basicPitch };
  } finally {
    server.close();
  }
}

/** Decode the model output into notes at one threshold setting. */
export function decodeNotes(raw, { onset = 0.7, frame = 0.5, minLength = 11 } = {}) {
  const { basicPitch, frames, onsets, contours } = raw;
  return basicPitch
    .noteFramesToTime(
      basicPitch.addPitchBendsToNoteEvents(
        contours,
        basicPitch.outputToNotesPoly(frames, onsets, onset, frame, minLength),
      ),
    )
    .map((n) => ({
      t: n.startTimeSeconds,
      dur: n.durationSeconds,
      midi: n.pitchMidi,
      amp: n.amplitude,
    }))
    .sort((a, b) => a.t - b.t || a.midi - b.midi);
}

/**
 * Drop notes that look like harmonic partials of a simultaneous louder one.
 *
 * A piano C4 makes the model see C5 and G5 as well; they start within a frame
 * of the fundamental and are quieter, which is the whole test.
 */
export function dropPartials(notes, { window = 0.06, ratio = 0.95 } = {}) {
  return notes.filter((n) => !notes.some((m) => (
    m !== n
    && Math.abs(m.t - n.t) <= window
    && PARTIALS.has(n.midi - m.midi)
    && n.amp < m.amp * ratio
  )));
}

/** Shift every onset back by `seconds` (see `estimateLatency`). */
export function correctLatency(notes, seconds) {
  return notes.map((n) => ({ ...n, t: Math.max(0, n.t - seconds) }));
}

/**
 * The model's systematic onset lateness, as the median distance from each
 * detection to the nearest beat of a `bpm` grid. Only meaningful when the
 * material really is on a grid, so it is opt-in.
 */
export function estimateLatency(notes, bpm, division = 4) {
  if (!notes.length || !bpm) return 0;
  const step = 60 / bpm / division;
  const offsets = notes.map((n) => {
    const rel = n.t / step;
    return (rel - Math.round(rel)) * step;
  }).sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

// ─────────────────────────────── scoring ──────────────────────────────────

/** Ground truth from a compiled score: onset seconds + MIDI number. */
export function truthFromSong(song, track) {
  const spb = 60 / song.bpm;
  return song.tracks
    .filter((t) => !track || t.name === track)
    .flatMap((t) => t.timeline.filter((e) => e.midi != null)
      .map((e) => ({ t: e.time * spb, midi: e.midi })))
    .sort((a, b) => a.t - b.t);
}

/** Precision/recall against ground truth, matching by pitch within `tol`. */
export function score(truth, got, tol = 0.12) {
  const used = new Set();
  let matched = 0;
  const offsets = [];
  for (const want of truth) {
    let best = -1;
    let bestD = Infinity;
    got.forEach((g, i) => {
      if (used.has(i) || g.midi !== want.midi) return;
      const d = Math.abs(g.t - want.t);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD <= tol) {
      used.add(best);
      matched++;
      offsets.push(got[best].t - want.t);
    }
  }
  const p = matched / (got.length || 1);
  const r = matched / (truth.length || 1);
  offsets.sort((a, b) => a - b);
  return {
    truth: truth.length,
    detected: got.length,
    matched,
    precision: p,
    recall: r,
    f1: p + r ? (2 * p * r) / (p + r) : 0,
    medianOffset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0,
  };
}

// ──────────────────────────────── output ──────────────────────────────────

/** Notes (seconds) → a `.mid` at `bpm`, ready for `play-yaml-import`. */
export function notesToMidi(notes, bpm) {
  const bps = bpm / 60;
  return encodeMidi({
    bpm,
    measureBeats: 4,
    lengthBeats: notes.reduce((m, n) => Math.max(m, (n.t + n.dur) * bps), 0),
    tempoMap: [],
    warnings: [],
    tracks: [{
      name: 'transcription',
      channel: 1,
      controls: [],
      timeline: notes.map((n) => ({
        time: n.t * bps,
        duration: Math.max(0.01, n.dur * bps),
        pitch: '',
        midi: n.midi,
        velocity: Math.max(1, Math.min(127, Math.round(n.amp * 127))),
      })),
    }],
  }, { bpm, tpqn: 480 });
}

// ───────────────────────────────── main ───────────────────────────────────

const HELP = `audio → MIDI, and how much to trust it

Usage:
  node scripts/audio-to-midi.mjs <audio> [-o out.mid] [options]
  node scripts/audio-to-midi.mjs --render <score.play.yaml> [options]

Input:
  <audio>              any file ffmpeg can read
  --render <score>     render a play.yaml score and transcribe that instead —
                       the self-test path, with exact ground truth for free

Options:
  -o, --output <file>  write .mid (or .json for raw notes)
  --bpm <n>            tempo for the .mid and for --latency auto (default 120)
  --onset <0..1>       onset threshold (default 0.7; the library default is 0.5)
  --frame <0..1>       frame threshold (default 0.5)
  --min-length <n>     shortest note in frames (default 11)
  --keep-partials      do not drop suspected harmonic partials
  --latency <s|auto>   subtract a fixed onset latency, or fit one to the grid
  --score [<file>]     score against a play.yaml's own notes (defaults to the
                       --render score)
  --sweep              try a grid of thresholds and print an F1 table
  --track <name>       when scoring, compare against just this track of the
                       score — what you want when the audio is one stem
  --seconds <n>        only transcribe the first n seconds. A sweep decodes the
                       model output 72 times and decoding is linear in length,
                       so fit thresholds on 30s, then run the piece once
  -h, --help           this help`;

function parseArgs(argv) {
  const args = {
    onset: 0.7, frame: 0.5, minLength: 11, bpm: 120,
    partials: true, sweep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-o': case '--output': args.output = next(); break;
      case '--render': args.render = next(); break;
      case '--bpm': args.bpm = Number(next()); args.bpmGiven = true; break;
      case '--onset': args.onset = Number(next()); break;
      case '--frame': args.frame = Number(next()); break;
      case '--min-length': args.minLength = Number(next()); break;
      case '--keep-partials': args.partials = false; break;
      case '--latency': args.latency = next(); break;
      case '--score':
        args.score = argv[i + 1] && !argv[i + 1].startsWith('-') ? next() : true;
        break;
      case '--sweep': args.sweep = true; break;
      case '--seconds': args.seconds = Number(next()); break;
      case '--track': args.track = next(); break;
      case '-h': case '--help': args.help = true; break;
      default:
        if (!args.input && !a.startsWith('-')) args.input = a;
        else console.error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.input && !args.render)) {
    console.log(HELP);
    process.exit(args.input || args.render ? 0 : 1);
  }

  let audio;
  let song = null;
  if (args.render) {
    const rendered = await renderScore(path.resolve(process.cwd(), args.render));
    audio = rendered.audio;
    song = rendered.song;
    if (!args.bpmGiven && song.bpm) args.bpm = song.bpm;
  } else {
    audio = loadAudio(path.resolve(process.cwd(), args.input));
  }
  if (args.seconds > 0) audio = audio.subarray(0, Math.floor(args.seconds * MODEL_RATE));
  console.error(`# audio: ${(audio.length / MODEL_RATE).toFixed(2)}s`);

  const started = Date.now();
  const raw = await runModel(audio);
  console.error(`# model: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  let truth = null;
  if (args.score) {
    const scorePath = args.score === true ? args.render : args.score;
    if (!scorePath) throw new Error('--score needs a file when --render is not used');
    const target = args.score === true && song
      ? song
      : compileDoc(parseYaml(fs.readFileSync(path.resolve(process.cwd(), scorePath), 'utf8')));
    truth = truthFromSong(target, args.track);
    // Scoring a 30s excerpt against the whole score would report the rest of
    // the piece as missed.
    if (args.seconds > 0) truth = truth.filter((n) => n.t < args.seconds);
  }

  const post = (notes) => {
    let out = args.partials ? dropPartials(notes) : notes;
    if (args.latency != null) {
      const seconds = args.latency === 'auto'
        ? estimateLatency(out, args.bpm)
        : Number(args.latency);
      out = correctLatency(out, seconds);
      console.error(`# latency: subtracted ${(seconds * 1000).toFixed(1)}ms`);
    }
    return out;
  };

  if (args.sweep) {
    if (!truth) throw new Error('--sweep needs --score to fit against');
    console.error('# onset frame minLen partials |  det  match     P%     R%    F1%');
    let best = null;
    for (const onset of [0.3, 0.5, 0.7, 0.85]) {
      for (const frame of [0.3, 0.5, 0.7]) {
        for (const minLength of [5, 11, 17]) {
          const decoded = decodeNotes(raw, { onset, frame, minLength });
          for (const partials of [false, true]) {
            const notes = partials ? dropPartials(decoded) : decoded;
            const s = score(truth, notes);
            // On a tie, keep the partial filter on: it costs nothing here and
            // is what generalizes off this material.
            const better = !best || s.f1 > best.s.f1
              || (s.f1 === best.s.f1 && partials && !best.partials);
            if (better) best = { s, onset, frame, minLength, partials };
            console.error(
              `#  ${onset.toFixed(2)}  ${frame.toFixed(2)}   ${String(minLength).padStart(2)}` +
              `     ${partials ? 'yes' : 'no '}    | ${String(s.detected).padStart(4)}` +
              ` ${String(s.matched).padStart(6)} ${(100 * s.precision).toFixed(1).padStart(6)}` +
              ` ${(100 * s.recall).toFixed(1).padStart(6)} ${(100 * s.f1).toFixed(1).padStart(6)}`,
            );
          }
        }
      }
    }
    console.error(
      `# best: --onset ${best.onset} --frame ${best.frame} --min-length ${best.minLength}` +
      `${best.partials ? '' : ' --keep-partials'} → F1 ${(100 * best.s.f1).toFixed(1)}`,
    );
    return;
  }

  const notes = post(decodeNotes(raw, args));
  console.error(`# notes: ${notes.length}`);

  if (truth) {
    const s = score(truth, notes);
    console.error(
      `# score: truth ${s.truth} detected ${s.detected} matched ${s.matched} | ` +
      `P ${(100 * s.precision).toFixed(1)}% R ${(100 * s.recall).toFixed(1)}% ` +
      `F1 ${(100 * s.f1).toFixed(1)}% | median onset offset ${(1000 * s.medianOffset).toFixed(1)}ms`,
    );
  }

  if (args.output) {
    const out = path.resolve(process.cwd(), args.output);
    if (/\.json$/i.test(out)) fs.writeFileSync(out, JSON.stringify(notes, null, 1));
    else fs.writeFileSync(out, notesToMidi(notes, args.bpm));
    console.error(`# wrote ${path.relative(process.cwd(), out)}`);
  } else if (!truth) {
    process.stdout.write(JSON.stringify(notes, null, 1) + '\n');
  }
}

// Only run as a program, so the functions above stay importable by other
// scripts (a scorer that reuses a saved transcription, for instance).
if (process.argv[1] && /audio-to-midi\.mjs$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(String(err.message || err));
    process.exit(1);
  });
}
