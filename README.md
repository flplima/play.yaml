> [!WARNING]
> _This project is in its early stages. The syntax may still change._

# play.yaml

Make some music with YAML.

## why?

I wanted to write music the way I write code: in a text file that I can read and keep in git.
**play.yaml** is a score format for that. You write the measures in YAML, and it compiles to MIDI.

- **Musician-friendly**: Each string is one measure, split equally among its notes. Dynamics and techniques are the words a score already uses, like `dolce` or `sul ponticello`.
- **Git-friendly**: A score is plain text, and the same file always compiles to the same MIDI bytes. Even the random parts are seeded.
- **Agent-friendly**: One bar per string, so an agent can fix bar 12 without breaking bar 13. `play-yaml-import --verify` proves a transcription kept every note, and `play-yaml-fidelity` grades it against a reference MIDI.
- **Instrument-friendly**: It plays in the browser, on a synth or on a free sampled orchestra. Or it sends plain MIDI to your hardware synth, your DAW or a virtual instrument.

## a taste

The smallest score is just something to play. This is Twinkle, Twinkle Little Star:

```yaml
play:
  - "c c g g"
  - "a a g ~"
  - "f f e e"
  - "d d c ~"
```

Four tokens in a 4/4 measure are four quarter notes, and `~` is a rest. It plays at 80 bpm on a piano, because nothing says otherwise.

A bit more of the language:

```yaml
tempo: 96
scale: d minor
tracks:
  cello:
    sample: cello
    octave: 3
    dynamic: piano
    play:
      - "1 3 5 8"                            # scale degrees: D F A D
      - "dolce, crescendo to forte over 2"   # a marking, written like in a score
      - "{5 4} 3 [1 5] _"                    # {} splits a beat, [] is a chord, _ holds it
      - "8 _ _ ~"
  drums:
    kit: acoustic
    play:
      - 3x: "bd hh sd hh"                    # the same bar, three times
```

There is a lot more: sections and song form, rubato, bow and pedal techniques, drum rolls, euclidean rhythms. The full tour is in [docs/reference.md](docs/reference.md).

## how it works

The core parses the YAML and compiles it to a timeline of notes, control changes and tempo. It has zero dependencies and runs the same in Node and in the browser.

```
          ┌──────────────┐
          │  .play.yaml  │
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │     core     │
          └─┬──────────┬─┘
            │          │
   ┌────────▼──┐   ┌───▼───────┐
   │  studio   │   │    cli    │
   │ (browser) │   │  (node)   │
   └───────────┘   └───────────┘
```

Both play the score with the built-in sounds, export a `.mid` file, or send live MIDI to your instruments. Both also print it as sheet music, in a PDF.

The studio is an editor that plays what you write. Edit while it plays, and the change lands on the next bar. The Score tab shows the same music as sheet music, and follows the playback. The share button puts the whole score in the link, so there is no server and nothing is uploaded.

## try it

You need Node.js 22 or newer.

```bash
git clone https://github.com/flplima/play.yaml.git
cd play.yaml
npm install
npm run build

# write a .mid file
node packages/cli/dist/export.js --input examples/twinkle.play.yaml --output twinkle.mid

# or print it as sheet music
node packages/cli/dist/export.js --input examples/twinkle.play.yaml --output twinkle.pdf

# or play it on your speakers (mind the volume)
node packages/cli/dist/cli.js examples/twinkle.play.yaml

# open the studio at https://localhost:5173
# (the certificate is self-signed, so your browser will complain once)
npm run dev:vite -w @play.yaml/web
```

Out of the box, everything plays on synth presets. To hear the sampled orchestra, install the free [Virtual Playing Orchestra](http://virtualplaying.com). [The reference](docs/reference.md#the-built-in-orchestra) says where to put it.

## how it compares

play.yaml borrows from the tools that came before it. Live editing on the bar line comes from Sonic Pi, and share links from Strudel.

### score and live coding tools

| | play.yaml | [Alda](https://github.com/alda-lang/alda) | [Strudel](https://strudel.cc) | [Sonic Pi](https://sonic-pi.net) | [LilyPond](https://lilypond.org) |
|---|---|---|---|---|---|
| you write | a YAML score | a text score | patterns in JavaScript | Ruby code | a text score |
| runs in the browser | ✓ | ✗ | ✓ | ✗ | ✗ |
| edit while it plays | ✓ | a REPL | ✓ | ✓ | ✗ |
| scale degrees | ✓ | ✗ | ✓ | ✓ | ✗ |
| plays on | synths, a sampled orchestra, your MIDI gear | General MIDI sounds | synths, samples, your MIDI gear | synths, samples, your MIDI gear | nothing, it writes files |
| exports a MIDI file | ✓ | ✓ | ✗ | ✗ | ✓ |
| imports a MIDI file | ✓ | ✗ (MusicXML) | ✗ | ✗ | ✓ |
| prints sheet music | ✓ (notes and rhythm, no dynamics or slurs yet) | ✗ | ✗ | ✗ | ✓ |
| license | MIT | EPL-2.0 | AGPL-3.0 | MIT | GPL-3.0 |

So, if you want the best-looking printed score, use LilyPond. If you want to improvise on stage, use Strudel. If you want a whole piece in a text file that plays back with expression, try play.yaml.

### AI music tools

play.yaml has no model inside. It gives your coding agent a format it can write, and tools to check its own work.

| | play.yaml | [Suno](https://suno.com) | [text2midi](https://github.com/AMAAI-Lab/Text2midi) | [ableton-mcp](https://github.com/ahujasid/ableton-mcp) |
|---|---|---|---|---|
| what it is | a score format an agent can write | a text-to-song service | a text-to-MIDI model | an agent's remote control for Ableton Live |
| who writes the notes | you, or your coding agent | its model | its model | your agent, through tool calls |
| you get | a text score and a MIDI file | audio (MIDI from stems on the Premier plan) | a MIDI file | clips in a Live set |
| source you can read and diff | ✓ | ✗ | ✗ | ✗ |
| checks the result against a reference | ✓ | ✗ | ✗ | ✗ |
| needs | Node.js or a browser | an account | Python and a model download | Ableton Live |
| license | MIT | proprietary | Apache-2.0 | MIT |

What play.yaml has for agents:

- **One measure per string**: The tokens share the measure equally, so a bar can't run over. An agent can fix bar 12 without breaking bar 13.
- **`play-yaml-import --verify`**: Turns a `.mid` into a score and proves that no note was lost.
- **`play-yaml-fidelity`**: Grades a score from 0 to 100 against a reference MIDI and lists the weakest bars, so an agent can fix them in a loop.
- **Same file, same MIDI bytes**: Every bundled song is pinned by a test, so a change that alters the music shows up.
- **A workflow written for agents**: [docs/song-workflow.md](docs/song-workflow.md) goes from a song name to a checked transcription.

Both tables were checked against each project's docs in November 2026. If a cell is wrong, please open an issue. The long version is in [docs/similar-projects.md](docs/similar-projects.md).

## songs

[examples/](examples/) has short scores to start from. [songs/](songs/) has full transcriptions: Bach, Debussy, the Bach/Gounod *Ave Maria* and Zequinha de Abreu's *Tico-Tico no Fubá*. Each one is checked against a reference MIDI with `play-yaml-fidelity`, and they score between 92 and 98 out of 100.

Every piece here is in the public domain. No audio, MIDI or third-party sheet music is committed.

## contributing

Any contribution is welcome, and so are AI agents! [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the rules and the easy places to start.

## license

MIT
