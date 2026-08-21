# BWV 106 — research report

Researched 2026-08-06. Replaces an earlier report that asserted facts without
sources; every claim below is traceable to the citations in `sources.md`.

## The work

**Gottes Zeit ist die allerbeste Zeit, BWV 106**, known as the *Actus
tragicus*. An early sacred cantata written for a funeral in **Mühlhausen,
1707–08**, when Bach was 22. Scored for four vocal parts (SATB) and a small
consort: **two alto recorders, two viole da gamba, and continuo** — no
violins, no oboes. Roughly 23 minutes.

## Movement structure

| No. | Title | Type | Scoring | Key | Meter | Tempo |
|---|---|---|---|---|---|---|
| 1 | Sonatina | instrumental | 2 rec, 2 gamba, bc | **E♭ major** | common | **Molto adagio** |
| 2a | Gottes Zeit ist die allerbeste Zeit | chorus | SATB, 2 rec, 2 gamba | E♭ major → C minor | common → **3/4** → common | – / Allegro / Adagio assai |
| 2b | Ach, Herr, lehre uns bedenken | arioso (tenor) | T, 2 rec, 2 gamba | C minor | – | Lento |
| 2c | Bestelle dein Haus | aria (bass) | B, 2 rec, 2 gamba | C minor | 3/8 | Vivace |
| 2d | Es ist der alte Bund / Ja, komm, Herr Jesu | chorus & solo | ATB + S, 2 rec, 2 gamba | **F minor** | common | Andante |
| 3a | In deine Hände befehl ich meinen Geist | aria (alto) | A + continuo (see below) | **B♭ minor** | common | – |
| 3b | Heute wirst du mit mir im Paradies sein | arioso & chorale | B, A, 2 gamba | C minor | common | – |
| 4 | Glorie, Lob, Ehr und Herrlichkeit | chorus | SATB, 2 rec, 2 gamba | E♭ major | common | – / Allegro |

The cantata is symmetrical: the first half is Old-Testament death, the second
half New-Testament promise, with 3a opening the second half.

## What the previous scores in this repo got wrong

The three tracked movements were written from invented material. Measured
against the table above:

- **Sonatina** — was headed "E-flat major / C minor" at ♩=54 with five parts of
  scale-shaped filler. The movement is in E♭ major throughout, and its actual
  texture is repeated quavers in the gambas under a recorder duet that does
  not enter until bar 4. None of the written notes were Bach's.
- **Gottes Zeit (2a)** — was a homophonic eight-bar chorale in 4/4. The real
  movement runs common time → **3/4** (Allegro) → common time (Adagio assai)
  and moves from E♭ major to C minor. It is a chorus, not a chorale harmonisation.
- **In deine Hände (3a)** — was headed **C minor** and scored alto + gamba +
  organ, with the gamba playing block arpeggios in semiquavers. The aria is in
  **B♭ minor**, and in the score it has no gamba at all: alto and continuo
  only (see the correction below).

Also: every score used `sample: organ`, which is not a sample the DSL knows —
it silently fell through to the default synth.

## Where the notes come from

All three tracked movements are imported from **Ramon Casadesus-Masanell's
engraving of the complete cantata** (IMSLP #752782, "Engraving files", 2021,
CC BY-NC-SA 4.0), which ships MuseScore, MusicXML and MIDI exports of all four
movements. Bach's notes are public domain; the engraving is not, so nothing
from it is committed — only the transcriptions, per the repo's copyright rule.

`play-yaml-import --verify` reports **exact** for all three: every source note
appears in the score at the same beat, none missing, none invented, none moved.

| movement | bars | parts | notes |
|---|---|---|---|
| 1. Sonatina | 1–20 | 5 | 753 |
| 2a. Gottes Zeit | 1–47 | 9 | 1759 |
| 3a. In deine Hände | 1–24 | 2 | 463 |

The engraving's piano-reduction staves — which double the very parts above
them — are excluded with `--tracks`, or they would import as a second copy of
the whole texture.

### Two corrections to the reference literature

- **3a is alto and continuo alone.** Wikipedia (and others) list the aria as
  "alto solo with 2 violas da gamba". In the score the gambas do not play a
  note until bar 39, which is inside **3b** ("Heute wirst du mit mir im
  Paradies sein"); the aria proper is bars 1–24, and the bass soloist of 3b
  enters at bar 25, exactly where the tempo changes.
- **The key signature is two flats, not three.** Every movement is written
  with the old "Dorian" signature — one flat fewer than modern practice —
  with the missing accidentals written in. That is why an E♭ major movement
  shows written a-flats, and why B♭ minor in 3a needs so many.

### Cross-check: an independent reconstruction

Before the engraving was found, the Sonatina was rebuilt from two other
public-domain renderings, and the two results agree — which is worth recording
because it is the strongest evidence that the import is right:

- **Tennent's five-part arrangement** is exactly five lines — the five original
  parts — and is perfectly quantised (0.0000 beat deviation from a sixteenth
  grid), but the whole body of it is transposed from E♭ major to C major so it
  sits on recorders.
- **Gouin's organ transcription** is at Bach's own pitch and key, but is a
  humanised Finale rendering (0.025 beat mean deviation) that collapses the
  five parts onto three staves.

Aligning them note by note showed that a **single uniform shift of −9
semitones** returns Tennent's file to the original: in the four upper parts,
159/156, 124/121, 160/160 and 159/157 notes voted for that shift over any
other octave. Compared afterwards against the Casadesus engraving, that
reconstruction was **note-identical in gamba 1 (160/160), recorder 2 (121/121)
and 154/156 of recorder 1** — the handful of differences being ornaments the
engraving writes out and an octave in the continuo, where a violone doubles
16′. Two independent routes to the same notes.

The reconstruction placed every part in its idiomatic range —

| part | range | |
|---|---|---|
| recorder 1 | G♯4–C6 | alto recorder |
| recorder 2 | G♯4–C6 | |
| gamba 1 | A♯3–A4 | |
| gamba 2 | F3–F4 | |
| continuo | G♯2–C4 | bass clef, as written |

— and gives a pitch-class histogram squarely in E♭ major: B♭ 130, E♭ 128,
A♭ 102, F 102, G 82, C 76, D 72, with D♭ 31 and E 14 as the chromatic colour.

**Entries.** Continuo from bar 1, gambas from bar 1¼, recorders from bar 4.
Both sources agree, and Gouin's engraving shows three bars of rests on the
upper staff.

**Texture.** The gambas repeat quavers on a single pitch for bar after bar;
that pulse is the whole accompaniment. The recorders move in near-parallel
thirds and sixths, recorder 2 shadowing recorder 1.

**Verification of that reconstruction.** `play-yaml-fidelity` against Gouin's
independent file: **90.2/100**, harmony **98%**, rhythm 85%, coverage 92%,
same key. Register 79%, because his pedal is a 16′ stop an octave below
written — expected, not an error. The score now in the repo comes from the
Casadesus engraving instead, which is exact.

**Tempo.** No metronome mark exists; "Molto adagio" is the only instruction.
The three renderings consulted set it at ♩=50 (Casadesus), 40 (Tennent) and 33
(Gouin, with a closing ritardando). The score follows its source: 50.

## Section boundaries, from the engraving's own markings

Movement 2 is one file containing four sections; movement 3 contains two. The
boundaries below are read from the MusicXML's tempo text and meter changes,
not guessed:

| | starts | meter | tempo | text |
|---|---|---|---|---|
| **2a** | m1 | 4/4 | 80 | "2. (Coro)" |
| | m7 | **3/4** | 142 | *Allegro* |
| | m41 | **4/4** | 56 | *Adagio assai* |
| 2b | m48 | 4/4 | 66 | *Lento* |
| 2c | m71 | 3/8 | 270 | *Vivace* |
| 2d | m131 | 4/4 | 72 | *Andante* |
| **3a** | m1 | 4/4 | 60 | "3. (Aria)" |
| 3b | m25 | 4/4 | 72 | — (bass enters) |

So **2a = bars 1–47** and **3a = bars 1–24**, which is what the two scores
hold. Both are imported with `--bars`.

## Dead ends (for the next person)

IMSLP's Synthesized/MIDI section carries only the **Sonatina** (arrangements
by Tennent and Gouin). CPDL returns 403 to scripted requests; MuseScore.com is
behind Cloudflare; Mutopia has no BWV 106; Wikimedia Commons has only Gouin's
Sonatina engraving. The engraving files that made this work are attached to
the *Casadesus* entry under "Arrangements and Transcriptions", not under
Scores — which is why they are easy to miss.
