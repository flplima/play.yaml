# Ave Maria (Bach / Gounod) — research notes

Both works are public domain: Bach died 1750, Gounod died 1893. The edition
used as the melodic source is itself marked Public Domain / CC0. Only facts
and my own transcription are committed — no downloaded files.

## The work

Charles Gounod, *Méditation sur le premier Prélude de J. S. Bach* (1853),
later fitted with the Latin prayer text and published as *Ave Maria*. Gounod
superimposed a single sustained melody over Bach's Prelude No. 1 in C major,
BWV 846 (*Well-Tempered Clavier* Book I, 1722), leaving the keyboard writing
essentially untouched and adding only pedal and dynamic markings.

- **Key** C major. **Meter** 4/4. **Tempo** Gounod marks *Andante semplice*,
  ♩=66. This transcription keeps `tempo: 72` — the value in
  `examples/bwv846.play.yaml`, whose notes are used exactly as they stand
  there. (That file itself was corrected once during this work: authentic Bach
  bar 26 was missing from it. See below.)
- **Original scoring** solo violin, orchestra and choir (1853); the familiar
  voice-and-piano form came later. The melody here is taken from the violin
  line, which is why it has no text.

## Structure, and how Gounod's bars line up with ours

Gounod plays Bach's first four bars twice: once as a piano prelude, then
again as the melody enters. So his bar 5 is Bach's bar 1. His melody then
runs to his bar 36, with a first/second ending and a short coda.

Rather than align by ear, our prelude was aligned against Gounod's own piano
part **bar-by-bar on pitch-class sets** (Needleman-Wunsch, gap-penalised).
Every bar matched exactly except two, both of which Gounod had and we did not:

| Gounod bar | pitch classes | what it is |
|---|---|---|
| 27 | C D# G B | the **Schwencke measure** — spurious, correctly absent |
| 31 | C D F G | **authentic Bach bar 26** — was missing from our prelude, since fixed |

The two turned out to be entirely different problems: one a bar Bach never
wrote, the other a bar of Bach's that our file had lost.

### The Schwencke measure

Some 19th-century editions of BWV 846 carry an extra bar between bars 22 and
23, attributed to C.F.G. Schwencke (a descendant later argued it was forged
into his father's hand by his son Carl). It is not Bach's. Gounod worked from
an edition that had it, and set the voice's repeated, expressive "Maria!"
across it and the bar following.

Our prelude does not contain it — correctly. Dropping Gounod's bar 27
therefore removes one of the two repeated high-C bars, keeping the second.
The 16th-note pickup at the end of the preceding bar still lands on a C6, so
the gesture survives intact.

### The bar our prelude was missing — since fixed

Cross-checked against the Mutopia typesetting of BWV 846 itself (35 bars,
140 quarter-beats): **`examples/bwv846.play.yaml` had 34 bars and was missing
authentic Bach bar 26** — a `C D F G` bar in the dominant-pedal section,
between its own bars 25 and 26. Bars 1–25 and 27–35 matched the reference
one-for-one, which is what isolated the gap to a single bar.

The reference gives that bar as bass `g2 d3` under `g3 c4 f4` twice, i.e.
`{g2 d3 g3 c4} {f4 g3 c4 f4}` per half-bar in this file's idiom — identical
to the prelude's own bar 30, which Bach repeats. It has been restored in
`examples/bwv846.play.yaml` and here, in the same shape, so both files are
now 35 bars / 140 beats and the prelude aligns with the reference edition
across all 35 bars with zero differences.

Gounod's bar 31 — the phrase rising from F that sits over it — is therefore
no longer dropped.

## Melody mapping (our bar → Gounod bar)

With Gounod's four-bar introduction in place, our numbering *is* his through
bar 26 — the clearest confirmation that the alignment is right.

    ours  1– 4  →  gounod  1– 4     piano introduction, voice tacet
    ours  5–26  →  gounod  5–26     1:1
    [gounod 27 dropped — Schwencke measure]
    ours 27–35  →  gounod 28–36     (+1)
    ours 36–39  →  gounod 37–40     second ending + coda

Because each mapped pair has an **identical pitch-class set**, every melody
bar sits over exactly the harmony Gounod wrote it against.

## The melody itself

Range G3–E6, entering at bar 5. Shape (bar numbers as they now stand, with the
introduction counted): four long notes arching up and back (bars 5–8); a
sighing figure that leaps to a held note, drops an octave and climbs back by
step (9–12); a rising sequence stated three times, a step higher each time
(16–21); the great *crescendo molto*, one accented half note per bar answered
by a 16th-note pickup, E–G–A–A–C (23–27); a last gathering rising from F (30);
the climax, D6 then E6 at *ff / tutta forza* (31–33); a two-octave scale down
through the G7 (35); and a low sustained C then G held under the piano's
cadenza and final chord (36–39).

Gounod's dynamics alternate sharply — `cresc.` and `pp` bar by bar through
the sighing figures — and are reproduced as directive strings.

## Verification

- **Piano identical to the prelude**, in both sections: the `intro`'s 64 notes
  match `examples/bwv846.play.yaml` bars 1–4, and the `piece`'s 549 notes match
  the whole file shifted 16 beats later — every time / pitch / duration /
  velocity equal. Checked programmatically, not by inspection.
- **Prelude matches the reference edition**: aligned against the Mutopia
  BWV 846 typesetting across all 35 bars with zero differing bars.
- **Voice tacet through the introduction**: its first note is at beat 16.
- **Melody faithful**: all 35 sung bars match the source violin line
  onset-for-onset and pitch-for-pitch under the mapping above.
- Compiles to 39 bars / 156 beats.

## Known deviations

1. Gounod's bar 27, the Schwencke measure, is dropped (see above). His bar 31
   is no longer dropped — the Bach bar under it has been restored. This is the
   only place our numbering parts from his.
2. Tempo stays at the prelude's 72 rather than Gounod's ♩=66.
3. The coda is compressed from Gounod's five bars to our four; the final G is
   held to the end rather than released on a quarter with rests after it.
4. The voice's dynamic *marks* are Gounod's own, unaltered; what moves is
   where they land. The track declares `velocityRange: [56, 127]`, remapping
   the whole 0..127 velocity domain into that band, so `pianissimo` sounds at
   ~74, `piano` ~83, `forte` ~110, `fortissimo` ~119 against the piano's
   48–112. At the raw values the melody was quieter than the accompaniment it
   sits over — the prelude spends most of its length at 56–96 — and vanished
   in the soft passages. Relative spacing, the alternation, the crescendos and
   the climax all keep their written shape.
