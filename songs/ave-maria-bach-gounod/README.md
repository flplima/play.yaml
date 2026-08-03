# Ave Maria — Charles Gounod over J.S. Bach's BWV 846

Gounod's *Méditation sur le premier Prélude de J. S. Bach* (1853): a single
sustained melody laid over Bach's Prelude No. 1 in C major (1722). Both works
are public domain.

- **Source**: the melody follows the **1856 Heugel edition for solo violin**,
  as typeset by the Mutopia Project (Public Domain / CC0). The violin line is
  used, so the piece is instrumental. See `research/report.md`.
- **The piano part is `examples/bwv846.play.yaml`, copied verbatim** — same
  notes, dynamics, pedalling and tempo shaping. Verified programmatically:
  the compiled piano timeline is identical across both files, 533 notes, every
  time / pitch / duration / velocity equal. The only addition is `voice`.
- **Key/meter/tempo**: C major, 4/4, 72 bpm (the prelude's own tempo; Gounod
  marks *Andante semplice* ♩=66).
- **Form**: 34 bars, one pass, no loop — the prelude's own length.
- **Casting**: `voice` is a warm synth pad (GM 89), `legato, cantabile`. It
  sustains through the whole notes the way a singer would and sits above the
  prelude's 16th-note wash rather than inside it. The piano stays on `epiano`.
- **Melody**: range G3–E6, verified to match the source onset-for-onset in all
  34 bars.

### How the melody was placed

Gounod's bar 5 is Bach's bar 1 — he plays the first four bars twice, once as
a prelude and again as the voice enters. Our prelude was aligned against
Gounod's own piano part bar-by-bar on pitch-class sets (Needleman-Wunsch), so
every melody bar sits over exactly the harmony Gounod wrote it against.

### Known deviations

- **No four-bar introduction.** This prelude is a single 34-bar pass, so the
  voice enters at bar 1 instead of after a repeat of bars 1–4. Adding the
  introduction would mean changing the prelude.
- **Gounod's bar 27 dropped** — the spurious *Schwencke measure*, a bar Bach
  never wrote which our prelude correctly lacks. It removes one of the two
  repeated high-C bars; the 16th-note pickup still lands on a C6.
- **Gounod's bar 31 dropped** — it belongs over **authentic Bach bar 26**,
  which `examples/bwv846.play.yaml` is missing (34 bars where the prelude has
  35; bars 1–25 and 27–35 match a reference edition exactly). That file was
  left untouched as instructed, so the phrase is omitted rather than
  reharmonised. The preceding bar ends on a rest, so no pickup is broken.
- **Coda compressed** from Gounod's five bars to four; the final G is held to
  the end rather than released early.

Changelog:
- v1: initial transcription; melody from the Mutopia/Heugel violin edition,
  piano copied unchanged from `examples/bwv846.play.yaml`.
