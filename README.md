# play.yaml

A project dedicated to the `play.yaml` format — a human-readable, developer-friendly YAML schema and compact text notation DSL for describing music scores, which compiles into Standard MIDI Files or streamable MIDI events.

## Monorepo Layout

This is a monorepo managed with npm workspaces:

- `packages/core/`: The core `play.yaml` interpreter. It parses the DSL tracks, handles scales/chords/dynamics/subdivisions, and converts YAML documents to Standard MIDI Files (`.mid`) or flat timeline matrices of MIDI events.
- `packages/cli/`: Command-line player that compiles and synthesizes `play.yaml` songs directly to your system speakers via the Web Audio API using `webaudio-node`.

## Getting Started

### Prerequisites

- Node.js (>= 16.0.0)
- npm (>= 7.0.0 for workspaces support)

### Installation

Install dependencies (if any) and set up workspaces:

```bash
npm install
```

### Running Tests

Run the test suite across all workspace packages:

```bash
npm test
```

Or run tests directly in the core package:

```bash
npm test -w @play.yaml/core
```

### CLI Usage

Build the packages first:

```bash
npm run build
```

#### Compile `play.yaml` to MIDI
You can compile `.play.yaml` scores into Standard MIDI Files:

```bash
node packages/cli/dist/export.js --input examples/my-score.play.yaml --output track.mid
```

#### Play `play.yaml` through speakers
You can play a score in real-time through your speakers using the Web Audio synthesizer:

```bash
node packages/cli/dist/cli.js examples/my-score.play.yaml
```

Or run the preconfigured sample song play command:

```bash
npm run play -w @play.yaml/cli
```

### Web App

A browser-based editor & player lives in `packages/web`. The dev server runs in the background under [pm2](https://pm2.keymetrics.io/):

```bash
npm run dev          # start (or restart) the dev server on :5173
npm run logs         # print the last 100 log lines
npm run logs:follow  # stream logs live
npm run dev:stop     # stop the dev server
```

It offers a YAML editor with syntax highlighting, the bundled example scores (editable in-session, never persisted), opening/saving local `.play.yaml` files via the File System Access API, playback through a built-in Web Audio synth, and per-instrument routing to your MIDI devices via WebMIDI (with a per-mapping test note).

## The DSL Notation

A score is a YAML document, and **the document itself is a track**. The smallest possible score is just something to play:

```yaml
play:
  - "c c g g"
  - "a a g ~"
  - "f f e e"
  - "d d c ~"
```

That's Twinkle, Twinkle Little Star — 80 bpm, 4/4, piano by default (a built-in synth stands in when the piano sample isn't available).

### Measures & equal division

Each string in the `play` array (or each line of a `play: |` multiline string) is **one measure**. A measure's duration is divided **equally** among its whitespace-separated tokens: 4 tokens in 4/4 are quarter notes, 8 tokens are eighth notes, 3 tokens are a half-note triplet.

### Tokens (recursive)

- `c` — a note: letter `a`–`g`, optional `#`/`b`, optional octave digit (`eb3`, `f#2`); default octave is 4
- `1` — a scale degree in the track's `scale` (default `c major`): `1` is the root at the track's `octave`, `8` the root an octave up, `0` and negatives step below the root, and a trailing `#`/`b` shifts a semitone (`4#`, `7b`).
- `5^` — an octave modifier, repeatable and stackable: `^` or `+` raises a note an octave, `-` lowers one (`5^^` is the fifth two octaves up). Modifiers follow any accidental (`4#^`) and work on letters too (`c^`, `eb3-`). They shift by a true octave rather than a scale length, so `1^` is the root an octave up in any scale, including the 8-note ones.

  Degrees climb past the octave on their own (`8` is the root an octave up, `15` two), so a comfortable convention is to let plain numbers cover the working range — roughly `1`–`16`, two octaves — and reach for a modifier only on outliers, where `5-` reads far better than the equivalent `-2`. Scales take any Greek mode alongside `major`/`minor` (`g lydian`, `d dorian`), plus non-diatonic scales: `harmonic minor`, `melodic minor`, `harmonic major`, `octatonic`, `bebop dominant`, `bebop major`. Multi-word abbreviations work: `g harm min`, `c bebop dom`.
- `~` — a rest
- `[c e g]` — a chord: all notes sound together for the whole slot
- `{c d}` — a group: the slot is subdivided equally among its elements

Tokens nest recursively — `{c {d e}}` splits the second half of the slot again, and chords can sit inside groups: `{c [e g]}`. A common idiom is one group per beat, e.g. a measure of sixteenths: `"{g2 d3 b3 a3} {b3 d3 b3 d3} {g2 d3 b3 a3} {b3 d3 b3 d3}"`.

### Tracks & inheritance

A track may declare child `tracks` (a named mapping). Children **inherit every property from their parent except `play`**, and can override any of them. Inheritable properties: `tempo`, `measure`, `sample`, `scale`, `octave`, `channel`, `program`, `velocity`.

```yaml
tempo: 80
measure: 4/4
tracks:
  melody:
    sample: piano
    play: "c d e d"              # 4 tokens → quarter notes
  bassline:
    sample: bass
    octave: 2
    play:
      - "c c ~ ~ c c ~ ~"        # 8 tokens → eighth notes
```

Built-in samples: `piano`, `keys`, `bass`, `strings`, `cello`, `pad`, `flute`, `ocarina`, `lead` — each maps to a General MIDI program for `.mid` export and to a synth preset in the players.

### The `set` shorthand

`set` patches several props at once — a comma-separated string (or array of them) of clauses: a scale (`g lydian`, abbreviations like `g mix` welcome) and/or an octave (`octave up`, `oct down`, `oct 3`):

```yaml
set: g ionian, octave 2
```

### Articulation (`gate`)

`gate` is the fraction of its slot a note sounds. Below 1 the note releases before the next begins; **above 1 the notes overlap**, which is how physical-model instruments (SWAM and friends) are told to slur rather than re-attack each note:

```yaml
gate: 0.9              # default — detached
play:
  - 1: "1 2 3 4"
  - set: legato        # gate 1.05: notes overlap into the next slot
  - 2: "5 6 7 8"
  - set: detached      # back to 0.9 — also: staccato (0.4), or `gate 1.2`
```

### Instrument controls (CC)

Declare a `controls` alias map matching your instrument's MIDI mapping, then set them by name mid-song. Raw `ccNN` always works without a map:

```yaml
sample: cello
controls: { bow: 74, pressure: 71 }
play:
  - 1: "1 2 3 4"
  - set: bow 30, pressure 90    # sul tasto, heavier bow
  - 2: "5 6 7 8"
  - set: cc74 55                # or address the CC directly
```

Note that SWAM's Bow Position and Bow Pressure have no fixed CC numbers — they're assigned on its "MIDI Mapping" page, so point the aliases at whatever you configured there.

### Tempo changes and rubato

```yaml
tempo: 120
play:
  - 1: "1 2 3 4"
  - set: tempo 60 over 1   # ritardando: ramp to 60 across the next measure
  - 2: "5 6 7 8"
  - set: tempo 120         # immediate, snap back
```

Tempo is a property of the song, so changes declared in any track apply to all of them, and they survive `.mid` export as tempo meta-events (ramps become a staircase, since SMF has no tempo glide).

### Changing scale or octave mid-song

A mapping item inside a `play` list is a **directive**: it updates the running `scale`, `octave`, `velocity`, and/or `set` for everything after it, without adding a measure:

```yaml
set: g major, octave 2
play:
  - "{1 5 10 9} {10 5 10 5} {1 5 10 9} {10 5 10 5}"
  - set: g lyd, oct up     # ← from here on
  - "{0 4 5 4} {5 4 5 4} {0 4 5 4} {5 4 5 4}"
```

Play-list items can also be **numbered measures** — the key states the 1-based measure the string occupies, so scores stay labeled and gaps become silence:

```yaml
play:
  - 1: "{1 5 10 9} {10 5 10 5} {1 5 10 9} {10 5 10 5}"
  - set: d maj, oct 3
  - 5: "{0 4 5 4} {5 4 5 4} {0 4 5 4} {5 4 5 4}"   # mm.2–4 are silent
```

For mid-measure changes, `||…||` inside a measure string applies a `set` at that exact spot. It doesn't count toward the equal division (prefer `- set:` items at measure boundaries):

```yaml
play: "1 2 3 4 ||c lyd, oct up|| 5 6 7 8"
```

## Example Songs

You can find several complete multi-track songs in the [examples/](file:///Users/felipe/projects/oss/play.yaml/examples/) directory:

- [lost-woods.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/lost-woods.play.yaml): The magical "Lost Woods" theme (Saria's Song) from Ocarina of Time, configured as an infinite loop.
- [take-5.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/take-5.play.yaml): Dave Brubeck's famous jazz standard "Take Five", written in a 5/4 time signature.
- [corridors-of-time.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/corridors-of-time.play.yaml): Chrono Trigger's iconic "Corridors of Time" (Zeal Theme).
- [preciso-me-encontrar.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/preciso-me-encontrar.play.yaml): Cartola's classic Brazilian samba masterpiece.
- [bwv1007.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/bwv1007.play.yaml): J.S. Bach's Cello Suite No. 1 in G major (Prelude).
- [bwv881.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/bwv881.play.yaml): J.S. Bach's Prelude No. 12 in F minor from The Well-Tempered Clavier.
- [severance.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/severance.play.yaml): The haunting intro theme song of the TV show *Severance*.
- [experiments-cello.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/experiments-cello.play.yaml): A short cello-soundscape composition testing dynamic variations.

To play any of these songs through your speakers:

```bash
node packages/cli/dist/cli.js examples/take-5.play.yaml
```
