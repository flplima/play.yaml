# J.S. Bach — BWV 106: I. Sonatina (*Actus tragicus*)

The instrumental prelude to the funeral cantata *Gottes Zeit ist die
allerbeste Zeit*, written in Mühlhausen in 1707–08. Twenty bars, **E♭ major**,
common time, **Molto adagio**, for two recorders, two viole da gamba and
continuo — five parts, no violins and no voices.

- **Form**: one continuous span. Continuo and gambas from bar 1, the two
  recorders entering in bar 4 and running in near-parallel thirds and
  sixths to the end.
- **Casting**: recorders → `flute`, viole da gamba → `cello`, continuo →
  `keys` (the DSL has no organ sample; `keys` sustains where `bass` would
  pluck).
- **Tempo**: ♩=50. No metronome mark exists — "Molto adagio" is the only
  instruction; the three sources consulted render it at 50, 40 and 33.

## Where the notes come from

Imported with `play-yaml-import --verify` from Ramon Casadesus-Masanell's
engraving of the complete cantata (IMSLP #752782, CC BY-NC-SA 4.0, 2021).
Bach's notes are public domain; the engraving is not, so no file from it is
committed — only this transcription.

**Verified**: 753 source notes → 753 in the score, 0 missing, 0 extra, 0 moved.

Independently cross-checked: before that engraving was found, this movement was
reconstructed from two *other* public-domain renderings (Tennent's five-part
arrangement, quantised but transposed to C major; Gouin's organ transcription,
at pitch but humanised). That reconstruction came out note-identical in gamba 1
(160/160) and recorder 2 (121/121), and scored 90.2/100 with 98% harmony
against Gouin's file. Two routes, same notes — see `research/report.md`.

## Changelog

- **2026-08-06** — rebuilt from source. The previous version of this score was
  invented: five parts of scale-shaped filler headed "E-flat major / C minor"
  at ♩=54, with none of Bach's notes, and a `sample: organ` the DSL does not
  recognise. Nothing of it survives. `research/` was rewritten from citable
  sources at the same time.
