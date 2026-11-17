# Erik Satie: Gymnopédie No. 1 (1888)

78 bars, 3/4, D major, *Lent et douloureux*. 455 notes in four voices:
melody, inner, chords and bass. About 3 minutes 33 seconds at quarter = 66.

- **Casting**: all four voices on `piano`.
- **Tempo**: quarter = 66. The edition gives no metronome mark, so this is my choice.
- **Dynamics**: `pianissimo` throughout, with the printed `forte` (bars 9 and 48)
  and `piano` (bars 22 and 61) marks. The hairpins are not written out.

## Source and licence

Notes come from MuseTrainer's MusicXML engraving of the piece
(`Gymnopdie_No._1__Satie.mxl`), converted with `scripts/musicxml-to-play.py`.
Satie died in 1925, so the music is public domain. Only my transcription is
committed, not the MusicXML. See `research/sources.md`.

## What was checked

- The MuseTrainer library lists two Gymnopédie No. 1 files. The other one
  (MuseScore 1.3) stops after 47 bars, so I did not use it.
- Against the 1888 first edition (IMSLP03213, as hosted on Wikimedia Commons):
  the bar count is 78 on both and the structure agrees page by page (intro,
  melody entries, the two endings). I read the melody note by note on pages 2
  and 4, and the opening, the held F sharps, the f and pp marks on pages 1
  and 3. The F natural and C natural of the second ending agree.
- The conversion keeps every note: 455 notes, onsets exact. The compiler is clean.
- Not checked: every inner chord note of every bar.
