# Beethoven: Piano Sonata No. 14 "Moonlight", Op. 27 No. 2, I. Adagio sostenuto

69 bars, C-sharp minor, written in cut time. 1168 notes in six voices: the
triplets, the melody and the bass ring independently. About 5 minutes 7
seconds at quarter = 54.

- **Casting**: all six voices on `piano`.
- **Meter**: the score is in 2/2. The bars are counted as 4/4 here, which is the
  same length and sounds the same. Twelve triplet eighths per bar.
- **Tempo**: quarter = 54, my choice (the source file says 44, which drags).
- **Dynamics**: `pianissimo` the whole way, as the first edition asks
  ("sempre pianissimo e senza sordino"). The crescendo and diminuendo marks are
  not written out.

## Source and licence

Notes come from MuseTrainer's MusicXML engraving
(`Sonate_No._14_Moonlight_1st_Movement.mxl`), converted with
`scripts/musicxml-to-play.py`. Beethoven died in 1827, so the music is public
domain. Only my transcription is committed. See `research/sources.md`.

## What was checked

- Complete: 69 bars, key signature of four sharps, ends on the C-sharp minor
  chord in bar 69.
- Against the 1802 first edition (Cappi, Vienna): the opening bars (1 to 6)
  agree note for note, including the dotted melody entry on the last beat of
  bar 5 and the bass octaves. The rest of the movement I did not compare note by
  note: the scan is faint and the first edition's beaming is hard to read. I did
  check the overall shape and the dynamic instruction.
- The conversion keeps every note: 1168 notes, onsets exact. The compiler is clean.
- Doubtful: bass spellings such as the G natural in bar 27 come from the
  engraving as written. The pitch sounds right for the harmony (F double sharp).
