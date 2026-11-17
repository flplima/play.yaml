# Canon in D

Pachelbel's Canon per 3 Violini e Basso (about 1694), the original scoring:
three violins and a bass line, no pop arrangement. D major, 4/4.

- **Source and licence**: the Mutopia Project edition, typeset in LilyPond by
  Michael Fischer v. Mollard (Mutopia-2015/09/02-2047), from IMSLP. This one is
  **not** public domain: the edition is under **Creative Commons Attribution
  4.0** (https://creativecommons.org/licenses/by/4.0/). The composition is old
  enough to be free. The typesetting is credited here and in the header of the
  `.play.yaml`. The score is a note for note import of that edition, so keep the
  credit if you reuse it. See `research/sources.md`.
- **How it was made**: the edition's MIDI was converted with
  `play-yaml-import --verify`: 1952 notes read, 1952 in the score, 0 missing,
  0 extra, EXACT. The importer lost the last bar, a closing chord of four
  quarter notes (A4, F#5, D5 and D3, 1956 notes in all). I added it by hand and
  checked the compiled score against the MIDI with an independent
  note comparison: 1956 notes, 0 missing, 0 extra.
- **Form**: 57 bars. Two bars of rest in the first violin, then the canon
  enters, over 28 statements of the two bar ground bass (D A B F# G D G A).
  The statements are written out. About 4 minutes 5 seconds at 55 bpm.
- **Tracks**: `violin1`, `violin2`, `violin3` (preset `violin`) and `cello`
  (preset `cello`, the bass line).
- **Tempo**: 55 bpm, the value in the edition's MIDI. The edition prints no
  tempo word and no dynamics, so the score has none. The default dynamic is
  `mezzoforte`.

## Not done

- No ornaments, no continuo chords and no later Gigue: the edition has only
  the Canon.
- Nobody has listened to the whole file yet.
