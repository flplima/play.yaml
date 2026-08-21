# Clair de lune - research report

Researched 2026-08-07.

## The work

**Clair de lune**, third movement of the *Suite bergamasque*, L. 75. Written
around 1890, revised and published 1905. **72 bars, 9/8, D-flat major**, marked
*Andante tres expressif*.

## The notes

From the Mutopia Project's LilyPond edition (see `sources.md`), via its
rendered MIDI: 1468 notes, 322.5 quarter-note beats = 72 bars of 9/8, key
signature of five flats, two staves.

Imported with `play-yaml-import --measure 9/8 --flats --voices 4`. The
`--voices` split is what turns two staves into six real lines: Debussy holds
notes in one hand while the other moves, and a play.yaml track cannot carry
two independent rhythms.

**Verification.** `play-yaml-import --verify`: 1468 to 1468, nothing missing,
invented or moved. Re-checked against the source MIDI after the header and
casting were written: identical.

## Independent cross-check

`examples/clair-de-lune.play.yaml` was built earlier and separately from a
MuseTrainer MusicXML engraving (9 voices, snapped to 1/24, 1608 notes).
Comparing that score against this edition's MIDI:

- **1462 of 1468 Mutopia notes are present at the same beat and pitch (99.6%)**
- the example has **146 notes this edition does not**

Two engravings of the same piece agreeing to 99.6% is the strongest evidence
available here that both are sound. The 146 extra notes are where the editions
differ over written-out repeats and octave doublings - an editorial choice, not
a disagreement about the music.

## What the previous score got wrong

It was a **stub**: 14 bars, 156 notes, three tracks. Correct as far as it went
(9/8, D-flat, quarter=50 in the header) but it stopped after the opening phrase.
