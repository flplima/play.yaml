import * as fs from 'fs';
import * as path from 'path';
import { encodeMidi, encodeMusicXml, scoreFromDoc } from '@play.yaml/core';
import { loadDoc, loadScore, parseFlags, run, usage } from './shared';

const HELP = `play.yaml → MIDI (multitrack) or MusicXML (sheet music)

Usage:
  play-yaml --input song.play.yaml --output track.mid
  play-yaml --input song.play.yaml --output song.musicxml

Flags:
  -i, --input <file>    .play.yaml (or .json) song document
  -o, --output <file>   output path (default: alongside the input); an
                        output ending in .musicxml or .xml writes MusicXML
  -f, --format <fmt>    midi or musicxml (default: from the output name, else midi)
  -b, --bpm <n>         override tempo (default: the score's; MIDI only)
      --tpqn <n>        ticks per quarter note (default 480; MIDI only)
      --json            print compiled timelines instead of writing a file
  -h, --help            this help

MusicXML is the score as written: no gate, humanize, rubato or strum, with
sections and repeats written out once through. Open it in MuseScore,
LilyPond (musicxml2ly) or any notation program.`;

const MUSICXML = /\.(musicxml|xml)$/i;

run(() => {
  const { flags, positional } = parseFlags(process.argv.slice(2), {
    input: { names: ['--input', '-i'], value: true },
    output: { names: ['--output', '-o'], value: true },
    bpm: { names: ['--bpm', '-b'], value: true },
    tpqn: { names: ['--tpqn'], value: true },
    format: { names: ['--format', '-f'], value: true },
    json: { names: ['--json'] },
    help: { names: ['--help', '-h'] },
  });
  const input = (flags.input as string | undefined) ?? positional[0];
  if (flags.help || !input) usage(HELP, flags.help);

  const requested = flags.output as string | undefined;
  const format = String(flags.format ?? (requested && MUSICXML.test(requested) ? 'musicxml' : 'midi')).toLowerCase();
  if (format !== 'midi' && format !== 'musicxml') usage(`Unknown --format "${format}": use midi or musicxml.\n\n${HELP}`, false);

  if (format === 'musicxml' && !flags.json) {
    const output = requested ??
      path.join(path.dirname(input), path.basename(input).replace(/\.play\.ya?ml$|\.[^.]+$/i, '') + '.musicxml');
    const score = scoreFromDoc(loadDoc(input));
    const xml = encodeMusicXml(score);
    fs.writeFileSync(output, xml);
    for (const w of score.warnings) console.warn(`  ! ${w}`);
    console.log(
      `✔ ${output}  (${score.parts.length} part(s), ${score.measures.length} measures, ${Buffer.byteLength(xml)} bytes)`,
    );
    return;
  }

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
