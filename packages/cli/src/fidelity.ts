/**
 * play-yaml-fidelity — compile a .play.yaml score to MIDI, compare it against a
 * reference .mid ("the original song we found on the internet"), and print a
 * 0..100 fidelity score with the weakest passages flagged.
 *
 *   play-yaml-fidelity <score.play.yaml> <original.mid> [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import { encodeMidi, compareMidi, pitchClassName } from '@play.yaml/core';
import { loadScore, parseFlags, run, usage } from './shared';

const HELP = `play.yaml fidelity — score a score against a reference MIDI

Usage:
  play-yaml-fidelity <score.play.yaml> <original.mid> [options]

Options:
  -b, --bpm <n>            override the score's tempo before rendering
  -w, --window <beats>     per-passage window size (default 4)
      --transpose-range n  semitones up/down to search for the key (default 7)
      --worst <n>          how many weak passages to list (default 12)
  -o, --out <file.mid>     also write the generated MIDI here
      --json               print the full report as JSON
  -h, --help               this help

Fidelity blends five sub-scores (harmony, register, rhythm, coverage, tempo).
When the original carries no real tempo (one tempo event, or none: a
transcription's 120 default) its tempo is estimated by aligning the two files.
It auto-detects a global key-transposition and time-offset first, so a cover in
another key or with a pickup bar is aligned rather than penalized.`;

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function bar(v: number): string {
  const n = Math.max(0, Math.min(20, Math.round(v * 20)));
  return `${'█'.repeat(n)}${'░'.repeat(20 - n)} ${(v * 100).toFixed(0)}%`;
}

run(() => {
  const { flags, positional } = parseFlags(process.argv.slice(2), {
    bpm: { names: ['--bpm', '-b'], value: true },
    window: { names: ['--window', '-w'], value: true },
    transposeRange: { names: ['--transpose-range'], value: true },
    worst: { names: ['--worst'], value: true },
    out: { names: ['--out', '-o'], value: true },
    json: { names: ['--json'] },
    help: { names: ['--help', '-h'] },
  });
  const [score, original] = positional;
  if (flags.help || !score || !original) usage(HELP, flags.help);

  const compiled = loadScore(score);
  const bpm = Number(flags.bpm) || compiled.bpm;
  const genBytes = encodeMidi(compiled, { bpm });
  if (flags.out) fs.writeFileSync(path.resolve(process.cwd(), flags.out as string), genBytes);
  const origBytes = new Uint8Array(fs.readFileSync(path.resolve(process.cwd(), original)));

  const r = compareMidi(genBytes, origBytes, {
    windowBeats: flags.window ? Number(flags.window) : 4,
    transposeRange: flags.transposeRange ? Number(flags.transposeRange) : 7,
    worstCount: flags.worst ? Number(flags.worst) : 12,
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }

  const title = compiled.title || path.basename(score);
  const t = r.transpose;
  const keyNote = t === 0 ? 'same key' : `${t > 0 ? '+' : ''}${t} st (${pitchClassName(t)})`;

  console.log('');
  console.log(`  play.yaml fidelity — ${title}`);
  console.log(`  score:    ${path.basename(score)}`);
  console.log(`  original: ${path.basename(original)}`);
  console.log('  ' + '─'.repeat(52));
  console.log(`  FIDELITY   ${r.score.toFixed(1)} / 100`);
  console.log('  ' + '─'.repeat(52));
  console.log(`  harmony    ${bar(r.harmony)}   pitch-class match (octave-tolerant)`);
  console.log(`  register   ${bar(r.pitch)}   exact octave match`);
  console.log(`  rhythm     ${bar(r.rhythm)}   onset alignment`);
  console.log(`  coverage   ${bar(r.coverage)}   of the original spanned`);
  if (r.tempo === null) {
    console.log(
      `  tempo      ${'░'.repeat(20)} ?     ${r.genBpm.toFixed(0)} bpm vs unknown: the file has no tempo, ` +
      'and too little of it matched to measure one (left out of the total)',
    );
  } else {
    const origTempo = r.origBpmSource === 'alignment'
      ? `~${r.origBpm.toFixed(0)} bpm, from the alignment`
      : `${r.origBpm.toFixed(0)} bpm`;
    console.log(`  tempo      ${bar(r.tempo)}   ${r.genBpm.toFixed(0)} vs ${origTempo}`);
  }
  console.log('  ' + '─'.repeat(52));
  console.log(
    `  aligned:   key ${keyNote}, offset ${r.offsetBeats >= 0 ? '+' : ''}${r.offsetBeats.toFixed(2)} beats`,
  );
  console.log(
    `  length:    generated ${r.genLengthBeats.toFixed(0)} beats, original ${r.origLengthBeats.toFixed(0)} beats`,
  );

  const weak = r.worst.filter((w) => w.harmony < 0.85);
  console.log('');
  if (weak.length === 0) {
    console.log('  weakest passages: none below 85% — the covered material tracks the original.');
  } else {
    console.log(`  weakest passages (of the ${r.worst.length} lowest windows):`);
    console.log('    time    beats        harmony   note');
    for (const w of weak) {
      const note = w.origActive ? 'differs from original' : 'no matching notes in original here';
      console.log(
        `    ${mmss(w.startSec).padStart(5)}   ${String(Math.round(w.startBeat)).padStart(4)}–${String(
          Math.round(w.endBeat),
        ).padEnd(4)}   ${(w.harmony * 100).toFixed(0).padStart(3)}%      ${note}`,
      );
    }
  }
  console.log('');
});
