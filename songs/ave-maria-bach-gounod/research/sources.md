# Sources — Ave Maria (Bach / Gounod)

- **Mutopia Project, Gounod *Ave Maria* (piano + violin)**,
  <https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2167> —
  LilyPond source and MIDI, typeset by Yann Leprince from the **Heugel 1856
  edition for solo violin, orchestra and choir**. Marked *Public Domain,
  CC: No rights reserved*. **Primary melodic source.** Highly trusted: it is
  an engraved edition, and the LilyPond source and its rendered MIDI agree
  note-for-note (checked by decoding both). Used in the session scratchpad
  only; not committed.
  - The typesetter cites the Heugel original at Gallica,
    <http://gallica.bnf.fr/ark:/12148/btv1b54000086f>.

- **Mutopia Project, J.S. Bach *Prelude No. 1 in C*, BWV 846**,
  <https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1/wtk1-prelude1.ly>
  (and the matching `.mid`) — used as the reference edition of the prelude
  itself. 35 bars / 140 quarter-beats. This is what established that
  `examples/bwv846.play.yaml` is missing authentic Bach bar 26, and that
  Gounod's extra bar 27 is the Schwencke measure rather than a third
  discrepancy. Trusted for bar count and harmony.

- **Wikipedia, *Ave Maria (Bach/Gounod)***,
  <https://en.wikipedia.org/wiki/Ave_Maria_(Bach/Gounod)> — the 1853 date and
  original title, the *Moderato* marking, the fact that Gounod repeats Bach's
  first four bars for the voice's entry, and that the Schwencke measure
  carries a repeated "Maria!". Corroborating context only; no notes taken
  from it.

- **Wikipedia, *Prelude and Fugue in C major, BWV 846***,
  <https://en.wikipedia.org/wiki/Prelude_and_Fugue_in_C_major,_BWV_846> — the
  Schwencke measure's history: inserted between bars 22 and 23 in some
  editions, Hermann Keller's view of it, and the claim that Carl Schwencke
  forged it into his father's hand.

- `examples/bwv846.play.yaml` (this repo) — the piano part, copied verbatim
  and left unchanged.

Method notes: the melody was read out of the MIDI with the repo's own
`decodeMidi`, and cross-checked against the LilyPond source by hand-decoding
its `\relative` pitches (they agreed, including the one bar where the
expected octave drop does not occur). The bar-by-bar mapping was produced by
a Needleman-Wunsch alignment of pitch-class sets, not by ear. Both scratchpad
scripts are throwaway.
