# George Gershwin: Rhapsody in Blue (1924), the opening and the love theme

The opening of the Rhapsody: the clarinet trill and the run up, the main
theme in B-flat, its answer with the muted-trumpet trills, the Più mosso, the
theme again in A-flat at rehearsal 2, and the solo piano's first entry
(Moderato assai). That part stops at the bar line before rehearsal 3.

After one bar of silence comes the first phrase of the Andantino moderato,
the love theme in E major: its first 8 bars, up to where the phrase starts
again.

- **Bars**: the file has 29 bars of 4/4, 451 notes, about a minute.
  - File bars 1 to 20 are the piece's bars 1 to 20. B-flat major for bars 1
    to 15, A-flat major from bar 16.
  - File bar 21 is silent: it marks the cut.
  - File bars 22 to 29 are the first 8 bars of the Andantino moderato, E major
    (page 20 of the 1927 edition, from its first bar to the end of the
    third system's third bar).
- **Casting**: bars 1 to 5 of the melody go to a `clarinet`, as the score
  marks them. Everything else is `piano`: the second piano (the band) on
  `upper`, `upper2`, `upper3`, `lower`, `lower2` and `lower3`, and the solo
  piano on `rh`, `rh2`, `lh` and `lh2` from bar 19.
- **Tempo**: the edition marks Molto moderato with a half note at 80, so the
  score runs at quarter = 160. The bars with fermatas (1, 10 and 15) are
  slower bars (100, 120 and 90). Più mosso is 200, easing back to 160 over the
  poco rit. in bars 13 and 14. Moderato assai and Andantino moderato have no
  number in the score: 120 and 76 are guesses.

## Source and licence

Rhapsody in Blue was published in 1924, so it has been public domain in the
US since 1 January 2020. Gershwin died in 1937, so it is also free where
copyright lasts 70 years after the author's death. Only Gershwin's 1924 music
is used here. Grofé's later orchestrations are not.

Which edition each part comes from:

- **File bars 1 to 20**: the two-piano score, New York: T.B. Harms, 1924,
  IMSLP #10970, marked public domain there. The second piano is Gershwin's
  reduction of the band, and it labels the opening "(Clar.)". Where that scan
  was too faint to read, the pitch was measured on Harms' 1927 piano solo
  edition (below), whose bars 1 to 15 are laid out note for note like the
  1924 second piano.
- **File bars 22 to 29, the love theme**: Harms' piano solo edition
  (copyright 1927, Chappell reprint, plate 31647), IMSLP #891278, page 20.
  Published in 1927, so public domain in the US since 2023, and Gershwin's
  70 years are over. This is the only source for this section.

See `research/sources.md` for the links. No scan, MIDI or MusicXML file is in
this repo.

## How it was made and checked

There is no public-domain MIDI or MusicXML of this edition, so this is a hand
transcription from the page images. Pitches were measured on the images, not
judged by eye: the pages were rendered at 300 and 600 dpi, the staff lines found with
`scripts/score-scan.py`, and each head's height converted to a pitch. Rhythm,
accidentals and ties were read off the image. Chords whose heads touch were
measured column by column.

Then the score was compiled and read back with `--json`, bar by bar, against
the page, and printed to PDF and compared with the scan side by side. It
compiles with no warnings.

It has not been listened to by a human yet.

## What is written out, and what is a guess

- **Trills**: written as fast alternations. Bar 1 trills F3 with G3, bar 15
  E-flat 4 with F4. In bar 6 the print puts a flat over the first trill only;
  all three trill to A-flat here. In bar 8 all three trill to D-flat, likewise.
- **The runs**: bar 1's 17 notes and bar 15's 10 notes are the edition's own
  notes, each fitted into one beat. Nothing was added.
- **Grace notes**: the B-flat octave before bars 2, 3 and 4 sounds in the last
  sixteenth of the bar before. The two grace notes in bars 2 and 16 take the
  last half of beat 2.
- **Rolled chord**: bar 4, beat 2, as printed.
- **Bar 17, left hand**: the 1924 scan is unclear there, so the inner voices
  are read from the 1927 edition, which shows the same shape. The B with the
  double flat sounds as A.
- **Ties into bar 19**: the second piano's chord is struck again on beat 1
  instead of tied.
- **Hairpins and staccatos** are not marked. Accents are.
- **Printing**: both pianos print on one grand staff, so bars 19 and 20 look
  crowded. The notes are right; the layout is a limit of the printer.
- **Love theme**: the top notes are held as printed (ties in bars 3 to 4 and
  7 to 8); the F double sharp in bar 5 sounds as G. The left hand's whole
  notes hold through each pair of bars. Tenuto marks are not written.

## Not done yet

- **Bars 21 to 23**, the rest of the tutti at rehearsal 3. Bar 21 was read,
  but bars 22 and 23 pack seven or eight notes per eighth-note chord, with
  seconds and double flats, and the measuring could not separate the heads
  reliably. Rather than guess, the file stops before rehearsal 3.
- **The rest of the love theme's statement**: its second phrase (page 20,
  third system, fourth bar on) and the close on page 21.

## Changelog

- 2026-11-17: first version, bars 1 to 20 and the love theme's first phrase.
