'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { compileDoc, SongDoc } from './parser';
import { encodeMidi } from './exporter';
import { parseYaml } from './yaml';

interface CliArgs {
  input?: string;
  output?: string;
  bpm?: number;
  tpqn: number;
  json: boolean;
  help?: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { tpqn: 480, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--input': case '-i': args.input = next(); break;
      case '--output': case '-o': args.output = next(); break;
      case '--bpm': case '-b': args.bpm = Number(next()); break;
      case '--tpqn': args.tpqn = Number(next()); break;
      case '--json': args.json = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (!args.input && !a.startsWith('-')) args.input = a; // allow bare path
        else console.error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

const HELP = `musician-coder DSL → MIDI (YAML, multitrack)

Usage:
  play-yaml --input song.play.yaml --output track.mid

Flags:
  -i, --input <file>    .play.yaml (or .json) song document
  -o, --output <file>   .mid output path (default: alongside the input)
  -b, --bpm <n>         override tempo (default: meta.bpm)
      --tpqn <n>        ticks per quarter note (default 480)
      --json            print compiled timelines instead of writing .mid
  -h, --help            this help`;

/** Load a song document from YAML or JSON. */
export function loadDoc(inputPath: string): SongDoc {
  const text = fs.readFileSync(path.resolve(process.cwd(), inputPath), 'utf8');
  const doc = /\.ya?ml$/i.test(inputPath) ? parseYaml(text) : JSON.parse(text);
  if (!doc || !Array.isArray(doc.tracks)) {
    throw new Error(`Score "${inputPath}" must define a "tracks:" list.`);
  }
  return doc;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(HELP);
    process.exit(args.input ? 0 : 1);
  }

  const doc = loadDoc(args.input);
  const compiled = compileDoc(doc);
  const bpm = args.bpm || compiled.bpm;

  if (args.json) {
    process.stdout.write(JSON.stringify({ ...compiled, bpm }, null, 2) + '\n');
    return;
  }

  const output =
    args.output ||
    path.join(path.dirname(args.input), path.basename(args.input).replace(/\.[^.]+$/, '') + '.mid');

  const buf = encodeMidi(compiled, { bpm, tpqn: args.tpqn });
  fs.writeFileSync(output, buf);

  const notes = compiled.tracks.reduce((n: number, t: any) => n + t.timeline.length, 0);
  console.log(
    `✔ ${output}  —  ${compiled.tracks.length} track(s), ${notes} notes, ${bpm} bpm, ${buf.length} bytes`,
  );
}

try {
  main();
} catch (err: any) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
