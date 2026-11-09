import * as fs from 'fs';
import * as path from 'path';
import { encodeMidi } from '@play.yaml/core';
import { loadScore, parseFlags, run, usage } from './shared';

const HELP = `play.yaml → MIDI (multitrack)

Usage:
  play-yaml --input song.play.yaml --output track.mid

Flags:
  -i, --input <file>    .play.yaml (or .json) song document
  -o, --output <file>   .mid output path (default: alongside the input)
  -b, --bpm <n>         override tempo (default: the score's)
      --tpqn <n>        ticks per quarter note (default 480)
      --json            print compiled timelines instead of writing .mid
  -h, --help            this help`;

run(() => {
  const { flags, positional } = parseFlags(process.argv.slice(2), {
    input: { names: ['--input', '-i'], value: true },
    output: { names: ['--output', '-o'], value: true },
    bpm: { names: ['--bpm', '-b'], value: true },
    tpqn: { names: ['--tpqn'], value: true },
    json: { names: ['--json'] },
    help: { names: ['--help', '-h'] },
  });
  const input = (flags.input as string | undefined) ?? positional[0];
  if (flags.help || !input) usage(HELP, flags.help);

  const compiled = loadScore(input);
  const bpm = Number(flags.bpm) || compiled.bpm;

  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...compiled, bpm }, null, 2) + '\n');
    return;
  }

  const output = (flags.output as string | undefined) ??
    path.join(path.dirname(input), path.basename(input).replace(/\.[^.]+$/, '') + '.mid');
  const buf = encodeMidi(compiled, { bpm, tpqn: flags.tpqn ? Number(flags.tpqn) : undefined });
  fs.writeFileSync(output, buf);

  const notes = compiled.tracks.reduce((n, t) => n + t.timeline.length, 0);
  console.log(
    `✔ ${output}  —  ${compiled.tracks.length} track(s), ${notes} notes, ${bpm} bpm, ${buf.length} bytes`,
  );
});
