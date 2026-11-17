# Rondo alla turca

The last movement of Mozart's Piano Sonata No. 11 in A major, K. 331
(1783), known as the Turkish March. A minor and A major, 2/4.

- **Source**: the Mutopia Project edition, typeset in LilyPond by Rune
  Zedeler and Chris Sawer (Mutopia-2015/08/13-108), from IMSLP. Licence on the
  page: Public Domain. Mozart died in 1791. See `research/sources.md`.
- **How it was made**: written by hand from the edition's LilyPond file
  (`KV331_3_RondoAllaTurcaNotes.ly`), bar by bar. The file reads as printed
  music: pitches are spelled as in the edition (`e#5`, `b#5`), and grace notes
  and trills are short.
- **Bars**: the piece starts with a one beat pickup, so the score has a 1/4
  bar first and 2/4 bars after it. Every section is a pickup, 2/4 bars and a
  one beat last bar, the way the edition prints them around repeat signs.
  The MusicXML export has only 1/4 and 2/4 bars. The bars line up across the right hand, the second voice and
  the left hand.
- **Repeats**: every repeat sign of the edition is taken. Sections with
  `loop: 2` play the opening A minor tune, the second tune, the A major march,
  the running sixteenths, the climb, the march again, then the opening tunes
  again. The closing A major march has a first and a second ending. It plays
  as march, first ending, march, second ending, then the last page. That is
  447 beats, 241 measures, about 3 minutes 44 seconds at 120 bpm.
- **Grace notes**: the DSL has no grace note sign. Each one is written out as
  a short note in the tail of the slot before its main note, about 1/16 of a
  beat each, so the main note lands exactly on the printed beat. That is
  where the edition's MIDI puts them too.
- **Trills**: the trills (in the second tune and its coda) are the main note
  only, as in the edition's MIDI.
- **Tracks**: `right`, `right2`, `left`, all `piano`. `right2` is the second
  voice of the right hand, used where two voices cross (the second tune, the
  strummed chords of the last page).
- **Tempo**: 120 bpm, my choice. The edition says "Allegretto" and its MIDI
  has no tempo of its own (the default 60 bpm). Change `tempo:` to taste.
- **Dynamics**: from the `dynamics` block of the LilyPond file, spelled out
  (`piano`, `mezzopiano`, `forte`, `fortissimo`). Hairpins are one bar ramps.
  The `fz` marks are accents on a note that then drops to `piano`.
  Dynamic changes land on bar lines, so a change printed on a pickup beat
  starts at the bar before it.
- **Key**: the file is set to A minor. The A major stretches have no key
  change in the MusicXML, because every note name is written out.

## Checked

- The edition's MIDI was imported with `play-yaml-import --snap 48` and
  compiled. Each section was compared with the score with every repeat
  expanded, by time and pitch: 2520 notes that are not grace notes, 2520
  common, 0 missing, 0 extra, on exact beats.
- Grace notes: the MIDI has 291 and the score has 290. The one left out is a
  hidden grace A before the second ending that the edition does not print.
  Grace timings differ a little by design.
- The score compiles with no warnings. The MusicXML export has a 1/4 first
  bar, then 2/4 bars.

## Not done

- Slurs, staccato dots and the arpeggio signs of the last page are not
  written. The chords there sound together.
- Nobody has listened to the whole file yet.
