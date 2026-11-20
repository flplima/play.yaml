# play.yaml

What if you could make some music with YAML? 

https://github.com/user-attachments/assets/e3c789ef-bd03-4bf1-a71c-6f9d4b2494b8

Sound on!

Try it in your browser: **[flplima.github.io/play.yaml](https://flplima.github.io/play.yaml/)**

## a taste of the syntax

> [!WARNING]
> _This project is in its very very early stages. The syntax may change dramatically._

This is Twinkle, Twinkle Little Star:

```yaml
play: |
  c c g g
  a a g ~
  f f e e
  d d c ~
```

Each line is one bar. Four notes in a 4/4 bar are four quarter notes, and `~` is a rest.
By default, it plays at 80 bpm on a piano, because nothing says otherwise.

A bit more of the language:

```yaml
tempo: 96
scale: d minor
tracks:
  cello:
    preset: cello
    octave: 3
    dynamic: piano
    play: |
      1 3 5 8                            # scale degrees: D F A D
      dolce, crescendo to forte over 2   # a marking, written like in a score
      {5 4} 3 [1 5] _                    # {} splits a beat, [] is a chord, _ holds it
      8 _ _ ~
  drums:
    kit: acoustic
    play:
      - 3x: "bd hh sd hh"                # a list item can repeat: the same bar, three times
```

There is a lot more: sections and song form, rubato, bow and pedal techniques, drum rolls, euclidean rhythms. The full tour is in [docs/reference.md](docs/reference.md).

## how it compares

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

## contributing

Any contribution is welcome, and so are AI agents! [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the rules and the easy places to start.

## license

MIT
