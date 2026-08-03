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
  `examples/bwv846.play.yaml`, which was copied unchanged (see below).
- **Original scoring** solo violin, orchestra and choir (1853); the familiar
  voice-and-piano form came later. The melody here is taken from the violin
  line, which is why it has no text.

## Structure, and how Gounod's bars line up with ours

Gounod plays Bach's first four bars twice: once as a piano prelude, then
again as the melody enters. So his bar 5 is Bach's bar 1. His melody then
runs to his bar 36, with a first/second ending and a short coda.

Rather than align by ear, our prelude was aligned against Gounod's own piano
part **bar-by-bar on pitch-class sets** (Needleman-Wunsch, gap-penalised).
Every bar matched exactly except two, both of which Gounod has and we do not:

| Gounod bar | pitch classes | what it is |
|---|---|---|
| 27 | C D# G B | the **Schwencke measure** — see below |
| 31 | C D F G | **authentic Bach bar 26**, absent from our prelude |

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

### The bar our prelude is genuinely missing

Cross-checked against the Mutopia typesetting of BWV 846 itself (35 bars,
140 quarter-beats): **`examples/bwv846.play.yaml` has 34 bars and is missing
authentic Bach bar 26** — a `C D F G` bar in the dominant-pedal section,
between its own bars 25 and 26. Bars 1–25 and 27–35 match the reference
one-for-one.

That file was left untouched as instructed, so Gounod's bar 31 — the phrase
rising from F that sits over it — is omitted rather than reharmonised. The
preceding bar ends on a quarter rest, so no pickup is broken; the line goes
from the C resolution straight into the D6 climax.

## Melody mapping (our bar → Gounod bar)

    ours  1–22  →  gounod  5–26     (+4)
    [gounod 27 dropped — Schwencke measure]
    ours 23–25  →  gounod 28–30     (+5)
    [gounod 31 dropped — authentic Bach bar 26, absent from our prelude]
    ours 26–30  →  gounod 32–36     (+6)
    ours 31–34  →  gounod 37–40     (second ending + coda)

Because each mapped pair has an **identical pitch-class set**, every melody
bar sits over exactly the harmony Gounod wrote it against.

## The melody itself

Range G3–E6. Shape: four long notes arching up and back (bars 1–4); a sighing
figure that leaps to a held note, drops an octave and climbs back by step
(5–8); a rising sequence stated three times, a step higher each time (12–17);
the great *crescendo molto*, one accented half note per bar answered by a
16th-note pickup, E–G–A–A–C (19–23); the climax, D6 then E6 at *ff / tutta
forza* (26–28); a two-octave scale down through the G7 (30); and a low
sustained C then G held under the piano's cadenza and final chord (31–34).

Gounod's dynamics alternate sharply — `cresc.` and `pp` bar by bar through
the sighing figures — and are reproduced as directive strings.

## Verification

- **Piano untouched**: the compiled piano timeline of this file is identical
  to `examples/bwv846.play.yaml` — 533 notes, every time / pitch / duration /
  velocity equal. Checked programmatically, not by inspection.
- **Melody faithful**: all 34 voice bars match the source violin line
  onset-for-onset and pitch-for-pitch under the mapping above.
- Compiles to 34 bars / 136 beats — the same length as the prelude alone.

## Known deviations

1. Gounod's four-bar piano introduction is absent: this prelude is a single
   34-bar pass, so the voice enters at bar 1 rather than after a repeat of
   bars 1–4. Adding it would mean changing the prelude.
2. The two dropped bars above.
3. Tempo stays at the prelude's 72 rather than Gounod's ♩=66.
4. The coda is compressed from Gounod's five bars to our four; the final G is
   held to the end rather than released on a quarter with rests after it.
