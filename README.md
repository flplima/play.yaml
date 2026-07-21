# play.yaml

A project dedicated to the `play.yaml` format — a human-readable, developer-friendly YAML schema and compact text notation DSL for describing music scores, which compiles into Standard MIDI Files or streamable MIDI events.

## Monorepo Layout

This is a monorepo managed with npm workspaces:

- `packages/core/`: The `play.yaml` engine — dependency-free and environment-free (no Node or DOM APIs), so it runs identically in Node and browsers. Layered as: `theory` (pitch/scale/meter math) → `vocabulary` (dynamics, articulations, tempo marks, techniques, named controls) → `set` (the `set:` shorthand) → `tokens` (measure tokenizing) → `song` (the compiler), plus the zero-dep YAML subset (`yaml`), the `.mid` encoder (`exporter`), beat→seconds tempo mapping (`time`) and the shared Web Audio instrument presets (`synth`). Everything re-exports from the package root.
- `packages/cli/`: Command-line tools built on core: `play-yaml` exports scores to `.mid`; `play-yaml-play` plays them through the speakers (via `webaudio-node`) or streams live MIDI — notes, the score's CC automation and the tempo map — to a virtual MIDI port.
- `packages/web/`: The browser studio (Vite/React): CodeMirror editor with played-note highlighting, Tone.js transport playback with the built-in sampler & synth, and per-instrument WebMIDI routing. Consumes core by source, so core edits hot-reload without a rebuild.

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

It offers a YAML editor with syntax highlighting, the bundled example scores (editable in-session, never persisted), opening/saving local `.play.yaml` files via the File System Access API, playback through a built-in Web Audio engine, and per-instrument routing to your MIDI devices via WebMIDI (with a per-mapping test note). A header toggle picks the output: **Built-in** renders everything in the browser, **MIDI** uses the panel's routes. The **⬇ MP3** button renders the score offline with the built-in sounds (tempo map included) and downloads it as an MP3.

The built-in engine is expressive: every track gets a control bus that performs
the score's CC stream — expression (CC11) swells through held notes, vibrato
depth/rate drive a real LFO, bow position (CC74) morphs the tone from
fingerboard-dark to bridge-nasal, and `pizzicato` / `tremolo` switch playing
styles. Tracks with `sample: violin` play on a bundled sampled violin (solo
violin from the CC0 [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/),
≈5 MB lazy-loaded: sustain p/f layers, pizzicato, spiccato and tremolo
recordings, chosen per note from the score's articulation and dynamics). Other
instruments keep the oscillator presets, shaped by the same bus.

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
- `_1` — a leading `_` drops a note or degree an octave, repeatable (`__d3`). The suffix form `1-` means the same thing; the prefix reads better at the start of a token.
- `==Dm7==` — a scale or chord change inside a measure string. A chord symbol implies its chord-scale (`Dm7` → D dorian, `A7` → A mixolydian, `G#dim7` → G# diminished, `Em7b5` → E locrian), so degrees after it are read off that chord. A slash bass is accepted and ignored: `==Gm6/Bb==` still counts degrees from G. `==c mixolydian==` works too, and chord symbols are equally valid in `scale:` and `set:`.
- `~` — a rest
- `_` — a hold: prolongs the note before it through this slot, like a tie. It works at any nesting depth and across barlines, so `"c _ _ _"` is one note filling the measure and `"[c e g] _"` prolongs the whole chord. A `~` cuts the sound, so nothing carries across a rest.
- `5>` — an accent: a trailing `>` stresses that one note (+16 velocity), and stacks for a sforzando (`5>>`). Its dual `5<` softens. Both mark whole chords too — `[1 5]>` hits every note in the chord.
- `[c e g]~` — a **rolled** chord (arpeggiando/strum): notes speak one after another in **written order** and end together, so `[c e g]~` breaks bass-first like a string player's triple stop or a guitar down-stroke, and `[g e c]~` strums the other way. `~~` doubles the spread for a slower, more deliberate strum. The spread defaults to 0.03 beats per note and is tuned with the `strum:` prop or a `set: strum 0.06` clause; it auto-clamps inside fast subdivisions. Combines with accents: `[c e g]>~`.
- `voices: 2` (prop, or `set: voices 2`) — the sustain limit inside rolled chords, for instruments whose excitation is physically limited: a bow holds two strings, so with `voices: 2` a rolled triple stop releases its bass as the top pair lands, exactly how a cellist breaks the chord — and exactly what SWAM needs to voice all three notes instead of dropping one. `voices all` lifts the limit (piano, guitar, samplers).
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

Built-in samples: `piano`, `keys`, `bass`, `strings`, `violin`, `cello`, `pad`, `flute`, `ocarina`, `lead` — each maps to a General MIDI program for `.mid` export. In the web studio, `piano`, `violin`, `cello`, `flute`/`ocarina` and `bass` play on **real recorded samples** (VSCO 2 CE / VCSL, all CC0, lazily loaded); everything else — and every instrument when samples can't load — renders on the built-in synth presets (`keys` is an FM electric piano, `lead` a sawtooth, …).

### Drums & percussion (`kit:` tracks)

A track with `kit:` reads its tokens as **drum names** instead of pitches:

```yaml
tempo: 96
kit: acoustic                    # inherits to the child lanes
tracks:
  groove:
    play: "bd ~ sd ~ {~ bd} bd sd ~"
  hats:
    play: "hh> hh hh hh hh> hh {hh hh} oh"
```

- **Kits**: `acoustic` and `percussion` play the sampled drum library in the browser; `808` is a synthesized electro kit. All of them export identically (see below).
- **Tokens**: `bd` (kick) `sd` (snare) `rim` `cp` (clap) `hh`/`ph`/`oh` (closed/pedal/open hat) `ft lt mt ht` (toms) `cy` (crash) `rd`/`rb` (ride/bell) — plus hand percussion: `cb` (cowbell) `tamb` `bongo` `conga`/`quinto`/`tumba` `cabasa` `shaker` `maracas` `clave` `wb` `tri` `guiro` `sleigh`… Longhand aliases work (`kick`, `snare`, `clap`, `cowbell`), and a bare number plays any GM percussion key directly.
- **The grammar is unchanged**: `{}` subdivides (fills), `[]` stacks hits, `>` accents, `<` ghosts, `_` lets a cymbal ring, `~` rests, and dynamics words/hairpins shape velocity. New here: a `~` **suffix rolls a hit** — `sd~` is a snare roll at 32nds swelling into the next beat, `sd~~` at 64ths, and `[sd sd]~` is a flam.
- **MIDI**: kit tracks compile onto **channel 10** with General MIDI percussion keys and no program change, so `.mid` exports and routed hardware/DAWs play them correctly out of the box. Melodic auto-assigned channels skip 10.
- Scale, octave and degree machinery are simply inert in kit tracks; unknown words are rests.

See `examples/drum-lab.play.yaml` for a tour (groove + fills, son clave & congas, 808 trap hats), and `docs/percussion-design.md` for the full token table and design notes.

### The `set` shorthand

`set` patches several props at once — a comma-separated string (or array of them) of clauses: a scale (`g lydian`, abbreviations like `g mix` welcome) and/or an octave (`octave up`, `oct down`, `oct 3`):

```yaml
set: g ionian, octave 2
```

### Expression marks

Performance is written the way a score marks it, not in numbers. Every term below works as a `set:` clause mid-song, and `dynamic:` / `articulation:` set the starting values as track props:

- **Dynamics** — `ppp` `pp` `p` `mp` `mf` `f` `ff` `fff`, spelled out (`piano`, `forte`), or in plain English (`quiet`, `loud`, `louder`, `softer`)
- **Gradual dynamics** — `crescendo`, `diminuendo`, with an optional target and span: `crescendo to ff over 2`. Notes inside the span interpolate.
- **Tempo** — `grave` `largo` `lento` `adagio` `andante` `moderato` `allegretto` `allegro` `vivace` `presto`
- **Gradual tempo** — `ritardando`, `rallentando`, `allargando`, `accelerando`, `stringendo`, plus `slower` / `faster`; each takes an optional target and span (`allargando to adagio over 3`, `rit. over 2`). `a tempo` returns to the tempo the track started at.
- **Relative tempo** — `più lento` (or `piu lento`), `meno mosso`, `più mosso`: an immediate section-boundary shift relative to the running tempo.
- **Meter** — a bare time signature (`2/4`, or `measure 2/4`) changes the measure length from that point on, so a score can interpolate a 2/4 bar inside 4/4 the way printed music does.
- **Articulation** — `staccatissimo` `staccato` `portato` `detached` `tenuto` `legato` (or `short` / `smooth`)
- **Character** — `dolce` `cantabile` `espressivo` `sotto voce` `leggiero` `grazioso` `marcato` `pesante` `maestoso` `agitato` `tranquillo`, each standing for a dynamic and a bowing together
- **Playing technique** — bow position `sul tasto` `flautando` `poco sul tasto` `ordinario` `poco sul ponticello` `sul ponticello` `molto sul ponticello`; bow pressure `sfiorando` `light bow` `normal bow` `heavy bow` `premuto`; vibrato `senza vibrato` `poco vibrato` `vibrato` `molto vibrato`

```yaml
dynamic: mf
articulation: tenuto
play:
  - 1: "1 2 3 4"
  - set: dolce, crescendo to f over 2
  - 2: "5 6 7 8"
  - set: legato, stringendo over 1
  - 3: "1 2 3 4"
  - set: allargando to adagio over 2, maestoso
  - 4: "8 ~ ~ ~"
```

The numeric forms (`velocity 88`, `gate 1.05`, `tempo 60 over 2`) all still work — the words are shorthands over them. Note that a bare `f` means *forte*; write `f major` for the key.

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

The technique words above drive `bow`, `pressure` and `vibrato`, which default to the conventional CCs 74, 71 and 1 — so they work with nothing declared:

```yaml
sample: cello
play:
  - 1: "1 2 3 4"
  - set: sul tasto, molto vibrato
  - 2: "5 6 7 8"
```

SWAM's Bow Position and Bow Pressure have no fixed CC numbers — they're assigned on its "MIDI Mapping" page — so `controls:` retargets them. A control can also declare a range, which narrows the band or, by putting `min` above `max`, inverts a mapping that runs the other way:

```yaml
controls:
  bow: { cc: 74, min: 127, max: 0 }   # this instrument has 0 at the bridge
  pressure: { cc: 71, min: 40, max: 90 }
  vibrato: 1                          # plain CC number when the full range is fine
```

Numbers remain available for anything without a word — `set: bow 52`, or `set: cc74 55` to address a CC directly.

Any technique or control can also **drift** instead of jumping, the way a real
bow arm moves: give it a span and it glides there from wherever it last sat,
one CC step per eighth note:

```yaml
play:
  - "sul tasto"                    # start over the fingerboard
  - 1: "{12 5 1} {1 5 12} {12 5 1} {1 5 12}"
  - "sul ponticello over 6"        # creep toward the bridge across 6 bars
  # ...
  - "bow to 64 over 2"             # numeric form; also "cc74 to 90 over 2"
```

### Physical models (SWAM and friends)

Modeled instruments expose the whole player, and the DSL speaks that language.
Beyond `bow`, `pressure` and `vibrato`, these named controls exist for words to
land on — none has a conventional CC, so map them in `controls:` to whatever
you assign on the instrument's MIDI-mapping page:

- `expression` — **the big one.** A SWAM instrument is silent until its
  expression control (default CC11) moves: it is the bow speed, and with it the
  real loudness. Declare it and every dynamic in the score drives it: `mf`
  emits one CC, `crescendo to ff over 4` a ramp of CCs at eighth-note steps,
  and the track opens with the starting dynamic so the model sounds at all.
  Note velocity stays what a modeled string wants it to be — attack character.
- `playmode` — `arco`, `pizzicato` (or `pizz`), `col legno`
- `tremolo` — `tremolo` / `tremolo slow`, `tremolo fast`, `tremolo off`: the
  instrument's own bowed tremolo on a held note, no written-out 32nds needed
- `sordino` — `con sordino`, `senza sordino`
- `bowlift` — `on the string` (martelé territory), `off the string` (spiccato)
- `portamento` — `portamento`, `molto portamento`, `glissando`,
  `senza portamento`: the portamento-time dial (CC5 is the MIDI convention)
- `vibrato_rate` — `slow vibrato`, `fast vibrato` (depth stays on `vibrato`)
- `harmonics` — `harmonics` (2nd, an octave up), `high harmonics` (3rd),
  `no harmonics`
- `fingering` — the left hand: `open strings` (near the nut, open strings
  ring and take no vibrato), `mid position`, `high position`

New articulation words round it out: `spiccato` (gate 0.3) and `martelé`
(hammered — velocity 112, gate 0.55), plus `scratch` for full bow overpressure.
And the accent's dual, `<`, softens one note (`12<`): under a legato overlap
SWAM turns exactly that — a soft-velocity overlapped note — into a slide.

```yaml
sample: cello
controls: { expression: 11, bow: 74, pressure: 71, vibrato: 1, playmode: 20, tremolo: 21 }
dynamic: p
play:
  - 1: "1 3 5 8"
  - set: crescendo to f over 2      # rides CC11, not just velocity
  - 2: "5 3 [1 5] _"
  - set: tremolo fast, sul ponticello
  - 3: "[3 8] _ _ _"                # a held, shimmering bowed tremolo
  - set: tremolo off, pizzicato
  - 4: "1 5 8 5"
```

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

An expression mark can be written as a bare string in the play list, sitting between measures the way a marking sits in a score:

```yaml
play:
  - 1: "1 2 3 4"
  - "dolce, crescendo to f over 2"
  - 2: "5 6 7 8"
```

`- set: dolce` still works and is never ambiguous, so reach for it if you prefer. A **measure wins any tie**: a string whose tokens all read as notes stays a measure, so `"f"` is the note F rather than *forte* — write `"forte"` or `set: f` for the dynamic.

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

### Repeats

YAML's own anchors write a repeat the way a score does — state the passage once, refer back to it by name:

```yaml
play:
  - 1: &theme "[1 5 12] _ 10 {13 12 10}"
  - 2: "..."
  - 3: *theme      # the repeat: same measure, played again
```

## Example Songs

You can find several complete multi-track songs in the [examples/](file:///Users/felipe/projects/oss/play.yaml/examples/) directory:

- [lost-woods.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/lost-woods.play.yaml): The magical "Lost Woods" theme (Saria's Song) from Ocarina of Time, configured as an infinite loop.
- [take-5.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/take-5.play.yaml): Dave Brubeck's famous jazz standard "Take Five", written in a 5/4 time signature.
- [corridors-of-time.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/corridors-of-time.play.yaml): Chrono Trigger's iconic "Corridors of Time" (Zeal Theme).
- [preciso-me-encontrar.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/preciso-me-encontrar.play.yaml): Cartola's classic Brazilian samba masterpiece.
- [bwv1007.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/bwv1007.play.yaml): J.S. Bach's Cello Suite No. 1 in G major (Prelude).
- [sur-le-fil.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/sur-le-fil.play.yaml): Yann Tiersen's "Sur le fil" for solo violin, from the quiet double-stop theme to the furious hammered climax.
- [sur-le-fil-cello-vst.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/sur-le-fil-cello-vst.play.yaml): the same piece voiced for SWAM Cello 3 — expression-driven dynamics, auto-tremolo, martelé, portamento slides.
- [bwv881.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/bwv881.play.yaml): J.S. Bach's Prelude No. 12 in F minor from The Well-Tempered Clavier.
- [severance.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/severance.play.yaml): The haunting intro theme song of the TV show *Severance*.
- [experiments-cello.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/experiments-cello.play.yaml): A short cello-soundscape composition testing dynamic variations.

To play any of these songs through your speakers:

```bash
node packages/cli/dist/cli.js examples/take-5.play.yaml
```
