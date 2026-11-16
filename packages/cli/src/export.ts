import * as fs from 'fs';
import * as path from 'path';
import { encodeMidi, encodeMusicXml, scoreFromDoc } from '@play.yaml/core';
import { loadDoc, loadScore, parseFlags, run, usage } from './shared';

const HELP = `play.yaml → MIDI (multitrack), MusicXML or PDF (sheet music)

Usage:
  play-yaml --input song.play.yaml --output track.mid
  play-yaml --input song.play.yaml --output song.musicxml
  play-yaml --input song.play.yaml --output song.pdf

Flags:
  -i, --input <file>    .play.yaml (or .json) song document
  -o, --output <file>   output path (default: alongside the input); an
                        output ending in .musicxml or .xml writes MusicXML,
                        one ending in .pdf writes sheet music as a PDF
  -f, --format <fmt>    midi, musicxml or pdf (default: from the output name, else midi)
      --paper <size>    a4 or letter (default a4; PDF only)
  -b, --bpm <n>         override tempo (default: the score's; MIDI only)
      --tpqn <n>        ticks per quarter note (default 480; MIDI only)
      --json            print compiled timelines instead of writing a file
  -h, --help            this help

MusicXML is the score as written: no gate, humanize, rubato or strum, with
sections and repeats written out once through. Open it in MuseScore,
LilyPond (musicxml2ly) or any notation program. The PDF is that same score
engraved as vector pages.`;

const MUSICXML = /\.(musicxml|xml)$/i;
const PDF = /\.pdf$/i;

run(async () => {
  const { flags, positional } = parseFlags(process.argv.slice(2), {
    input: { names: ['--input', '-i'], value: true },
    output: { names: ['--output', '-o'], value: true },
    bpm: { names: ['--bpm', '-b'], value: true },
    tpqn: { names: ['--tpqn'], value: true },
    format: { names: ['--format', '-f'], value: true },
    paper: { names: ['--paper'], value: true },
    json: { names: ['--json'] },
    help: { names: ['--help', '-h'] },
  });
  const input = (flags.input as string | undefined) ?? positional[0];
  if (flags.help || !input) usage(HELP, flags.help);

  const requested = flags.output as string | undefined;
  const format = String(flags.format ?? (requested && MUSICXML.test(requested) ? 'musicxml' : requested && PDF.test(requested) ? 'pdf' : 'midi')).toLowerCase();
  if (format !== 'midi' && format !== 'musicxml' && format !== 'pdf') {
    usage(`Unknown --format "${format}": use midi, musicxml or pdf.\n\n${HELP}`, false);
  }
  const paper = String(flags.paper ?? 'a4').toLowerCase();
  if (paper !== 'a4' && paper !== 'letter') usage(`Unknown --paper "${paper}": use a4 or letter.\n\n${HELP}`, false);

  if (format === 'pdf' && !flags.json) {
    const output = requested ??
      path.join(path.dirname(input), path.basename(input).replace(/\.play\.ya?ml$|\.[^.]+$/i, '') + '.pdf');
    const score = scoreFromDoc(loadDoc(input));
    // Loaded here, not at the top, so MIDI and MusicXML exports never load the PDF libraries.
    const { musicXmlToPdf } = await import('./pdf');
    const { bytes, pages } = await musicXmlToPdf(encodeMusicXml(score), paper);
    fs.writeFileSync(output, bytes);
    for (const w of score.warnings) console.warn(`  ! ${w}`);
    console.log(
      `✔ ${output}  (${pages} page${pages === 1 ? '' : 's'}, ${paper === 'a4' ? 'A4' : 'US Letter'}, ${score.parts.length} part(s), ${score.measures.length} measures, ${bytes.length} bytes)`,
    );
    return;
  }

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
