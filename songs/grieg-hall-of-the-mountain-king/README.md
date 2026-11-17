# In the Hall of the Mountain King

Grieg's piece from the Peer Gynt music (Op. 46 No. 4, 1874), in his own
piano arrangement. B minor, 4/4.

- **Source**: the Mutopia Project edition, typeset in LilyPond by Coyau
  (Mutopia-2013/12/07-1888), from "The University Society, 1918". Licence on
  the page: Public Domain. Grieg died in 1907. See `research/sources.md`.
- **How it was made**: the edition's MIDI was converted with
  `play-yaml-import --snap 24 --verify`. The MIDI has 1453 notes, the score
  has 1453, 0 missing, 0 extra. The grace notes before the `sfz` chords sit
  a few ticks apart in the MIDI, so the import snaps onsets to 1/24 of a
  beat. The largest shift is 0.02 beat. This is a quantized match, not
  EXACT. The bars with the grace note slides (74 to 88) were then rewritten
  by hand from the LilyPond file: see below.
- **Form**: 88 bars, one pass, no repeats in the edition. About 2 minutes 25
  seconds.
- **Tracks**: `right1`, `right2`, `right3` (the importer split the right hand
  into three voices, most bars use one or two) and `left`, all `piano`.
- **Tempo**: 138 bpm with the marking "Alla marcia molto marcato", then 154 bpm
  from bar 50 ("Più vivo"). The tempo change is written by hand, because the
  importer reads only the first tempo of a file. From bar 58 the edition says
  "sempre stretto sin al fine", so the tempo speeds up bar by bar to 176 bpm
  at the end. The 176 is my guess. The edition's MIDI stays at 154.
- **Grace notes**: from bar 74 the edition has a slide of three grace notes
  (G sharp, A, A sharp) before each `sfz` chord. They are written as three
  short notes in the tail of the beat before the chord, so the chord lands on
  the printed beat. They were runs of `_` before.
- **Dynamics**: `piano` at the start, `pianissimo` at bar 2 ("e sempre
  staccato"), a crescendo from bar 34 to `mezzoforte` at bar 42, a second
  crescendo to `fortissimo` at bar 50, `pianissimo` again at bar 84, and a
  last crescendo to `fortissimo` at the final chord. I checked every mark and
  its bar against the LilyPond file: they are right. The `sfz` accents are not
  written.

## Checked

- Bars 74 to 88 against the LilyPond file: 1453 notes, same as the MIDI.
  Against the MIDI import, 1403 of the 1411 notes that are not grace notes
  match on the beat. The other 8 are chords in bars 85 and 88 that the MIDI
  plays 0.05 to 0.16 beat late, because its grace notes push them. The score
  has them on the beat, as printed.

## Not done

- The fermata on the first bar is not in the MIDI, so it is not in the score.
  The opening bar is a rest in every voice.
- Nobody has listened to the whole file yet.
