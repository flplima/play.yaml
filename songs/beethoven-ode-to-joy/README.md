# Ode to Joy (Beethoven, with Schiller's words)

The "Freude" theme from the finale of Beethoven's Symphony No. 9 (1824), sung
in German to the first stanza of Schiller's poem *An die Freude*. Beethoven
(d. 1827) and Schiller (d. 1805) are both public domain.

**The arrangement is ours.** The theme and the words are Beethoven's and
Schiller's. The accompaniment, the build-up and the choice of instruments are
a short sketch written for this repo, not Beethoven's orchestration.

## What you hear

32 bars, D major, 4/4, 92 bpm, about 84 seconds.

1. **Bars 1 to 8.** Cellos and basses alone, very soft, play the first eight
   bars of the theme. Beethoven opens the theme this way too.
2. **Bars 9 to 24.** The baritone (`choir-male`) sings the whole 16-bar theme
   with the first stanza ("Freude, schöner Götterfunken ... wo dein sanfter
   Flügel weilt"). Under it, `strings` play a chord chart written as chord
   symbols (`D`, `D/F#`, `A7/E`, `Bm`, `G/B`), and the basses play the roots.
3. **Bars 25 to 32.** The last eight bars (from "Deine Zauber binden wieder")
   come round again. The mixed choir joins an octave above the baritone, with
   cellos, basses, chords and timpani, at `forte`.

## Where the notes come from

Bar numbers below are the theme's own (1 to 16) unless it says "of the file".

- **Theme and underlay**: read from the vocal part of the 1826 Schott first
  edition of the full score (page numbers 113 to 115 of the print), a scan
  on Wikimedia Commons marked public domain. The notes are in the baritone's
  own octave (bass clef, F#3 to A3).
- **Cross-check**: the Mutopia Project's "Ode to Joy" (public domain, a hymn
  setting in G). All 62 pitches of the 16-bar theme match it, after moving it
  a fifth down. The comparison was done in code, not by eye.
- **The syncopation in bar 12 of the theme** (bar 20 of the file, and again
  in bar 28): the score has D, E, A, then an F# on the last beat tied over the barline into bar
  13. The word "al-" sits on that tied F#, and "-le" comes on the next note.
  The hymn setting has a plain half note there, so this comes from the scan.
- **Words**: Schiller's first stanza, in modern spelling (the 1826 print has
  "getheilt" and "Heiligthum"). The underlay follows the print, syllable by
  syllable. In bars 10 and 11 two eighth notes share one syllable.

## What was checked, and what is a guess

Checked:

- It compiles with no warnings; the score has 513 notes.
- Every pitch of the baritone's 16 bars equals the Mutopia melody (see above).
- The count of lyric syllables equals the count of struck notes, melismas
  included (94 notes, 90 syllables for the baritone; 32 and 30 for the choir).
- The tie in bar 12 is one 2-beat note.

Doubtful or ours:

- **Bar 14 of the theme** ("wer-den Brü-der", bar 22 of the file). The baritone staff in the scan shows two
  flagged notes on the last beat that I could not read clearly. The cellos
  play plain quarters there and Mutopia has plain quarters, so the file has
  A, G, F#, E as four quarter notes. If the print really has a small
  figure on "-der", it is not in this file.
- **Tempo** (92) and every dynamic mark are our choice. The scan has none
  for the theme that I relied on.
- **Chords** are ours, picked to fit the melody. They are not Beethoven's
  harmony.
- **Sounds**: the voices and strings use the Virtual Playing Orchestra when it
  is installed, otherwise the built-in synth.

See `research/sources.md` for the links and licences.
