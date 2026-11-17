# play.yaml reference

The whole format, plus the studio and the command line. New here? Start with the [README](../README.md).

- [The language](#the-language)
- [The built-in orchestra](#the-built-in-orchestra)
- [Playing on your own instruments](#playing-on-your-own-instruments)
- [The studio](#the-studio)
- [The command line](#the-command-line)
- [Example scores](#example-scores)
- [The packages](#the-packages)

## The language

A score is a YAML document, and **the document itself is a track**. The smallest possible score is just something to play:

```yaml
play:
  - "c c g g"
  - "a a g ~"
  - "f f e e"
  - "d d c ~"
```

That's Twinkle, Twinkle Little Star — 80 bpm, 4/4, piano by default (the built-in synth piano).

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
- `c4:` / `c4.` — **duration weights**: a trailing `:` doubles a token's share of the measure, a `.` is a dot (×1.5); they stack and combine (`c4::` = ×4, `c4:.` = ×3). The measure (or group) divides proportionally to the tokens' weights, so `"c4: d4 c4"` in 4/4 is a half note and two quarters, and `"c4. d4."` fills 3/4. Rests and holds take weights too (`~:`, `_:`). Note for YAML: a measure containing `:` must be quoted.
- `5>` — an accent: a trailing `>` stresses that one note (+16 velocity), and stacks for a sforzando (`5>>`). Its dual `5<` softens. Both mark whole chords too — `[1 5]>` hits every note in the chord.
- `[c e g]~` — a **rolled** chord (arpeggiando/strum): notes speak one after another in **written order** and end together, so `[c e g]~` breaks bass-first like a string player's triple stop or a guitar down-stroke, and `[g e c]~` strums the other way. `~~` doubles the spread for a slower, more deliberate strum. The spread defaults to 0.03 beats per note and is tuned with the `strum:` prop or a `set: strum 0.06` clause; it auto-clamps inside fast subdivisions. Combines with accents: `[c e g]>~`.
- `voices: 2` (prop, or `set: voices 2`) — the sustain limit inside rolled chords, for instruments whose excitation is physically limited: a bow holds two strings, so with `voices: 2` a rolled triple stop releases its bass as the top pair lands, exactly how a cellist breaks the chord — and exactly what a two-voice physical model needs to voice all three notes instead of dropping one. `voices all` lifts the limit (piano, guitar, samplers).
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

### Sections & song form

Instead of one long `play:` per track, a song can declare its **form** as named
sections that play in declaration order, with the parallel instrument parts
*inside* each section:

```yaml
tracks:                # the instruments — props only, no music here
  sax: { sample: flute, dynamic: mezzoforte }
  drums: { kit: acoustic }

sections:
  intro:
    loop: false        # plays once
    drums: { play: ["bd hh sd hh"] }
    sax:
      wait: 3          # rests 3 measures, then enters — the pickup bar
      play: ["~ ~ ~ {1 _ 3}"]
  theme:               # loop: true is the default…
    sax: { play: ["5 _ 3 _", "4 _ 2 _"] }
    drums: { play: ["bd hh sd hh", "bd hh sd oh"] }
  chorus:              # …so theme + chorus cycle forever
    sax: { play: ["8 _ 6 _", "5 _ _ _"] }
    drums: { play: ["bd hh sd hh", "bd hh sd {sd sd}"] }
```

- **`loop`**: `true` (default) marks the part of the song that repeats forever —
  those sections must be the tail of the file, and playback cycles them after
  everything before plays once. `loop: N` plays a section N times in a row
  (`0` skips it, handy for muting); `loop: false` plays it once.
- **`wait: N`** (on a section or a track inside one): rest N measures before
  entering. Waits apply **once** — on `loop: N` only the first pass waits, and
  a forever-loop with waits compiles the waited pass *before* the loop point so
  the cycle itself is clean. Staggered intros stop being bar arithmetic.
- A section's length is its longest part (waits included); tracks absent from
  a section simply rest through it. Numbered measures inside a section are
  **section-relative**.
- **Inline repeats** (any `play:` list, sections or not): an `Nx:` item plays
  its measures N times, so a vamp is written once —

  ```yaml
  play:
    - 8x: "{eb2 _ [gb3 bb3 eb4]} {~ ~ eb2} [gb3 bb3 eb4] bb2 [f3 ab3 db4]"
    - 2x: ["1 2 3 4", "5 4 3 2"]   # a list works too; repeats nest; 0x skips
  ```
- Per-section overrides are allowed for the directive props (`velocity`,
  `gate`, `rubato`, `scale`, `octave`, `tempo`, `measure`, `strum`, `voices`, `set`) —
  instrument identity (`sample`, `kit`, `channel`, `controls`) stays on the
  top-level track.
- The compiled song carries `loopStartBeats`: the web player loops the cycle
  (intro plays once; turn Loop off for a single pass), the CLI's `--loop`
  restarts from it, and `.mid` exports write a `loopStart` marker meta-event.

See `songs/tico-tico-no-fuba/tico-tico-no-fuba.play.yaml`: an intro, then
the sections in form order with staggered `wait` entries.

Built-in sounds, each mapped to a General MIDI program for `.mid` export. The orchestra (Virtual Playing Orchestra, fetched on demand): solo `violin`, `viola`, `cello`, `contrabass`, `bass` (plucked until the score says `arco`), `harp`; `flute`, `piccolo`, `alto-flute`, `oboe`, `english-horn`, `clarinet`, `bass-clarinet`, `bassoon`, `contrabassoon`; `trumpet`, `horn`, `trombone`, `bass-trombone`, `tuba`; `celesta`, `glockenspiel`, `xylophone`, `vibraphone`, `tubular-bells`, `timpani`; `choir`, `choir-female`, `choir-male`; the sections `violins`, `violas`, `cellos`, `basses`, `flutes`, `oboes`, `clarinets`, `bassoons`, `trumpets`, `horns`, `trombones`; and the families `strings`, `woodwinds`, `brass`. `ocarina` rides the flute. The synth presets: `piano`, `epiano`/`keys` (an FM electric piano), `pad`, `lead` (a sawtooth), and any name the orchestra does not know.

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

- **Kits**: `808` is a synthesized electro kit. `acoustic` and `percussion` play the orchestra's sampled percussion when the Virtual Playing Orchestra is installed, and fall back to the synthesized kit when it is not. All of them export identically (see below).
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

- **Dynamics** — spelled out: `pianississimo` `pianissimo` `piano` `mezzopiano` `mezzoforte` `forte` `fortissimo` `fortississimo`, or in plain English (`quiet`, `loud`, `louder`, `softer`). The abbreviations (`p`, `mf`, `ff`) are not accepted: a bare `f` is the key of F.
- **Gradual dynamics** — `crescendo`, `diminuendo`, with an optional target and span: `crescendo to fortissimo over 2`. Notes inside the span interpolate.
- **Tempo** — `grave` `largo` `lento` `adagio` `andante` `moderato` `allegretto` `allegro` `vivace` `presto`
- **Gradual tempo** — `ritardando`, `rallentando`, `allargando`, `accelerando`, `stringendo`, plus `slower` / `faster`; each takes an optional target and span (`allargando to adagio over 3`, `rit. over 2`). `a tempo` returns to the tempo the track started at.
- **Relative tempo** — `più lento` (or `piu lento`), `meno mosso`, `più mosso`: an immediate section-boundary shift relative to the running tempo.
- **Meter** — a bare time signature (`2/4`, or `measure 2/4`) changes the measure length from that point on, so a score can interpolate a 2/4 bar inside 4/4 the way printed music does.
- **Articulation** — `staccatissimo` `staccato` `portato` `detached` `tenuto` `legato` (or `short` / `smooth`)
- **Rubato** — `rubato` `poco rubato` `molto rubato` (or `rubato 0.4`); `a battuta`, `tempo giusto` and `senza rubato` play strictly again
- **Character** — `dolce` `cantabile` `espressivo` `sotto voce` `leggiero` `grazioso` `marcato` `pesante` `maestoso` `agitato` `tranquillo`, each standing for a dynamic and a bowing together
- **Playing technique** — bow position `sul tasto` `flautando` `poco sul tasto` `ordinario` `poco sul ponticello` `sul ponticello` `molto sul ponticello`; bow pressure `sfiorando` `light bow` `normal bow` `heavy bow` `premuto`; vibrato `senza vibrato` `poco vibrato` `vibrato` `molto vibrato`
- **The mix** — the room `dry` `room` `hall` `church` `cathedral`; chorus `light chorus` `chorus` `celeste` `ensemble` `wide chorus`; position `hard left` `pan left` `pan centre` `pan right` `hard right`; the fader `fade out` `fade in`. [More below.](#the-mix-volume-pan-reverb-chorus)

```yaml
dynamic: mezzoforte
articulation: tenuto
play:
  - 1: "1 2 3 4"
  - set: dolce, crescendo to forte over 2
  - 2: "5 6 7 8"
  - set: legato, stringendo over 1
  - 3: "1 2 3 4"
  - set: allargando to adagio over 2, maestoso
  - 4: "8 ~ ~ ~"
```

The numeric forms (`velocity 88`, `gate 1.05`, `tempo 60 over 2`) all still work — the words are shorthands over them. Note that a bare `f` is the key of F, never *forte*: write `forte` for the dynamic.

### Articulation (`gate`)

`gate` is the fraction of its slot a note sounds. Below 1 the note releases before the next begins; **above 1 the notes overlap**, which is how a physical-model instrument is told to slur rather than re-attack each note:

```yaml
gate: 0.9              # default — detached
play:
  - 1: "1 2 3 4"
  - set: legato        # gate 1.05: notes overlap into the next slot
  - 2: "5 6 7 8"
  - set: detached      # back to 0.9 — also: staccato (0.4), or `gate 1.2`
```

### Rubato (`rubato`)

Nobody plays to a click. `rubato` — "stolen time" — makes the beat breathe: the
notes after a downbeat lean late, then hurry to arrive on the next one. It is a
depth from 0 (strict) to 1 (very free), and the words set it too:

```yaml
rubato: 0.5            # or the mark: `set: rubato` / `molto rubato` / `poco rubato`
play:
  - 1: "1 2 3 4"
  - set: a battuta     # strictly in time again (also: senza rubato, tempo giusto)
  - 2: "5 6 7 8"
```

What makes this rubato rather than a tempo change: **time stolen inside a bar is
paid back by the bar line.** The shift is a sine over the measure, so it vanishes
at both ends — bars never drift and every track stays together, which is what
lets two players breathe as one. A slow arch across four bars varies the depth so
consecutive bars don't breathe in lockstep, and the curve stays monotonic at
every depth, so notes stretch but never reorder or collide. It is a pure function
of the bar number — no randomness — so a score always compiles to the same
timeline.

Reach for `tempo`/`ritardando` when the music genuinely changes speed; reach for
`rubato` when it keeps its pulse but refuses to be mechanical.

### Instrument controls (CC)

The technique words above drive `bow`, `pressure` and `vibrato`, which default to the conventional CCs 74, 71 and 1 — so they work with nothing declared:

```yaml
sample: cello
play:
  - 1: "1 2 3 4"
  - set: sul tasto, molto vibrato
  - 2: "5 6 7 8"
```

Physical-model instruments often let you assign Bow Position and Bow Pressure to any CC on their MIDI-mapping page — so `controls:` retargets them. A control can also declare a range, which narrows the band or, by putting `min` above `max`, inverts a mapping that runs the other way:

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

### Transposing a line onto another instrument

`transpose:` shifts every pitch a track sounds, in semitones, after the notes
are read. `octave:` cannot do this — it is only the octave a *bare* note name
defaults to, so a line written in absolute pitches ignores it:

```yaml
voice:
  transpose: -12    # Gounod's violin melody, played by a cello
  play: ["e5 _ _ _", "f5 _ _ _"]
```

The written notes stay as the composer put them, so the score still reads
against the source, and the register is one number to change instead of an
edit per note. Kit tracks are left alone — a drum token names a percussion
key, and shifting it would pick a different instrument.

### Letting go: `release`

A bowed or blown line does not stop dead at a rest. On a physical model the
easing off *is* the expression control falling away, and a note-off at full
bow speed sounds like tape being cut. `release:` rides the track's
`expression` down over the tail of the last note before every pause, then puts
it back for the next entry:

```yaml
voice:
  controls: { expression: { cc: 11, range: [78, 127] } }
  release: 0.5                        # taper over the last half-beat
  # release: { over: 0.75, to: 0.2, gap: 1 }   # longer, not quite to nothing,
  #                                            # and only into pauses of a beat+
```

Only real silence counts — notes that merely change, including legato
overlaps and slurs, are untouched. `to` is a position along the expression
control's own range, so `to: 0` on the declaration above releases to 78, the
quietest that instrument speaks at, rather than to nothing. Needs an
`expression` control; without one there is nothing to ease off.

### The mix: volume, pan, reverb, chorus

Past the instrument itself are the four controls every General MIDI device
has. Unlike `bow` or `pressure` — where every sampler picks its own CC — these
are fixed by the standard, so they need no `controls:` block:

| control | CC | words |
| --- | --- | --- |
| `volume` | 7 | `fade out`, `fade in`, `full volume` |
| `pan` | 10 | `hard left`, `pan left`, `pan centre`, `pan right`, `hard right` |
| `reverb` | 91 | `dry` / `secco`, `small room`, `room`, `stage`, `reverb`, `hall`, `church`, `cathedral` |
| `chorus` | 93 | `no chorus`, `unda maris`, `light chorus`, `chorus`, `celeste` / `voix celeste`, `ensemble`, `wide chorus` |

```yaml
tracks:
  violin: { sample: violin, set: "pan left, hall" }
  cello:  { sample: cello,  set: "pan right, room" }
  organ:  { sample: piano,  set: "cathedral, voix celeste" }
```

They behave like any other control: drift them with a span (`fade out over 4`,
`reverb to 90 over 8`), address them numerically (`pan 20`, `cc91 64`), or
retarget them under `controls:` if your instrument disagrees.

Two things worth knowing:

- **`volume` is not a dynamic.** `piano` is how the part is *played* — it
  drives velocity and expression, the bow slowing down. `fade out` is the
  channel being pulled down under it. They multiply, and you want both words
  for the different jobs.
- **A drift starts from wherever the control last sat**, so a fade-in needs
  somewhere to fade from: `set: volume 0` first, then `fade in over 4`.

The room is *one* room shared by every track — `reverb` is a send into it, the
way a desk works, not a reverb of its own per track. So the words say how far
back in the hall a player stands, and tracks sharing a space is what makes
them sound like they are in one. It renders identically in the browser, the
offline MP3 export, the CLI, and any track routed out to
MIDI sends the same CCs to the hardware or plugin instead.

### Physical-model instruments

Modelled instruments (bowed strings, winds, brass that are synthesised from
the physics of the player rather than sampled) expose the whole player, and
the DSL speaks that language. Beyond `bow`, `pressure` and `vibrato`, these
named controls exist for words to land on — none has a conventional CC, so
map them in `controls:` to whatever you assign on the instrument's
MIDI-mapping page:

- `expression` — **the big one.** A modelled instrument is silent until its
  expression control (default CC11) moves: it is the bow speed or the breath,
  and with it the real loudness. Declare it and every dynamic in the score
  drives it: `mezzoforte` emits one CC, `crescendo to fortissimo over 4` a ramp of CCs at
  eighth-note steps, and the track opens with the starting dynamic so the
  model sounds at all. Note velocity stays what a modelled string wants it
  to be — attack character.
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
a modelled string turns exactly that — a soft-velocity overlapped note — into
a slide.

```yaml
sample: cello
controls: { expression: 11, bow: 74, pressure: 71, vibrato: 1, playmode: 20, tremolo: 21 }
dynamic: piano
play:
  - 1: "1 3 5 8"
  - set: crescendo to forte over 2  # rides CC11, not just velocity
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
  - "dolce, crescendo to forte over 2"
  - 2: "5 6 7 8"
```

`- set: dolce` still works and is never ambiguous, so reach for it if you prefer. A **measure wins any tie**: a string whose tokens all read as notes stays a measure, so `"f"` is the note F rather than *forte* — write `"forte"` or `set: forte` for the dynamic.

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

### Generators (algorithmic variation)

Generators are named play-list items that expand into ordinary measure
strings at compile time — data, not operators, and fully deterministic: the
same file always compiles to the same MIDI. Change `seed:` to browse
variations. (Design and rationale: [docs/generative-design.md](generative-design.md);
full tour: [examples/generative-lab.play.yaml](../examples/generative-lab.play.yaml).)

```yaml
seed: 11                 # drives every stochastic feature (default 1)

tracks:
  drums:
    kit: acoustic
    play:
      - spread:                    # euclidean rhythm: layers over a step grid
          steps: 16
          bd: 5                    # 5 kicks spread evenly over 16 steps
          hh: [13, 2]              # [pulses, rotate]
      - 4x:
          - alternate:             # a different bar on each pass, cycling
              - "hh hh hh hh hh hh hh hh"
              - "hh hh hh hh hh hh {hh hh hh} sd<"
  keys:
    humanize: 0.4                  # seeded timing/velocity looseness
    play:
      - arp: {chord: Dm7, mode: updown, steps: 8}   # chord tones over the bar
  lead:
    set: chance 0.9                # each note sounds with probability 0.9
    play:
      - walk: {steps: 8, start: 1, span: [-2, 9]}   # drunk walk on the scale
```

- `spread:` — Bjorklund/Toussaint euclidean rhythms; every key but `steps` is
  a token (drum, note or degree) with `pulses` or `[pulses, rotate]`; layers
  landing together merge into chords. Works on melodic tracks too.
- `alternate:` — per-pass variation inside `Nx:` repeats and `loop: N`
  sections (a forever-looping tail plays one fixed body).
- `arp:` — `chord:` (via chord-scales: `Dm7` → D dorian tones) or explicit
  `notes:`; modes `up down updown downup converge diverge random`.
- `walk:` — seeded walk over the current scale in degrees, so `scale:` and
  inline `==chords==` re-key it; later `walk:` items continue the line.
- `chance` / `humanize` / `seed` — track props, `set` clauses and inline
  `||chance 0.5||` fences all work; dropped notes keep their time slot.

Generated bars don't highlight in the studio editor (there's no source text
to point at) — everything else about them behaves like hand-written measures.

## The built-in orchestra

The studio's own sound is the [Virtual Playing Orchestra](http://virtualplaying.com)
(VPO, free, SFZ). Nothing is bundled: the dev server serves the library off
your own disk at `/vpo/`, the sampler parses the `.sfz` program a track needs
and downloads only the samples that track's notes reach.

**Installing it is optional.** Without the library every track plays on the
synth presets (`piano`, `keys`, `pad`, `lead`, and a synthesized drum kit),
and the studio says so in the status bar. To hear the sampled orchestra:

1. Download *Virtual Playing Orchestra 3* from
   [virtualplaying.com](http://virtualplaying.com) and unpack it.
2. Put it at `~/samples/VPO/Virtual-Playing-Orchestra3`, or point
   `PLAY_YAML_VPO` at wherever it lives (the dev server and the CLI both
   read that variable).

`sample: cello` is a solo cello with its pizzicato, tremolo and staccato
programs switched in by the score's `pizzicato`/`tremolo` words and by note
length; `violins`, `horns` and the other plurals are the sections;
`strings`, `woodwinds`, `brass` are the whole families; kit tracks land on
the orchestral percussion key by key and fall through to the synthesized kit
for what an orchestra does not own. The sampler honours the library's
controller opcodes, so the score's CC stream — expression, the mod wheel's
attack length and layer crossfades, the sustain pedal — shapes the
recordings the way it would in a DAW. VPO has no piano: `piano`, `keys` and
the synth names stay on the oscillator presets. `core/src/vpo.ts` is the
catalogue, `core/src/sfzSampler.ts` the engine.

## Playing on your own instruments

A score says what to play; the studio's **MIDI** output mode and
`play-yaml-play --midi` say what to play it *on*. Every track goes out as
plain MIDI — notes, the score's control changes (expression, bow, pedal, the
mix) and the tempo map — on the channel you pick, to any device the browser
or the OS can see: a hardware synth, a DAW, a standalone software instrument
on a virtual MIDI port. The routing panel lists the score's instruments and
lets you send each to a port and channel, with a test note per mapping.

## The studio

A browser-based editor & player lives in `packages/web`. The dev server runs in the background under [pm2](https://pm2.keymetrics.io/):

```bash
npm run dev          # start (or restart) the dev server on :5173
npm run logs         # print the last 100 log lines
npm run logs:follow  # stream logs live
npm run dev:stop     # stop the dev server
```
It offers a YAML editor with syntax highlighting, the bundled example scores (editable in-session, never persisted), opening/saving local `.play.yaml` files via the File System Access API, playback on the built-in orchestra, and per-instrument routing to your MIDI devices via WebMIDI (with a per-mapping test note). The panel picks the output: **Built-in** renders everything in the browser using the Web Audio API and the VPO sample library, while **MIDI** routes notes and CC events to your hardware or virtual MIDI devices. The **⬇ MIDI** button exports the compiled score as a Standard MIDI File (`.mid`), and the **⬇ MP3** button renders the score offline with the built-in sounds (tempo map included) and downloads it as an MP3.

The **Score** tab shows the score as sheet music on A4 pages. While the song plays, the sounding notes turn red and the page follows them. The **⬇ PDF** button downloads those pages as a PDF. The engraving library is a 0.4 MB download, fetched the first time you open the tab.

Two studio behaviors worth knowing:

- **Live editing (hot-swap)**: edit the score *while it plays* — any change that compiles splices into the running transport at an upcoming bar boundary, Sonic-Pi-style, with no Stop→Play. The status bar reports the bar the update landed on; held MIDI notes from the old take are released on the barline.
- **🔗 Share**: copies a link that carries the whole score in the URL fragment (deflate-compressed, base64url) — no server, nothing uploaded; opening the link restores the score exactly. Editing after sharing clears the stale hash from the address bar.

The built-in engine is expressive: every track gets a control bus that performs
the score's CC stream — expression (CC11) swells through held notes, vibrato
depth/rate drive a real LFO, bow position (CC74) morphs the tone from
fingerboard-dark to bridge-nasal, and `pizzicato` / `tremolo` switch playing
styles. Orchestral tracks play on the Virtual Playing Orchestra (see above),
whose programs choose their recordings per note from the same stream; the
synth names keep the oscillator presets, shaped by the same bus.

## The command line

Build the packages first:

```bash
npm run build
```

### Compile `play.yaml` to MIDI
You can compile `.play.yaml` scores into Standard MIDI Files:

```bash
node packages/cli/dist/export.js --input examples/my-score.play.yaml --output track.mid
```

### Print a score as sheet music
The same command writes a PDF, or MusicXML for another notation program. The output's extension picks the format:

```bash
node packages/cli/dist/export.js --input examples/fur-elise.play.yaml --output fur-elise.pdf
node packages/cli/dist/export.js --input examples/fur-elise.play.yaml --output fur-elise.pdf --paper letter
node packages/cli/dist/export.js --input examples/fur-elise.play.yaml --output fur-elise.musicxml
```

What gets printed:

- **Title and composer**: `title:` at the top of the first page, and `composer:` under it on the right (`composer: "Johann Sebastian Bach"`).
- **The notes as written**: full note values, with no `gate`, `humanize`, `rubato` or strum. Ties, dots, tuplets, rests, beams and up to four voices per staff.
- **Key**: `key: g major` names the key signature. Without it, the first `scale:` gives the key, and a score with neither prints with no key signature. A `scale:` set mid-piece changes what the degrees mean, never the printed key. To print real key changes, give `key:` the bars where they happen: `key: { 1: db major, 37: e major, 43: db major }`.
- **Meter and tempo**: changes are printed where they happen.
- **Keyboards**: tracks that share a keyboard `sample:` (piano, organ, harp and friends) print as one part on a grand staff. A track named `rh`, `right` or `upper` goes on the upper staff, and `lh`, `left` or `lower` on the lower one. Other names are split around middle C. A track named `pedal` gets a staff of its own.
- **Drums**: a `kit:` track prints on a percussion staff, with x noteheads for hats and cymbals.
- **Sections and repeats**: written out in full, with no repeat signs.

What is not printed yet: dynamics and technique words, slurs, lyrics, chord symbols and repeat signs. Transposing instruments are written at sounding pitch.

### Import a `.mid` into a score

The inverse direction: a Standard MIDI File becomes a `.play.yaml`, and
`--verify` proves it did not lose anything by compiling the result and diffing
it against the source file note by note.

```bash
node packages/cli/dist/import-midi.js song.mid -o songs/x/x.play.yaml --verify
# verify: source 851 notes | score 851 | missing 0 extra 0 | moved 0 (max 0.0000 beat) | EXACT ✓
```

It reads the file's meter, key, tempo, track names and program changes, splits
each channel into monophonic-with-chords voices (a play.yaml track holds a
chord but not two independent rhythms), and writes GM channel 10 as a `kit:`
track in drum tokens. Recorded playing needs `--snap 48 --legato`, and the
report then says `COMPLETE (quantized)` with the largest onset it moved —
notes moving is what `--snap` is for, notes vanishing never is.

This is the workflow the song projects in `songs/` were built with;
`docs/audio-and-midi-import.md` covers it, and the audio → MIDI stage in front
of it.

### Play `play.yaml` through speakers
You can play a score in real-time through your speakers using the Web Audio synthesizer:

```bash
node packages/cli/dist/cli.js examples/my-score.play.yaml
```

Or run the preconfigured sample song play command:

```bash
npx play-yaml-play examples/my-score.play.yaml
```

### Score a `play.yaml` against a reference recording

`play-yaml-fidelity` renders a score to MIDI, compares it against a reference
`.mid` (say, a version of the same piece found online), and prints a 0–100
fidelity score with the weakest passages flagged:

```bash
node packages/cli/dist/fidelity.js songs/tico-tico-no-fuba/tico-tico-no-fuba.play.yaml reference.mid
```

The comparison is musical, not byte-exact: it aligns the two in beat space
window by window (so meter changes, rubato and cut sections are followed, not
punished), auto-detects the best key-transposition, folds octaves for the
harmony score, and breaks the result into sub-scores — harmony (pitch-class
match), register (exact octave), rhythm (onset alignment), coverage (how much
of the original the arrangement spans) and tempo. Pass `--json` for the full
per-window report, or `-o out.mid` to also keep the generated MIDI.

## Example scores

Complete scores live in the [examples/](../examples/) directory. All of them are
public-domain compositions or original material:

- [bwv1007.play.yaml](../examples/bwv1007.play.yaml): J.S. Bach's Cello Suite No. 1 in G major (Prelude) — the theory edition, written in scale degrees over inline chord-scales.
- [bwv846.play.yaml](../examples/bwv846.play.yaml): Bach's Prelude in C major from The Well-Tempered Clavier, with pedalling and natural dynamic swells.
- [bwv881.play.yaml](../examples/bwv881.play.yaml): Bach's Prelude No. 12 in F minor from The Well-Tempered Clavier.
- [clair-de-lune.play.yaml](../examples/clair-de-lune.play.yaml): Debussy's *Clair de lune*, 9/8 with a tempo map.
- [fur-elise.play.yaml](../examples/fur-elise.play.yaml): Beethoven's *Für Elise*.
- [nocturne-op9-no2.play.yaml](../examples/nocturne-op9-no2.play.yaml): Chopin's Nocturne Op. 9 No. 2 in 12/8.
- [twinkle.play.yaml](../examples/twinkle.play.yaml): the smallest complete score — start here.
- [drum-lab.play.yaml](../examples/drum-lab.play.yaml): a tour of `kit:` tracks — grooves and fills, son clave with congas, 808 trap hats.
- [generative-lab.play.yaml](../examples/generative-lab.play.yaml): a tour of the generators — `spread:`, `alternate:`, `arp:`, `walk:`, `chance`, `humanize`.
- [my-score.play.yaml](../examples/my-score.play.yaml): the spec's two-track reference score.

To play any of these through your speakers:

```bash
node packages/cli/dist/cli.js examples/bwv846.play.yaml
```

### Song projects

Larger transcriptions live in [songs/](../songs/) as project directories —
score, `README.md`, and a `research/` folder recording where every fact came
from (see [docs/song-workflow.md](song-workflow.md)): Bach cantata
movements and keyboard works (BWV 106, 528, 784, 881), the Bach/Gounod
*Ave Maria*, Debussy's *Clair de lune*, and Zequinha de Abreu's
*Tico-Tico no Fubá*. Each is checked against a reference MIDI with
`play-yaml-fidelity`; the scores land between 92 and 98 out of 100.

Only compositions in the public domain are published here, and only the
transcription and the analysis are committed — no audio, MIDI or
third-party sheet music. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the rule.

## The packages

This is a monorepo managed with npm workspaces:

- `packages/core/`: The `play.yaml` engine — dependency-free and environment-free (no Node or DOM APIs), so it runs identically in Node and browsers. Layered as: `theory` (pitch/scale/meter math) → `vocabulary` (dynamics, articulations, tempo marks, techniques, named controls) → `set` (the `set:` shorthand) → `tokens` (measure tokenizing) → `song` (the compiler), plus the zero-dep YAML subset (`yaml`), the `.mid` encoder (`exporter`), the sheet music model and its MusicXML writer (`notation`, `musicxml`), the `.mid` decoder + musical fidelity comparator (`fidelity`), beat→seconds tempo mapping (`time`), the Web Audio synth presets (`synth`), and the SFZ parser and sampler that play the orchestra (`sfz`, `sfzSampler`, `vpoCatalogue`, `vpo`, see above). Everything re-exports from the package root.
- `packages/cli/`: Command-line tools built on core: `play-yaml` exports scores to `.mid`, MusicXML or a PDF of sheet music; `play-yaml-play` plays them through the speakers (rendered offline by `packages/node-audio/`) or streams live MIDI — notes, the score's CC automation and the tempo map — to a virtual MIDI port; `play-yaml-fidelity` scores a `.play.yaml` against a reference `.mid` and flags where they diverge.
- `packages/web/`: The browser studio (Vite/React): CodeMirror editor with played-note highlighting, a sheet music view and PDF export (engraved by [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org)), Tone.js transport playback on the built-in orchestra & synth, and per-instrument WebMIDI routing to any MIDI device or virtual instrument. Consumes core by source, so core edits hot-reload without a rebuild. The interface is [shadcn/ui](https://ui.shadcn.com) (Radix primitives, vendored into `src/components/ui/`) on Tailwind v4; every colour comes from the tokens in `src/index.css`, which hold a dark palette in `:root` — the studio is a dark-only tool.
