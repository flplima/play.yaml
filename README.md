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

Both play the score with the built-in sounds, export a `.mid` file, or send live MIDI to your instruments.

The studio is an editor that plays what you write. Edit while it plays, and the change lands on the next bar. The share button puts the whole score in the link, so there is no server and nothing is uploaded.

## try it

You need Node.js 22 or newer.

```bash
git clone https://github.com/flplima/play.yaml.git
cd play.yaml
npm install
npm run build

# write a .mid file
node packages/cli/dist/export.js --input examples/twinkle.play.yaml --output twinkle.mid

# or play it on your speakers (mind the volume)
node packages/cli/dist/cli.js examples/twinkle.play.yaml

# open the studio at https://localhost:5173
# (the certificate is self-signed, so your browser will complain once)
npm run dev:vite -w @play.yaml/web
```

Out of the box, everything plays on synth presets. To hear the sampled orchestra, install the free [Virtual Playing Orchestra](http://virtualplaying.com). [The reference](docs/reference.md#the-built-in-orchestra) says where to put it.

## similar projects

play.yaml borrows from the tools that came before it. Live editing on the bar line comes from Sonic Pi, and share links from Strudel. Here is what each one is best at:

| project | best at | how play.yaml differs |
|---|---|---|
| [Alda](https://github.com/alda-lang/alda) | scores as plain text, from the command line | The closest cousin. play.yaml adds a browser studio, scale degrees and named sections. |
| [Strudel](https://strudel.cc) and [TidalCycles](https://tidalcycles.org) | improvising patterns live | They think in cycles. play.yaml thinks in measures and song form. |
| [Sonic Pi](https://sonic-pi.net) | live coding and teaching | It is code (`play`, `sleep`). play.yaml is data. |
| [LilyPond](https://lilypond.org) and [ABC](https://abcnotation.com) | printed sheet music | play.yaml draws no notation. It plays and exports MIDI. |
| MusicXML | exchanging scores between apps | It is not meant to be written by hand. |

So, if you want to print a score, use LilyPond. If you want to improvise on stage, use Strudel. If you want a whole piece in a text file that plays back with expression, try play.yaml.

The long version is in [docs/similar-projects.md](docs/similar-projects.md).

## songs

[examples/](examples/) has short scores to start from. [songs/](songs/) has full transcriptions: Bach, Debussy, the Bach/Gounod *Ave Maria* and Zequinha de Abreu's *Tico-Tico no Fubá*. Each one is checked against a reference MIDI with `play-yaml-fidelity`, and they score between 92 and 98 out of 100.

Every piece here is in the public domain. No audio, MIDI or third-party sheet music is committed.

## contributing

Any contribution is welcome, and so are AI agents! [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the rules and the easy places to start.

## license

MIT
