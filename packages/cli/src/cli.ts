import * as fs from 'fs';
import * as path from 'path';
import { parseYaml, compileDoc } from '@play.yaml/core';
import { playSong, playSongMidi } from './index';

const HELP = `play.yaml Player CLI

Usage:
  play-yaml-play <file.play.yaml> [options]

Options:
  -l, --loop         Loop the playback infinitely
  -m, --midi         Output live MIDI events to virtual MIDI port instead of Web Audio
  -p, --midi-port    Name of the MIDI output port to create/use (default: "play.yaml Output")
  -h, --help         Show this help message`;

async function main() {
  const args = process.argv.slice(2);
  let inputPath = '';
  let loop = false;
  let useMidi = false;
  let midiPort = 'play.yaml Output';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--loop' || arg === '-l') {
      loop = true;
    } else if (arg === '--midi' || arg === '-m') {
      useMidi = true;
    } else if (arg === '--midi-port' || arg === '-p') {
      midiPort = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      inputPath = arg;
    }
  }

  if (!inputPath) {
    console.log(HELP);
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
  }

  try {
    const text = fs.readFileSync(resolvedPath, 'utf8');
    const doc = parseYaml(text);
    if (!doc || typeof doc !== 'object' || (doc.play == null && doc.tracks == null)) {
      throw new Error(`Invalid score: must define a "play:" or "tracks:" key.`);
    }

    const compiled = compileDoc(doc);

    // Play the compiled song. In loop mode, passes after the first restart
    // from the song's forever-loop point (sections), or from the top.
    if (loop) {
      console.log('Loop playback enabled. Press Ctrl+C to stop.');
      let fromBeat = 0;
      while (true) {
        if (useMidi) {
          await playSongMidi(compiled, midiPort, { fromBeat });
        } else {
          await playSong(compiled, { fromBeat });
        }
        fromBeat = compiled.loopStartBeats ?? 0;
      }
    } else {
      if (useMidi) {
        await playSongMidi(compiled, midiPort);
      } else {
        await playSong(compiled);
      }
      process.exit(0);
    }
  } catch (err: any) {
    console.error(`Playback Error: ${err.message}`);
    process.exit(1);
  }
}

main();
