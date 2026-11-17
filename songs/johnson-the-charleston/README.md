# James P. Johnson and Cecil Mack: Charleston

*Charleston*, the song from the 1923 Broadway show *Runnin' Wild*. Music by
James P. Johnson (1894 to 1955), words by Cecil Mack (died 1944). Harms
published it in New York in 1923. It is public domain in the US (published
before 1931) and in the life plus 70 countries since 1 January 2026.

- **Source**: the Harms edition, "Copyright MCMXXIII by Harms Inc.", plate
  6870-4, for voice and piano with a ukulele part by Charles N. Grant. This
  printing has the cover title "The Original Charleston". The scan is from the
  Levy Sheet Music Collection at Johns Hopkins, on the Internet Archive. See
  `research/sources.md`.
- **Key and meter**: Bb major, cut time. The intro starts on G minor and the
  verse sits mostly in G minor too.
- **Tempo**: half = 112. The print only says *Animato*, so the number is our
  choice. The refrain is marked *con spirito*.
- **Size**: 88 bars, 2299 notes, about 1:34.

## What is Johnson's and Mack's, and what is ours

Theirs, as printed: the melody and the words on `voice`, and the whole piano
part on `rh`, `rh2`, `lh` and `lh2`. `rh2` and `lh2` hold the inner voices
where the print writes two rhythms in one hand.

Ours: the upright `bass`, the drum kit (`drums` and `traps`), the `clarinet`,
and the form. The bass plays the lowest notes of the printed left hand. The
drums play the Charleston beat in the refrain: kick on beat 1 and on the "and"
of 2, rim or snare on 2 and 4, foot cymbal on 2 and 4, and a woodblock in
bars 13 to 16. In the verse they keep a soft two-beat. Bass and drums also add
one hit on the last chord of the intro.

## Form

| section | bars | what |
| --- | --- | --- |
| `intro` | 1 to 8 | the piano alone, forte, ending on a rolled D7 |
| `verse` | 9 to 24 | "Carolina, Carolina", piano |
| `chorus` | 25 to 56 | the refrain, piano, first ending |
| `chorus_again` | 57 to 88 | the refrain again, forte, clarinet with the singer, second ending |

The print has the refrain inside repeat signs with two endings, and marks it
"p-f": soft the first time, loud the second. Here the singer takes both
passes, and the clarinet joins on the second. The words are printed once, so
the second pass repeats them.

## How it was made and checked

No MIDI or MusicXML with a clear licence turned up, so this is a hand
transcription and there is no `play-yaml-fidelity` score.

- The page images are 500 ppi. Every bar was read twice: once by eye from
  zoomed crops, once by a small notehead matcher that measured each head
  against the staff lines nearby. Where the two disagreed, which was mostly
  for notes on or under ledger lines, the pixels were read directly.
- The voice and piano were engraved to PDF and compared with the print page
  by page.
- The lyrics were checked note by note in the exported MIDI: 263 syllables on
  264 voice notes, the extra note being the slurred "cu" of "peculiar".
- Compiled with no warnings. Not yet heard by a human.

## Choices and doubts

- **"At last they're got you on the map"**: as printed. It probably means
  "they've".
- **Grace notes** in the left hand (verse bar 7, refrain bars 13 to 16) play
  as 32nd notes taken from the end of the note before them.
- **Not written**: the ukulele chord boxes, staccato dots, the tenuto lines
  in verse bar 15, and most hairpins. Marcato wedges in refrain bars 13 to 16
  play as accents. The sfz and fz chords play as double accents.
- **Ties and slurs**: an arc between two chords with the same notes is read
  as a tie. That matters in verse bar 13 (the A and C are held, not struck
  twice) and on "in" of "Made in Carolina", which is held into the next beat.
- **Verse bar 2**: the second left-hand note, the low E, is printed with a
  dark head. It is read as a half note like the bass notes around it.
- **Refrain bar 16** is a C diminished seventh (C, Gb, A) under "It's a
  lapazoo". The print really has Gb there, not Eb.

## Changelog

- 2026-11-17: first transcription, from the 1923 Harms edition.
