# Tico-Tico no Fuba - Zequinha de Abreu

Jose Gomes de Abreu ("Zequinha de Abreu", 1880-1935), composed in 1917 in
Santa Rita do Passa Quatro (originally titled *Tico-Tico no Farelo*) and
published by Irmaos Vitale in Sao Paulo (Plate I. 620 V.). Public domain
worldwide. A virtuosic Brazilian *choro sapeca* in 2/4 time (`tempo: 100`),
built on continuous sixteenth-note syncopations in A minor and a luminous Trio
in the parallel key of A major.

Transcribed from Eugene Kirpichov's 2/4 classical guitar engraving MIDI
(`abreu_ticotico.mid`, 783 notes, verified `EXACT` via `play-yaml-import
--verify`), cross-checked against the Irmaos Vitale edition metadata on IMSLP
(#211430), the MIDIfind two-track score (#64805), and Steve Owen's
concert-pitch ABC transcription (The Session #4357). See `research/report.md`
and `research/sources.md`.

## Arrangement

84 bars of 2/4 (168 beats, ~1:41 at 100 bpm) across six sections, ending on a
Picardy-third A major chord:

| Section | Bars | Key | Content |
|---|---|---|---|
| `intro` | 1-4 (4) | A minor | Descending scale run answered by rising chromatic sixths (`G3 -> F#3 -> F3 -> E3`) into the E7 pickup `{e4 d#4 e4}` |
| `part_a1` | 5-20 (16) | A minor | Main choro theme: flute leads bars 5-12 (`E4-E5`), clarinet takes bars 13-20 in the chalumeau register (`D#3-D4`) under flute offbeat chord stabs |
| `part_a2` | 21-36 (16) | A minor | Repeat of Part A, pivoting on bar 36 (`{~ a3 c#4 e4}`) into A major |
| `trio_c1` | 37-52 (16) | A major | Parallel-major Trio (`{a4 _ _ g#4} {_ _ _ f#4}`), culminating in the blazing 16th-note scale cascade across bars 49-51 |
| `trio_c2` | 53-68 (16) | A major | Repeat of the Trio, pivoting on bar 68 (`{~ e4 d#4 e4}`) back to A minor |
| `reprise_a` | 69-84 (16) | A minor -> A major | Da capo restatement of Part A, closing on a crisp Picardy A-major chord (`[c#4 e4 a4]` over `{a2 e2}`) |

**Casting**: Brazilian choro *regional* chamber trio mapped to Virtual Playing
Orchestra solo samples so it plays with real acoustic recordings in the browser
studio out of the box:
- `flute` (`preset: flute`): upper-octave choro melody, Trio lead + 16th-note
  cascade, and offbeat chord stabs in the second half of Part A.
- `clarinet` (`preset: clarinet`): syncopated inner choro accompaniment, B7 and
  F#7/Bm counter-lines, and the lower-octave (`D#3-D4`) Part A response.
- `cello` (`preset: cello`): two-beat choro bass and *baixaria* walk-ups.

**Fidelity & validation**:
- `play-yaml-fidelity` against the reference `abreu_ticotico.mid`: **97.8 / 100**
  (`99%` harmony, `98%` exact register, `93%` rhythm, `94%` coverage, `100%`
  tempo, `0` weak passages below 85%).
- Every `(startBeat, pitch)` pair in the 783-note reference is preserved
  (`0` missing, `0` extra), with 80%-gated guitar tuplets (`{a2 _ _ _ ~}`)
  normalized to clean quarter, eighth, and sixteenth tokens.

## Changelog

- 2026-11-03 - initial transcription and choro trio arrangement (84 bars of
  2/4, 780 notes across `flute`, `clarinet`, `cello`, 97.8/100 fidelity).
