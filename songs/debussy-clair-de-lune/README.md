# Claude Debussy — Clair de lune (Suite bergamasque, L. 75)

**72 bars, 9/8, D-flat major**, *Andante très expressif*. 1468 notes across six
voices — the two hands split into the independent lines the writing actually
holds, so a held note can ring under a moving one.

- **Casting**: all six voices on `piano`.
- **Tempo**: quarter = 50.
- **Verified**: imported from Mutopia's rendered MIDI with
  `play-yaml-import --verify` — 1468 to 1468, 0 missing, 0 extra, 0 moved, and
  confirmed note-identical again after assembly.

## Two editions agree

Cross-checked against `examples/clair-de-lune.play.yaml`, built independently
from a MuseTrainer MusicXML engraving: **1462 of Mutopia's 1468 notes appear
there at the same beat and pitch - 99.6%**. The example carries 146 notes this
edition does not; the two differ over written-out repeats and doublings, not
over the piece.

## Changelog

- **2026-08-07** - rebuilt from source. The previous version was a **14-bar
  stub** with 156 notes and three tracks, against the movement's 72 bars and
  1468 notes.
