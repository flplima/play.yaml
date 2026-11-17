# Ernesto Nazareth: Odeon

*Odeon*, tango brasileiro for piano, by Ernesto Nazareth (1863-1934). Published in
Rio de Janeiro in 1909 and dedicated to Zambelli & Cia., who owned the Cinema
Odeon, where Nazareth played in the waiting room. Public domain: Nazareth died in
1934, so the music is free in Brazil (life plus 70 years) and in the US
(published before 1931).

- **Source**: the first edition, E. Bevilacqua & Cia. (Casa Mozart), Rio de
  Janeiro, ca. 1909, plate 6602. A scan of a public domain print, from the
  Instituto Moreira Salles site for Nazareth (IMSLP lists the same edition as
  #600163). See `research/sources.md`.
- **Key and meter**: C# minor for A, E major for B and the trio. 2/4, with a
  pickup of three 16ths.
- **Tempo**: quarter = 88. The print gives no metronome mark, only *Gingando*
  (swaying), so 88 is my choice.
- **Tracks**: `rh` and `lh`, both on `piano`. In A the print writes the right
  hand's off-beat chords in the bass staff, under the left hand's tune; here
  they live in `rh`.
- **Size**: 160 bars of 2/4 plus the pickup, 2487 notes, about 3:39.

## Form

The print has A (repeat), B (repeat), A written out again, the trio (repeat),
then "D.C. al 𝄋". The segno sits on bar 1 and the only FINE closes the
written-out A, after a bar marked "Somente para finalizar" (only to finish). So
the da capo plays A, B and A once more:

| section | what |
| --- | --- |
| `pickup` | the left hand's G# G F# |
| `a` | A twice, with its two volta endings (`loop: 2` and `alternate:`) |
| `b` | B twice, f, expressivo |
| `a_return` | A once, ending in the bar that leads into the trio |
| `trio` | the trio twice, ff com brilho; the second ending climbs under an 8va |
| `a_da_capo`, `b_da_capo` | the D.C.: A and B once each, second endings |
| `a_fine` | A once more, ending on the "Somente para finalizar" bar |

That is ABACABA. The IMS notes say the autograph and Nazareth's own 1913
recording also bring B back at the end. Some modern editions stop after the
third A instead. Repeats are not taken in the da capo, as usual.

## How it was made and checked

No MIDI or MusicXML with a clear licence exists for this piece, so this is a
hand transcription and there is no `play-yaml-fidelity` score.

- Every bar of the 1909 scan was read twice, against `score-scan.py grid`
  overlays that label each staff line and space.
- Musica Brasilis's 2020 engraving (CC BY-SA 4.0, revised against the autograph)
  was the second reading. Its PDF draws the noteheads with a music font, so their
  pitches could be measured exactly. The two prints agree on every note.
- Where the marks differ, the score follows 1909: two extra left-hand accents in
  B's second half, no accents on the trio's opening chords, no hairpin in the
  trio's second ending.
- Compiled with `--json` and read back bar by bar (onsets in 16ths, pitches),
  and engraved to PDF to compare with the print. No warnings.
- Not yet heard by a human.

## Choices and doubts

- **Trio bars 1 and 5**: the 1909 print puts a natural on the low F but not on
  the F an octave up in the same bar. Both are F natural here, as the harmony
  (a diminished seventh) and the Musica Brasilis edition have it.
- **Grace notes** (in A's second ending and in B) play as 64ths taken from the
  rest or note just before them.
- **Dynamics** follow the print: mf, f, dim., ff, *menos* (as forte), *mimoso*
  (tender, as mezzoforte, since the print gives no new level), and *f e ret.* in
  the trio's first ending (forte and a ritardando over its last two bars).
  *Sec.* (dry) is only a comment.
- Double sharps are spelled `f##2` and `f##4`, as printed.

## Changelog

- 2026-11-17: first transcription, from the 1909 Bevilacqua edition.
