/**
 * audio-probe.mjs — render play.yaml scores to PCM offline and measure them.
 *
 * Renders through the exact path the CLI uses (core's scheduleSong + the
 * track bus + the synth presets, on node-web-audio-api's OfflineAudioContext),
 * then reports objective measurements: level, spectral
 * centroid, note onsets, and pitch wobble.
 *
 * The point is to answer "does this DSL modifier actually change the audio?"
 * with numbers instead of listening.
 *
 *   node scripts/audio-probe.mjs                 # run the modifier suite
 *   node scripts/audio-probe.mjs <file.yaml>     # measure one score
 *   node scripts/audio-probe.mjs <file.yaml> out.wav   # ...and write a WAV
 */
import * as fs from 'fs';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseYaml, compileDoc, scheduleSong, songEndBeat, tempoSegments, beatsToSeconds }
  from '../packages/core/src/index.ts';

const SAMPLE_RATE = 44100;
const TAIL_SEC = 1.5;

/** Compile a score and render it to a mono Float32Array. */
export async function renderScore(source) {
  const song = compileDoc(parseYaml(source));
  const segments = tempoSegments(song.bpm, song.tempoMap);
  const endSec = beatsToSeconds(segments, songEndBeat(song)) + TAIL_SEC;
  const frames = Math.max(SAMPLE_RATE, Math.ceil(endSec * SAMPLE_RATE));

  const ctx = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  scheduleSong(ctx, ctx.destination, song, { originTime: 0 });
  const buffer = await ctx.startRendering();
  return { song, pcm: buffer.getChannelData(0), sampleRate: buffer.sampleRate };
}

// ───────────────────────────── measurements ─────────────────────────────

export function rms(pcm, from = 0, to = pcm.length) {
  let sum = 0;
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(pcm.length, Math.ceil(to));
  for (let i = lo; i < hi; i++) sum += pcm[i] * pcm[i];
  return hi > lo ? Math.sqrt(sum / (hi - lo)) : 0;
}

export function peak(pcm) {
  let max = 0;
  for (let i = 0; i < pcm.length; i++) max = Math.max(max, Math.abs(pcm[i]));
  return max;
}

const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -Infinity);

/** Naive DFT magnitude spectrum of a Hann-windowed frame (size must be small). */
function spectrum(pcm, start, size) {
  const n = Math.min(size, pcm.length - start);
  if (n <= 0) return new Float64Array(0);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = pcm[start + i] * w;
  }
  // Iterative radix-2 FFT; n is forced to a power of two by the caller.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/**
 * Spectral centroid in Hz — the "brightness" of the sound, averaged over the
 * whole signal. This is what a filter opening or closing moves.
 */
export function spectralCentroid(pcm, sampleRate, from = 0, to = pcm.length) {
  const SIZE = 2048;
  let weighted = 0;
  let total = 0;
  for (let start = Math.floor(from); start + SIZE < Math.min(to, pcm.length); start += SIZE) {
    const mag = spectrum(pcm, start, SIZE);
    for (let i = 1; i < mag.length; i++) {
      const hz = (i * sampleRate) / SIZE;
      weighted += hz * mag[i];
      total += mag[i];
    }
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * Fraction of spectral energy above `cutoffHz`. A lowpass is best measured by
 * what it removes, not by the centroid — a dark source can drop a quarter of
 * its top end and barely move its centroid.
 */
export function highFreqRatio(pcm, sampleRate, cutoffHz) {
  const SIZE = 2048;
  let above = 0;
  let total = 0;
  for (let start = 0; start + SIZE < pcm.length; start += SIZE) {
    const mag = spectrum(pcm, start, SIZE);
    for (let i = 1; i < mag.length; i++) {
      const hz = (i * sampleRate) / SIZE;
      total += mag[i];
      if (hz >= cutoffHz) above += mag[i];
    }
  }
  return total > 0 ? above / total : 0;
}

/**
 * Onset times in seconds. Notes overlap and ring, so a plain level threshold
 * misses everything after the first: this tracks the *rise* in log energy and
 * keeps local maxima of it, which is what an attack actually looks like.
 */
export function onsets(pcm, sampleRate, opts = {}) {
  const { minGapSec = 0.12, sensitivity = 3, riseRatio = 1.08 } = opts;
  const HOP = Math.round(sampleRate * 0.01);
  const raw = [];
  for (let i = 0; i + HOP < pcm.length; i += HOP) raw.push(rms(pcm, i, i + HOP));
  if (raw.length < 5) return [];

  // Smooth first: filter ringing and the vibrato LFO put ripple on the
  // envelope that reads as dozens of spurious attacks.
  const env = raw.map((_, i) => (raw[i - 1] ?? raw[i]) * 0.25 + raw[i] * 0.5 + (raw[i + 1] ?? raw[i]) * 0.25);
  const floor = Math.max(...env) * 1e-4 || 1e-9;
  const logEnv = env.map((e) => Math.log10(Math.max(e, floor)));
  const flux = logEnv.map((v, i) => (i === 0 ? 0 : Math.max(0, v - logEnv[i - 1])));

  // Adaptive threshold: median absolute deviation, so one loud passage does
  // not set the bar for a quiet one.
  const positive = flux.filter((f) => f > 0).sort((a, b) => a - b);
  if (!positive.length) return [];
  const median = positive[Math.floor(positive.length / 2)];
  const mad =
    positive.map((f) => Math.abs(f - median)).sort((a, b) => a - b)[Math.floor(positive.length / 2)] || median;
  const threshold = median + sensitivity * mad;

  const found = [];
  const minGap = Math.round(minGapSec / (HOP / sampleRate));
  const window = Math.max(2, Math.round(0.05 / (HOP / sampleRate)));
  const mean = (from, to) => {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, from); i < Math.min(env.length, to); i++, n++) sum += env[i];
    return n ? sum / n : 0;
  };

  // A detuned preset beats against itself, which ripples the envelope at a
  // few Hz. A real attack leaves the level *higher* afterwards; ripple does
  // not, so require a net rise across the onset.
  const isAttack = (i) => mean(i + 1, i + 1 + window) > mean(i - window, i) * riseRatio;

  if (env[0] > Math.max(...env) * 0.2) found.push(0); // starts already sounding
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < threshold) continue;
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue; // local max only
    if (found.length && i - found[found.length - 1] < minGap) continue;
    if (!isAttack(i)) continue;
    found.push(i);
  }
  return found.map((i) => (i * HOP) / sampleRate);
}

/** Seconds the signal stays above a fraction of its own peak. */
export function soundingSeconds(pcm, sampleRate, fraction = 0.05) {
  const HOP = Math.round(sampleRate * 0.005);
  let maxEnv = 0;
  const env = [];
  for (let i = 0; i + HOP < pcm.length; i += HOP) {
    const e = rms(pcm, i, i + HOP);
    env.push(e);
    maxEnv = Math.max(maxEnv, e);
  }
  const above = env.filter((e) => e > maxEnv * fraction).length;
  return (above * HOP) / sampleRate;
}

/**
 * Track the strongest partial frame by frame and report how much it wanders.
 * Vibrato shows up as a large peak-to-peak swing in cents.
 */
export function pitchWobbleCents(pcm, sampleRate, from = 0, to = pcm.length) {
  const SIZE = 4096;
  const HOP = 1024;
  const track = [];
  for (let start = Math.floor(from); start + SIZE < Math.min(to, pcm.length); start += HOP) {
    const mag = spectrum(pcm, start, SIZE);
    let best = 1;
    for (let i = 2; i < mag.length; i++) if (mag[i] > mag[best]) best = i;
    if (mag[best] < 1e-4) continue;
    // Parabolic interpolation for sub-bin resolution — vibrato is subtle.
    const a = mag[best - 1];
    const b = mag[best];
    const c = mag[best + 1] ?? 0;
    const shift = (0.5 * (a - c)) / (a - 2 * b + c || 1);
    track.push(((best + shift) * sampleRate) / SIZE);
  }
  if (track.length < 4) return { cents: 0, frames: track.length };
  const sorted = [...track].sort((x, y) => x - y);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.floor(sorted.length * 0.9)];
  return { cents: lo > 0 ? 1200 * Math.log2(hi / lo) : 0, frames: track.length };
}

/** Mono Float32Array → 16-bit PCM WAV. */
export function toWav(pcm, sampleRate) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    data.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export const summary = (pcm, sampleRate) => ({
  peak: peak(pcm),
  rmsDb: db(rms(pcm)),
  centroidHz: spectralCentroid(pcm, sampleRate),
  onsets: onsets(pcm, sampleRate).length,
  soundingSec: soundingSeconds(pcm, sampleRate),
});

// ───────────────────────────── modifier suite ─────────────────────────────

/** A score with one `set:` line, so a modifier can be measured in isolation. */
const score = (modifier, { sample = 'strings', notes = '"c4 e4 g4 c5"', tempo = 120, bars = 1 } = {}) => `tempo: ${tempo}
controls: { bow: 74, pressure: 71, vibrato: 1, sordino: 22, expression: 11 }
tracks: { main: { instrument: ${sample} } }
sections:
  a:
    main:
      play:
${modifier ? `        - set: ${modifier}\n` : ''}${Array.from({ length: bars }, () => `        - ${notes}`).join('\n')}
`;

/**
 * Each case renders two scores that differ only in one modifier and checks the
 * measurement moves the way the modifier claims it will.
 */
const CASES = [
  {
    name: 'dynamics → level',
    metric: 'rms dBFS',
    a: ['pianissimo', score('pianissimo')],
    b: ['fortissimo', score('fortissimo')],
    measure: (p, sr) => db(rms(p)),
    expect: 'b > a by ≥ 6 dB',
    ok: (a, b) => b - a >= 6,
  },
  {
    name: 'bow position → brightness',
    metric: 'centroid Hz',
    a: ['sul tasto', score('sul tasto')],
    b: ['sul ponticello', score('sul ponticello')],
    measure: (p, sr) => spectralCentroid(p, sr),
    expect: 'b > a by ≥ 20%',
    ok: (a, b) => b > a * 1.2,
  },
  {
    name: 'sordino → damped top',
    metric: '% energy > 2.2 kHz',
    a: ['senza sordino', score('senza sordino')],
    b: ['con sordino', score('con sordino')],
    measure: (p, sr) => highFreqRatio(p, sr, 2200) * 100,
    expect: 'a > b by ≥ 25%',
    ok: (a, b) => a > b * 1.25,
  },
  {
    name: 'bow pressure → level',
    metric: 'rms dBFS',
    a: ['light bow', score('light bow')],
    b: ['heavy bow', score('heavy bow')],
    measure: (p, sr) => db(rms(p)),
    expect: 'b > a by ≥ 1 dB',
    ok: (a, b) => b - a >= 1,
  },
  {
    name: 'vibrato → pitch wobble',
    metric: 'cents within 1 note',
    // One slow repeated pitch, measured *inside* the first note: across a
    // melody the interval leaps swamp the wobble entirely.
    a: ['senza vibrato', score('senza vibrato', { notes: '"c4 c4 c4 c4"', tempo: 30 })],
    b: ['molto vibrato', score('molto vibrato', { notes: '"c4 c4 c4 c4"', tempo: 30 })],
    measure: (p, sr) => pitchWobbleCents(p, sr, 0.3 * sr, 1.7 * sr).cents,
    expect: 'b > a by ≥ 10 cents',
    ok: (a, b) => b - a >= 10,
  },
  {
    name: 'articulation → note length',
    metric: 'sounding s',
    a: ['staccato', score('staccato')],
    b: ['legato', score('legato')],
    measure: (p, sr) => soundingSeconds(p, sr),
    expect: 'b > a',
    ok: (a, b) => b > a * 1.05,
  },
  {
    name: 'crescendo → rising level',
    metric: '2nd half − 1st half dB',
    a: ['steady', score('mezzoforte', { bars: 4 })],
    b: ['crescendo over 4', score('pianissimo, crescendo to fortissimo over 4', { bars: 4 })],
    measure: (p) => db(rms(p, p.length / 2, p.length)) - db(rms(p, 0, p.length / 2)),
    expect: 'b > a by ≥ 3 dB',
    ok: (a, b) => b - a >= 3,
  },
  {
    name: 'ritardando → onsets spread',
    metric: 'last gap / first gap',
    a: ['steady tempo', score('', { bars: 4, notes: '"c4 c4 c4 c4"', sample: 'piano' })],
    b: ['rit. over 4', score('ritardando to 50 over 4', { bars: 4, notes: '"c4 c4 c4 c4"', sample: 'piano' })],
    measure: (p, sr) => {
      const o = onsets(p, sr);
      if (o.length < 4) return NaN;
      const gaps = o.slice(1).map((t, i) => t - o[i]);
      return gaps[gaps.length - 1] / gaps[0];
    },
    expect: 'b > a by ≥ 20%',
    ok: (a, b) => b > a * 1.2,
  },
];

async function runSuite() {
  console.log('Rendering through core scheduleSong + track bus (the CLI path)\n');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('modifier', 28) + pad('metric', 22) + pad('A', 12) + pad('B', 12) + 'verdict');
  console.log('─'.repeat(90));

  let failures = 0;
  for (const c of CASES) {
    const [aLabel, aScore] = c.a;
    const [bLabel, bScore] = c.b;
    const ra = await renderScore(aScore);
    const rb = await renderScore(bScore);
    const va = c.measure(ra.pcm, ra.sampleRate);
    const vb = c.measure(rb.pcm, rb.sampleRate);
    const pass = Number.isFinite(va) && Number.isFinite(vb) && c.ok(va, vb);
    if (!pass) failures++;
    const verdict = pass ? '✓ audible' : `✗ NOT APPLIED (${c.expect})`;
    console.log(
      pad(c.name, 28) + pad(c.metric, 22) +
      pad(Number.isFinite(va) ? va.toFixed(1) : 'n/a', 12) +
      pad(Number.isFinite(vb) ? vb.toFixed(1) : 'n/a', 12) + verdict,
    );
    console.log(pad('', 28) + `A=${aLabel}  B=${bLabel}`);
  }
  console.log('─'.repeat(90));
  console.log(
    `${CASES.length - failures}/${CASES.length} modifiers audible here` +
    (failures ? `, ${failures} NOT APPLIED` : ''),
  );
  return failures;
}

// ─────────────────────────────── CLI entry ───────────────────────────────

if (process.argv[1]?.endsWith('audio-probe.mjs')) {
  const [, , file, out] = process.argv;
  if (!file) {
    const failures = await runSuite();
    process.exit(failures ? 1 : 0);
  }
  const { song, pcm, sampleRate } = await renderScore(fs.readFileSync(file, 'utf8'));
  const s = summary(pcm, sampleRate);
  console.log(`${song.title || file} — ${song.tracks.length} track(s), ${(pcm.length / sampleRate).toFixed(2)}s`);
  console.log(`  peak ${s.peak.toFixed(4)}  rms ${s.rmsDb.toFixed(1)} dBFS`);
  console.log(`  spectral centroid ${s.centroidHz.toFixed(0)} Hz`);
  console.log(`  onsets ${s.onsets}  sounding ${s.soundingSec.toFixed(2)}s`);
  if (out) {
    fs.writeFileSync(out, toWav(pcm, sampleRate));
    console.log(`  wrote ${out}`);
  }
  process.exit(0);
}
