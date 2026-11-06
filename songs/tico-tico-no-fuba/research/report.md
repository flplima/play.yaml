# Research report: Zequinha de Abreu, Tico-Tico no Fuba (1917)

Research findings, 2026-11-03. Sources: **[K]** = Eugene Kirpichov classical
guitar engraving MIDI and tablature (`abreu_ticotico.mid`, format 1, 240 tpq,
783 notes, and `abreu_ticotico.txt` from Classtab); **[M]** = MIDIfind
two-track guitar arrangement (`midifind-64805.mid`, format 1, 480 tpq, 1828
notes); **[O]** = Steve Owen concert-pitch ABC lead sheet (The Session #4357,
setting #31070); **[I]** = IMSLP work page and Irmaos Vitale edition metadata
(#211430, Plate I. 620 V.). Concert pitch throughout (C4 = middle C = MIDI 60).

## 1. Provenance, key, meter, tempo, form

- **Composer**: Jose Gomes de Abreu ("Zequinha de Abreu", 1880-1935). Public
  domain worldwide (died 91 years ago). [I]
- **Composition date**: 1917, premiered in Santa Rita do Passa Quatro (Sao
  Paulo) under the working title *Tico-Tico no Farelo*; renamed *Tico-Tico no
  Fuba* in 1931 and published by Irmaos Vitale, Sao Paulo (Plate I. 620 V.). [I]
- **Genre & meter**: Brazilian *choro sapeca* in **2/4** time with continuous
  sixteenth-note (*semicolcheia*) melodic motion over a syncopated two-beat
  *baixaria* bass. [K][I]
- **Tempo**: **♩ = 100 bpm** in **[K]** (400 sixteenths/min); **[M]** encodes
  half-bars as 4/4 at 180 bpm (equivalent to 2/4 at ♩ = 90 bpm); big-band MIDI
  arrangements (`59034.mid`, `103693.mid`) run at ♩ = 108-124 bpm. Standard
  chamber choro tempo is **♩ = 96-108 bpm**. [K][M]
- **Tonal centers across the three classic strains**:
  - **Part A**: **A minor** (home key, with G# leading tone and D# lower
    chromatic neighbor on the E4 pickup). [K][M][O]
  - **Part B**: **C major** (relative major). [K][M][O]
  - **Part C (Trio)**: **A major** (parallel major; note that [M] erroneously
    shifts Part C down a semitone to Ab major at bar 65, whereas [K] and [O]
    preserve the authentic A major). [K][O]
- **Performed form in [K] (84 bars of 2/4 = 168 beats)**:
  - `intro` (bars 1-4, 4 bars): A minor descending flourish to V7 (E7).
  - `part_a1` (bars 5-20, 16 bars): Part A in A minor (bars 5-12 in upper
    octave E4-E5; bars 13-20 answered an octave lower in D#3-D4).
  - `part_a2` (bars 21-36, 16 bars): Repeat of Part A, ending on the A-major
    arpeggio pickup `{a3 c#4 e4}` into the Trio.
  - `trio_c1` (bars 37-52, 16 bars): Part C (Trio) in A major.
  - `trio_c2` (bars 53-68, 16 bars): Repeat of Part C, ending on the A-minor
    pickup `{e4 d#4 e4}` for the da capo.
  - `reprise_a` (bars 69-84, 16 bars): Final restatement of Part A, closing on
    a Picardy-third **A major** chord (`[a2 a3]` + `[c#4 e4 a4]`) in bar 84.
  - *(Note on Part B)*: In [K], the C-major strain is written in the tablature
    coda (`abreu_ticotico.txt` lines 107-142) after the first D.S., while the
    MIDI export (`abreu_ticotico.mid`) follows the compact 84-bar `Intro - A -
    A - C - C - A` concert layout. Both Part B and Part C are documented
    note-for-note below.

## 2. Intro (bars 1-4, A minor, 2/4)

 Verified note-for-note from **[K]**:
- **b1**: `{e5 d5 _ c5} {b4 a4}` (descending A-minor scale from E5).
- **b2**: `{g#4 [g3 b4]} {[f#3 c5] [f3 d5]}` (melody climbs `G#4 -> B4 -> C5 ->
  D5` in contrary motion against chromatic descending sixths `G3 -> F#3 -> F3`).
- **b3**: `[e3 e5] ~` (octave E arrival on beat 1).
- **b4**: `[e2 e4 g#4 e5] {~ e4 d#4 e4}` (full E-major dominant chord on beat 1,
  followed by the three-sixteenth chromatic neighbor pickup `{e4 d#4 e4}`).

## 3. Part A (16 bars, A minor)

Verified across **[K]**, **[M]**, and **[O]**:

| Bar | Harmony | Melody (upper octave, b5-12) | Inner / Chords [K] | Bass (*baixaria*) [K] |
|---|---|---|---|---|
| A.1 (b5) | Am | `{f4 e4 _ a4} {~ e4 d#4 e4}` | `{~ ~ ~ [c4 e4]} ~` | `a2 c3` |
| A.2 (b6) | E7 | `{f4 e4 _ g#4} {~ e4 d#4 e4}` | `{~ ~ ~ [d4 e4]} ~` | `e2 b2` |
| A.3 (b7) | E7 | `{f4 e4 d5 b4} {g#4 e4 d4 c#4}` | `{[g#3 b3] ~ ~ ~} ~` | `e2 e2` |
| A.4 (b8) | Am | `c4 {~ a4 g#4 g4}` | `{~ [e3 a3] _ [e3 a3]} ~` | `a2 c3` |
| A.5 (b9) | Dm | `{f4 a4 d5 _} {_ c5 _ _}` | `{f4 _ _ f4} {a4 _ a4 f4}` | `d3 _` |
| A.6 (b10) | Am/E | `{e4 a4 c5 _} {_ c5 b4 a#4}` | `{e4 _ _ e4} {a4 ~ ~ ~}` | `e2 _` |
| A.7 (b11) | B7 | `{b4 ~ ~ ~} {~ ~ b4 a4}` | `{~ ~ f#3 b3} {d#4 f4 _ _}` | `{~ b2 _ _} ~` |
| A.8 (b12) | E7 | `{g#4 e5 _ [e4 g#4 e5]} ~` | `e4 {~ e3 d#3 e3}` | `e2 e2` |
| A.9 (b13) | Am | `{f3 e3 _ _} {~ e3 d#3 e3}` (8vb) | `{~ ~ ~ [a3 c4 e4]} ~` | `a2 c3` |
| A.10 (b14) | E7 | `{f3 e3 _ _} {~ e3 d#3 e3}` (8vb) | `{~ ~ ~ [g#3 d4 e4]} ~` | `e2 b2` |
| A.11 (b15) | E7 | `{[f3 g#3] e3 _ _} {g3 e3 d3 c#3}` | `{~ ~ d4 b3} ~` | `e2 _` |
| A.12 (b16) | Am | `{c3 [e3 a3] _ [e3 a3]} {~ a3 g#3 g3}` | tacet | `c3 c3` |
| A.13 (b17) | Dm | `{f3 a3 d4 _} {[a3 d4] c4 b3 a3}` | tacet | `{f2 _ _ d3} _` |
| A.14 (b18) | Am/E | `{e3 a3 c4 _} {[a3 c4] c4 b3 a#3}` | tacet | `{e2 _ _ e3} _` |
| A.15 (b19) | E7 | `{b3 e3 g#3 b3} {e4 d4 c4 b3}` | tacet | `e2 _` |
| A.16 (b20) | Am (or A) | `a3` + pickup | `[c4 e4 a4]` (or `[c#4 e4 a4]`) | `{a2 e2} a2` |

- **Register contrast in [K]**: Bars A.1-A.8 state the theme in the bright
  soprano register (`E4-E5`), while bars A.9-A.15 drop the theme one octave into
  the tenor/chalumeau register (`D#3-D4`) with offbeat upper-register chord
  answers (`[a3 c4 e4]`, `[g#3 d4 e4]`, `{d4 b3}`) above it. In our regional
  arrangement, the flute carries the upper-octave statement and offbeat chord
  answers, while the clarinet takes the lower-octave statement (`D#3-D4`).

## 4. Part C - Trio (16 bars, A major)

Verified note-for-note from **[K]** (bars 37-52 and 53-68) and **[O]**:

| Bar | Harmony | Melody (`flute`) [K] | Inner Choro Line (`clarinet`) [K] | Bass (`cello`) [K] |
|---|---|---|---|---|
| C.1 (b37) | A | `{a4 _ _ g#4} {_ _ _ f#4}` | `{~ a3 c#4 _} {~ a3 c#4 _}` | `a2 e2` |
| C.2 (b38) | A | `{f#4 _ _ e4} {_ _ c#4 f#4}` | `{~ a3 c#4 _} {~ a3 _ _}` | `a2 e2` |
| C.3 (b39) | E7/B | `{f#4 _ _ e4} {_ _ c#4 f#4}` | `{~ a3 c#4 _} {~ a3 _ _}` | `b2 e2` |
| C.4 (b40) | E7 | `{f#4 ~ ~ ~} {~ ~ ~ f#4}` | `{~ b3 d4 e4} {_ d4 e4 _}` | `b2 e2` |
| C.5 (b41) | E7 | `{a4 _ _ g#4} {~ ~ ~ ~}` | `{~ b3 d4 _} {~ d4 e4 f#4}` | `b2 e2` |
| C.6 (b42) | E7 | `f#4 {~ ~ ~ f#4}` | `{~ b3 d4 e4} {_ d4 e4 _}` | `b2 e2` |
| C.7 (b43) | E7 | `{a4 _ _ g#4} {~ ~ ~ ~}` | `{~ b3 d4 _} {~ d4 e4 f#4}` | `b2 d3` |
| C.8 (b44) | A/C# | `f#4 ~` | `{~ a3 c#4 e4} {_ a3 c#4 e4}` | `c#3 e2` |
| C.9 (b45) | A | `{a4 _ _ g#4} {_ _ _ f#4}` | `{~ a3 c#4 _} {~ a3 c#4 _}` | `a2 e2` |
| C.10 (b46) | A | `{f#4 _ _ e4} {_ _ c#4 e4}` | `{~ a3 c#4 _} {~ a3 _ _}` | `a2 e2` |
| C.11 (b47) | F#7 | `{f#4 e4 c#4 _} {f#4 e4 _ _}` | `{~ ~ ~ a#3} {~ ~ c#4 a#3}` | `f#2 c#3` |
| C.12 (b48) | Bm | `~ ~` | `{b3 a#3 b3 c#4} d4` | `b2 _` |
| C.13 (b49) | Dm6 / E7 | `{~ ~ ~ e4} {f#4 g#4 a4 b4}` | `{d4 c#4 d4 _} ~` | `d3 e2` |
| C.14 (b50) | A | `{c#5 d5 d#5 e5} {f#5 e5 d5 c#5}` | `~ ~` | `a2 _` |
| C.15 (b51) | E7 | `{b4 a4 g#4 f#4} {e4 d4 c#4 b3}` | `~ ~` | `e2 _` |
| C.16 (b52) | A | `~ {[a3 c#4 b4] ~ ~ ~}` (or `{e4 d#4 e4}`) | `{a3 e3} {~ a3 c#4 e4}` (or `a3 ~`) | `a2 a2` (or `a2 _`) |

## 5. Part B (16 bars, C major - reference extraction)

Extracted from **[M]** (bars 18-33) and **[O]** (`[K:Cmaj]`), cross-checked
against **[K]** tablature (`abreu_ticotico.txt` lines 107-142):
- **Pickup**: `{~ b4 a4 g#4}` (or ascending `{c4 e4 g4 g#4}` in [K] tab).
- **B.1-B.4**: `{g4 c4 e4 g4} {c4 e4 g4 g#4}` (C) · `a4 {f4 b4 a4 g#4}` (Dm/G7)
  · `{g4 b3 d4 g4} {b3 d4 f4 g4}` (G7) · `a4 {e4 c5 c5 c5}` (C).
- **B.5-B.8**: `{c5 b4 b4 b4} {_ a4 a4 a4}` (C/G7) · `{a4 f4 f4 f4} {_ b4 b4 b4}`
  (G7) · `{b4 g4 g4 b4} {a4 g4 f4 a4}` (Dm7 -> G7) · `g4 {~ b4 a4 g#4}` (C).
- **B.9-B.12**: `{g4 c4 e4 g4} {c4 e4 g4 g#4}` (C) · `{a4 f4 _ _} {~ b4 a4 g#4}`
  (G7) · `{g4 b3 d4 g4} {b3 d4 f4 g4}` (G7) · `{a4 e4 _ _} {~ c5 b4 a#4}` (C).
- **B.13-B.16**: `{a4 g#4 a4 b4} {d5 c5 b4 c5}` (F -> F#dim7) ·
  `{e5 g4 c5 e5} {g5 f#5 f5 e5}` (C/G -> A7) · `{d5 c5 b4 a4} {g4 f4 e4 d4}`
  (Dm7 -> G7) · `c4` (C arrival + pickup back to A minor `{e4 d#4 e4}`).

## 6. Note-onset and gate analysis of [K] (`abreu_ticotico.mid`)

- Programmatic inspection of `abreu_ticotico.mid` (`tpqn = 240`, `783` notes)
  confirmed that **all 783 notes start on exact sixteenth-note grid boundaries**
  (`0` non-sixteenth onsets).
- Note durations in `abreu_ticotico.mid` use an 80% guitar articulation gate
  (`48, 96, 144, 192, 384` ticks = `0.8 ×` a sixteenth, eighth, dotted eighth,
  quarter, and half note). Normalizing those 80%-gated durations from 5-tuplets
  (`{a2 _ _ _ ~}`) to standard quarter/eighth/sixteenth tokens in `play.yaml`
  while preserving 100% of `(startBeat, pitch)` pairs raised the
  `play-yaml-fidelity` score from **96.9 / 100** (raw import) to **97.8 / 100**
  (`99%` harmony, `98%` register, `93%` rhythm, `94%` coverage, `100%` tempo,
  `0` weak passages below 85%).
