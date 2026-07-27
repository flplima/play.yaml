'use strict';

/**
 * play-yaml-fidelity — compile a .play.yaml score to MIDI, compare it against a
 * reference .mid ("the original song we found on the internet"), and print a
 * 0..100 fidelity score with the weakest passages flagged.
 *
 *   play-yaml-fidelity <score.play.yaml> <original.mid> [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileDoc, encodeMidi, parseYaml, compareMidi, CompareOptions } from '@play.yaml/core';

interface CliArgs {
  score?: string;
  original?: string;
  bpm?: number;
  window: number;
  transposeRange: number;
  worst: number;
  out?: string;
  json: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { window: 4, transposeRange: 7, worst: 12, json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--bpm': case '-b': args.bpm = Number(next()); break;
      case '--window': case '-w': args.window = Number(next()); break;
      case '--transpose-range': args.transposeRange = Number(next()); break;
      case '--worst': args.worst = Number(next()); break;
      case '--out': case '-o': args.out = next(); break;
      case '--json': args.json = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (!a.startsWith('-')) positional.push(a);
        else console.error(`Unknown argument: ${a}`);
    }
  }
  args.score = positional[0];
  args.original = positional[1];
  return args;
}

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
It auto-detects a global key-transposition and time-offset first, so a cover in
another key or with a pickup bar is aligned rather than penalized.`;

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** a 0..1 value as a 20-cell bar plus a percentage. */
function bar(v: number): string {
  const n = Math.max(0, Math.min(20, Math.round(v * 20)));
  return `${'█'.repeat(n)}${'░'.repeat(20 - n)} ${(v * 100).toFixed(0)}%`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.score || !args.original) {
    console.log(HELP);
    process.exit(args.score && args.original ? 0 : 1);
  }

  const scorePath = path.resolve(process.cwd(), args.score);
  const origPath = path.resolve(process.cwd(), args.original);
  const doc = parseYaml(fs.readFileSync(scorePath, 'utf8'));
  if (!doc || typeof doc !== 'object' || (doc.play == null && doc.tracks == null)) {
    throw new Error(`Score "${args.score}" must define a "play:" or "tracks:" key.`);
  }
  const compiled = compileDoc(doc);
  const bpm = args.bpm || compiled.bpm;
  const genBytes = encodeMidi(compiled, { bpm });
  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), genBytes);
  }
  const origBytes = new Uint8Array(fs.readFileSync(origPath));

  const opts: CompareOptions = {
    windowBeats: args.window,
    transposeRange: args.transposeRange,
    worstCount: args.worst,
  };
  const r = compareMidi(genBytes, origBytes, opts);

  if (args.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }

  const title = compiled.title || path.basename(args.score);
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const t = r.transpose;
  const keyNote = t === 0 ? 'same key' : `${t > 0 ? '+' : ''}${t} st (${NOTE_NAMES[((t % 12) + 12) % 12]})`;

  console.log('');
  console.log(`  play.yaml fidelity — ${title}`);
  console.log(`  score:    ${path.basename(args.score)}`);
  console.log(`  original: ${path.basename(args.original)}`);
  console.log('  ' + '─'.repeat(52));
  console.log(`  FIDELITY   ${r.score.toFixed(1)} / 100`);
  console.log('  ' + '─'.repeat(52));
  console.log(`  harmony    ${bar(r.harmony)}   pitch-class match (octave-tolerant)`);
  console.log(`  register   ${bar(r.pitch)}   exact octave match`);
  console.log(`  rhythm     ${bar(r.rhythm)}   onset alignment`);
  console.log(`  coverage   ${bar(r.coverage)}   of the original spanned`);
  console.log(`  tempo      ${bar(r.tempo)}   ${r.genBpm.toFixed(0)} vs ${r.origBpm.toFixed(0)} bpm`);
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
}

try {
  main();
} catch (err: any) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
