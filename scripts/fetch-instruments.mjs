#!/usr/bin/env node
/**
 * fetch-instruments.mjs — build the melodic sample sets (cello, flute, bass,
 * piano) under packages/web/public/samples/ from VSCO 2 CE (CC0).
 *
 *   node scripts/fetch-instruments.mjs [cello flute bass piano] [--force]
 *
 * Downloads each curated WAV, VERIFIES its pitch by autocorrelation
 * (scripts/detect-pitch.py) — VSCO filenames are routinely an octave low, the
 * violin set shipped earlier needed +12 — applies the measured per-set octave
 * offset, transcodes to mono 64 kbps AAC, and writes the melodic manifest the
 * web sampler reads.
 */

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SCRIPTS, '..');
const SAMPLES = path.join(ROOT, 'packages/web/public/samples');
const RAW = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master';
const FORCE = process.argv.includes('--force');

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const nameToMidi = (name) => {
  const m = /^([a-g])(#|b)?(-?\d)$/i.exec(name);
  const pc = PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (parseInt(m[3], 10) + 1) * 12 + pc;
};

// ---------------------------------------------------------------------------
// The curated sets. Each articulation lists [pitchName, sourceFile, layer?].
// ---------------------------------------------------------------------------

const CELLO = 'Strings/Cello Section';
const CELLO_PITCHES = ['C1', 'E1', 'G1', 'B1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4'];
const BASS = 'Strings/Solo Contrabass';
const FLUTE = 'Woodwinds/Flute';
const PIANO = 'Keys/Upright Piano';

/** Contrabass pizz pitches → the better (v3 = louder) take where it exists. */
const BASS_PIZZ = {
  E0: 'v3', 'F#0': 'v3', G0: 'v3', 'A#0': 'v3', C1: 'v3', D1: 'v1', E1: 'v3',
  'F#1': 'v1', 'G#1': 'v1', A1: 'v1', 'C#2': 'v1', E2: 'v1', 'G#2': 'v1', B2: 'v1',
};
/** SusVib has no E0 recording; every other pizz pitch has v1+v3 sustains. */
const BASS_SUS = Object.keys(BASS_PIZZ).filter((p) => p !== 'E0');

// Level trims: the VSCO recordings are not normalized across instruments
// (cello peaks near -4 dBFS, flute near -16, contrabass pizz near -19).
// `gain` rebalances at playback without touching intra-instrument layers.
const INSTRUMENTS = {
  cello: {
    dir: 'cello',
    loop: true,
    articulations: {
      sustain: CELLO_PITCHES.flatMap((p) => [
        [p, `${CELLO}/susvib/susvib_${p}_v1_1.wav`, 'p'],
        [p, `${CELLO}/susvib/susvib_${p}_v3_1.wav`, 'f'],
      ]),
      pizz: CELLO_PITCHES.map((p) => [p, `${CELLO}/pizzT/pizzT_${p}_v2_RR1.wav`]),
      spiccato: CELLO_PITCHES.map((p) => [p, `${CELLO}/spic/spic_${p}_v2_RR1.wav`]),
      tremolo: ['A2', 'B2', 'B3', 'C1', 'C3', 'D2', 'D4', 'E1', 'E3', 'F2', 'F4', 'G1', 'G3']
        .map((p) => [p, `${CELLO}/trem/trem_${p}_v2_1.wav`]),
    },
  },
  flute: {
    dir: 'flute',
    loop: true,
    gain: 5.0,
    // Swing eighths at jazz tempos are ~0.11 s — keep them on the sustains;
    // only true turn/grace figures drop to the staccato recordings.
    spiccatoMaxSec: 0.1,
    articulations: {
      sustain: ['C3', 'E3', 'A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6']
        .map((p) => [p, `${FLUTE}/susvib/LDFlute_susvib_${p}_v1_1.wav`]),
      spiccato: ['A3', 'A4', 'A5', 'C4', 'C5', 'E4', 'E5']
        .map((p) => [p, `${FLUTE}/stac/LDFlute_stac_${p}_v2_rr1.wav`])
        .concat([['C6', `${FLUTE}/stac/LDFlute_stac_C6_v2_rr1.wav`]]),
    },
  },
  bass: {
    dir: 'bass',
    loop: true,
    gain: 3.2,
    defaultMode: 'pizz',
    articulations: {
      sustain: BASS_SUS.flatMap((p) => [
        [p, `${BASS}/SusVib/BKCtbss_SusVib_${p}_v1_rr1.wav`, 'p'],
        [p, `${BASS}/SusVib/BKCtbss_SusVib_${p}_v3_rr1.wav`, 'f'],
      ]),
      pizz: Object.entries(BASS_PIZZ).map(([p, v]) => [p, `${BASS}/Pizz/BKCtbss_Pizz_${p}_${v}_rr1.wav`]),
    },
  },
  piano: {
    dir: 'piano',
    loop: false, // never loop a struck string's decay
    gain: 0.8,
    trim: 8,
    // MappingChart: index N ↔ MIDI key 21 + 2N; even indices exist (4-semitone grid).
    articulations: {
      sustain: Array.from({ length: 23 }, (_, i) => {
        const idx = String(i * 2).padStart(3, '0');
        const midi = 21 + 4 * i;
        return [
          [midi, `${PIANO}/Player_dyn1_rr1_${idx}.wav`, 'p'],
          [midi, `${PIANO}/Player_dyn3_rr1_${idx}.wav`, 'f'],
        ];
      }).flat(),
    },
  },
};

// ---------------------------------------------------------------------------

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function download(sourcePath, to, attempt = 1) {
  try {
    const response = await fetch(`${RAW}/${encodePath(sourcePath)}`);
    if (!response.ok) throw new Error(`${response.status} for ${sourcePath}`);
    fs.writeFileSync(to, Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    if (attempt >= 4 || String(err).includes('404')) throw err;
    console.log(`  retry ${attempt} for ${path.basename(sourcePath)} (${err.cause?.code ?? err.message})`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    await download(sourcePath, to, attempt + 1);
  }
}

function detectMidi(wavPath) {
  const hz = Number(execSync(
    `ffmpeg -hide_banner -loglevel error -i "${wavPath}" -ac 1 -ar 22050 -f f32le - | python3 "${SCRIPTS}/detect-pitch.py"`,
  ).toString().trim());
  return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
}

function transcode(wav, out, trim) {
  const trimArgs = trim ? ['-t', String(trim), '-af', `afade=t=out:st=${trim - 0.5}:d=0.5`] : [];
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...trimArgs,
    '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out,
  ]);
}

const chosen = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const names = chosen.length ? chosen : Object.keys(INSTRUMENTS);

for (const name of names) {
  const inst = INSTRUMENTS[name];
  if (!inst) {
    console.error(`Unknown instrument "${name}" — have: ${Object.keys(INSTRUMENTS).join(', ')}`);
    process.exit(1);
  }
  const outDir = path.join(SAMPLES, inst.dir);
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { loop: inst.loop };
  if (inst.gain) manifest.gain = inst.gain;
  if (inst.spiccatoMaxSec) manifest.spiccatoMaxSec = inst.spiccatoMaxSec;
  if (inst.defaultMode) manifest.defaultMode = inst.defaultMode;
  /** Plausible offsets measured so far for this instrument, in order. */
  const instrumentOffsets = [];
  // Corrections measured on a previous run, keyed by url — files we skip
  // keep their verified midi instead of reverting to the claimed one.
  const previous = new Map();
  const manifestPath = path.join(outDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    for (const entries of Object.values(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))) {
      if (Array.isArray(entries)) for (const e of entries) previous.set(e.url, e.midi);
    }
  }

  console.log(`\n== ${name} ==`);
  for (const [articulation, files] of Object.entries(inst.articulations)) {
    const entries = [];
    const offsets = [];
    for (const [pitch, sourcePath, layer] of files) {
      const claimed = typeof pitch === 'number' ? pitch : nameToMidi(pitch);
      // '#' in a filename becomes a URL fragment in the browser — sharp
      // pitches (F#0) must be sanitized or their fetches silently truncate.
      const base = path.basename(sourcePath, '.wav').replace(/#/g, 's');
      const outFile = `${base}.m4a`;
      const outPath = path.join(outDir, outFile);
      const wav = path.join(outDir, `.${base}.wav`);
      let midi = claimed;
      let corrected = false;
      if (FORCE || !fs.existsSync(outPath)) {
        await download(sourcePath, wav);
        // Verify what the file actually sounds vs what its name claims.
        const detected = detectMidi(wav);
        if (detected != null) offsets.push(Math.round((detected - claimed) / 12) * 12);
        transcode(wav, outPath, inst.trim);
        fs.unlinkSync(wav);
        process.stdout.write(`  ${outFile}\n`);
      } else if (previous.has(outFile)) {
        midi = previous.get(outFile); // keep the correction measured last run
        corrected = true;
      }
      entries.push({ midi, ...(layer ? { layer } : {}), corrected, url: outFile });
    }
    // The measured per-articulation octave offset (median vote) corrects the
    // whole set — VSCO names are consistently off within one folder. Votes
    // beyond ±2 octaves are detector failures (overtone lock on plucked
    // decays), not plausible naming errors — discard them; with no plausible
    // votes at all, trust the offset the instrument's other articulations
    // measured (the naming convention is per-library, not per-folder).
    const votes = offsets.filter((o) => Math.abs(o) <= 24);
    if (votes.length) {
      votes.sort((a, b) => a - b);
      const offset = votes[Math.floor(votes.length / 2)];
      instrumentOffsets.push(offset);
      if (offset !== 0) {
        console.log(`  ${articulation}: filenames are ${offset > 0 ? '+' : ''}${offset} semitones off — corrected`);
        for (const e of entries) if (!e.corrected) e.midi += offset;
      } else {
        console.log(`  ${articulation}: filenames verified in tune`);
      }
    } else if (offsets.length) {
      const fallback = instrumentOffsets[instrumentOffsets.length - 1] ?? 0;
      console.log(`  ${articulation}: pitch detection inconclusive — using the instrument's ${fallback > 0 ? '+' : ''}${fallback} offset`);
      for (const e of entries) if (!e.corrected) e.midi += fallback;
    }
    manifest[articulation] = entries.map(({ corrected, ...entry }) => entry);
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  const total = fs.readdirSync(outDir).filter((f) => f.endsWith('.m4a'))
    .reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`  → ${(total / 1e6).toFixed(1)} MB`);
}
