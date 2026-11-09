import { playSong, playSongMidi } from './index';
import { loadScore, parseFlags, run, usage } from './shared';

const DEFAULT_PORT = 'play.yaml Output';

const HELP = `play.yaml Player CLI

Usage:
  play-yaml-play <file.play.yaml> [options]

Options:
  -l, --loop         Loop the playback infinitely
  -m, --midi         Output live MIDI events to a virtual MIDI port instead of Web Audio
  -p, --midi-port    Name of the MIDI output port to create/use (default: "${DEFAULT_PORT}")
  -h, --help         Show this help message`;

run(async () => {
  const { flags, positional } = parseFlags(process.argv.slice(2), {
    loop: { names: ['--loop', '-l'] },
    midi: { names: ['--midi', '-m'] },
    port: { names: ['--midi-port', '-p'], value: true },
    help: { names: ['--help', '-h'] },
  });
  const input = positional[0];
  if (flags.help || !input) usage(HELP, flags.help);

  const compiled = loadScore(input);
  const port = (flags.port as string | undefined) ?? DEFAULT_PORT;
  const play = (fromBeat: number) =>
    flags.midi ? playSongMidi(compiled, port, { fromBeat }) : playSong(compiled, { fromBeat });

  // In loop mode, passes after the first restart from the song's forever-loop
  // point (sections), or from the top.
  if (flags.loop) console.log('Loop playback enabled. Press Ctrl+C to stop.');
  await play(0);
  while (flags.loop) await play(compiled.loopStartBeats ?? 0);
  process.exit(0);
});
