# J.S. Bach — BWV 106: 2a. Gottes Zeit ist die allerbeste Zeit

The first vocal movement of the *Actus tragicus*, and one movement in three
tempi — **47 bars**, nine parts, 1759 notes.

| bars | meter | tempo | text |
|---|---|---|---|
| 1–6 | 4/4 | ♩=80 | "Gottes Zeit ist die allerbeste Zeit" |
| 7–40 | **3/4** | ♩=142 *Allegro* | "In ihm leben, weben und sind wir" |
| 41–47 | **4/4** | ♩=56 *Adagio assai* | "in ihm sterben wir zur rechten Zeit" |

The meter changes appear in the score as bare `"3/4"` and `"4/4"` directive
lines, and the tempo changes as `set: tempo` in the soprano part.

- **Scoring**: SATB, two recorders, two viole da gamba, continuo.
- **Casting**: voices → `strings` (the DSL has no vocal sample), recorders →
  `flute`, gambas → `cello`, continuo → `keys`.
- **Verified**: 1759 source notes → 1759 in the score, 0 missing, 0 extra,
  0 moved.

## Where the notes come from

Imported with `play-yaml-import --verify` from Ramon Casadesus-Masanell's
engraving of the complete cantata (IMSLP #752782, CC BY-NC-SA 4.0, 2021),
whose MusicXML/MIDI export is mechanically faithful to the edition. Bach's
notes are public domain; the engraving is not, so no file from it is
committed — only this transcription.

The full research report, the movement table, the section boundaries and the
two corrections this work makes to the reference literature live in
[`../bwv-106-sonatina/research/report.md`](../bwv-106-sonatina/research/report.md).

## Changelog

- **2026-08-06** — rebuilt from source. The previous version of this score was
  invented: a homophonic eight-bar chorale in 4/4 with a
  `sample: organ` the DSL does not recognise, missing every meter and tempo
  change, and none of Bach's notes. Nothing of it survives.
