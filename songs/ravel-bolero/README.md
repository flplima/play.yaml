# Maurice Ravel: Boléro (1928)

A reduced orchestration of the whole piece: **340 bars of 3/4 at quarter = 72**, about 14 minutes 10 seconds. 35,980 notes on 32 tracks. Every note in the file is one of Ravel's, at concert pitch. What the reduction drops is doubling, not music.

## Source and licence

- The notes come from **Nicolas Sceaux's LilyPond edition** of the full score (2016), released under CC0. It is a typeset copy of the Durand first edition, plate D. & F. 11 839, engraved in 1929.
- That edition was checked by eye against a **scan of the Durand plates** on Wikimedia Commons, where it is marked public domain. The scan is a later reprint from the same plates.
- Ravel died in 1937. Boléro is public domain in France since 2016. In 2024 a court in Nanterre rejected the claim of Alexandre Benois's heirs to be co-authors. The score was published in 1929, so it is public domain in the US since 2025.
- Nothing from those sources is committed: no PDF, no LilyPond file, no MIDI. See `research/sources.md`.

## How it was made

1. A small script read the LilyPond text as data, without running LilyPond. It turned all 54 parts into notes at concert pitch, using each instrument's standard transposition.
2. A second script picked the parts listed below, cut them into one section per rehearsal number and folded repeated bars into `Nx:`.
3. The file was compiled back with `play-yaml --json` and compared note by note with the parts it came from: 35,980 expected, 35,980 found, 0 missing, 0 extra. Every onset, pitch and length matches. The compiler prints no warnings.

## Checked against the Durand scan

- Theme A, all 17 bars, on the flute (bars 5 to 21).
- Theme B, all 17 bars, on the bassoon (bars 41 to 57).
- The snare drum's two-bar figure, and the opening pizzicato of the violas and cellos.
- Rehearsal 8: the solo horn, both celesta staves, both piccolos (written in E major and G major) and the second horn's rhythm.
- Rehearsal 16: both flute lines of the harmonised theme A. Rhythm in all 16 bars, pitch in bars 293 to 296 and 301.
- Rehearsal 18: the print keeps C major (the E major is written in accidentals), and the first violins in bar 329.
- The last four bars: the final run, the last chord, bass drum, cymbals and tam-tam.
- The solo instrument at rehearsals 1, 2, 7, 8 and 9. The order of the other statements comes from the Sceaux parts.

The rest relies on the Sceaux edition and was not proofread bar by bar. Two places where it disagrees with the Durand plates turned up:

- **Bar 329, tenth sixteenth**: Sceaux writes an F natural in the parallel line of the first flute, first trumpet and first violins. Durand prints no natural there after an F sharp earlier in the bar, so this file plays F sharp.
- **Bars 301 to 304**: Durand prints the second flute an octave lower than Sceaux. The flutes are not in this reduction at that point, so it changes nothing here.

## The reduction

Kept for all 340 bars: the snare drum, the harp, the first and second violins with their divisi, the violas, the cellos and the double basses. They carry the two ostinatos and the harmony.

Kept where they lead: in each section, the instruments with the theme, the ones in parallel with it, and the ones playing the snare rhythm on G or C. In the last three sections also the oboes, clarinets, saxophones, trombones, the second snare drum, bass drum, cymbals and tam-tam.

Dropped entirely: piccolo trumpet, tuba, timpani, contrabassoon and bass clarinet. Dropped in places: the wind and brass doublings of the tutti sections. A check over all 48,986 notes of the full score found that every pitched note starts at a time, and on a pitch class, that some kept track also plays. So what is lost is octave doubling and weight.

## The 18 statements

| bars | theme | Ravel | here |
|---|---|---|---|
| 5-21 | A | flute | flute |
| 23-39 | A | clarinet | clarinet |
| 41-57 | B | bassoon | bassoon |
| 59-75 | B | E-flat clarinet | clarinet |
| 77-93 | A | oboe d'amore | oboe |
| 95-111 | A | flute and muted trumpet | flute, trumpet |
| 113-129 | B | tenor saxophone | bass clarinet |
| 131-147 | B | sopranino, then soprano saxophone | clarinet |
| 149-165 | A | horn, celesta, two piccolos | horn, celesta, piccolo |
| 167-183 | A | oboe, oboe d'amore, cor anglais, two clarinets | oboe, english horn, clarinet |
| 185-201 | B | trombone | trombone |
| 203-219 | B | piccolo, flutes, oboes, cor anglais, clarinets, tenor saxophone | all of these |
| 221-237 | A | first violins, with woodwinds | first violins |
| 239-255 | A | all violins, with woodwinds and tenor saxophone | violins |
| 257-273 | B | violins and trumpet, with woodwinds | violins, trumpet |
| 275-291 | B | strings, trombone, sopranino saxophone, with woodwinds | strings, trombone, sax |
| 293-309 | A | violins, trumpets, saxophones, piccolo trumpet, piccolo, flutes | violins, trumpets, saxes |
| 311-326 | B | the same and trombone | violins, trumpets, saxes, trombone |

Then 8 bars in E major (327 to 334), back to C at bar 335, and six bars of collapse with trombone slides, bass drum, cymbals and tam-tam.

## Sounds and other choices

- No saxophone, oboe d'amore or E-flat clarinet in the built-in orchestra. The tenor saxophone plays on `bass-clarinet`, the sopranino and soprano saxophones and the E-flat clarinet on `clarinet`, the oboe d'amore on `oboe`. The tam-tam is the `china` cymbal, the closest General MIDI drum.
- One MIDI channel per General MIDI program, so the `.mid` export fits in 16 channels.
- Dynamics follow the score: the snare drum climbs from pianissimo to fortissimo through six marks, and each entry gets its own mark. A mark in the middle of a bar is placed at the start of that bar.
- Pizzicato and arco follow the string parts.
- Left out: the seven grace-note slides in the tenor saxophone (bars 118, 119, 208, 209), sopranino saxophone (136, 137) and trombone (191) solos; slurs, staccato dots and accents (every note plays at the default length); mutes; the trombones' glissando lines, which sound only as their written notes.

## Changelog

- **2026-11-17**: first version, built from the Sceaux CC0 edition and checked against the Durand plates.
