# Ave Maria — Charles Gounod over J.S. Bach's BWV 846

Gounod's *Méditation sur le premier Prélude de J. S. Bach* (1853): a single
sustained melody laid over Bach's Prelude No. 1 in C major (1722). Both works
are public domain.

- **Source**: the melody follows the **1856 Heugel edition for solo violin**,
  as typeset by the Mutopia Project (Public Domain / CC0). The violin line is
  used, so the piece is instrumental. See `research/report.md`.
- **Form**: **39 bars** — Gounod's four-bar piano introduction, then the full
  35-bar prelude with the melody over it. One pass, no loop.
- **The piano is `examples/bwv846.play.yaml`**, unchanged. The `intro` section
  quotes its first four bars; the `piece` section is the whole prelude. Both
  verified programmatically against that file: the intro's 64 notes and the
  body's 549 notes match it exactly, every time / pitch / duration / velocity
  equal.
- **Key/meter/tempo**: C major, 4/4, 72 bpm (the prelude's own tempo; Gounod
  marks *Andante semplice* ♩=66).
- **Casting**: `voice` is a warm synth pad (GM 89), `legato, cantabile`. It
  sustains through the whole notes the way a singer would and sits above the
  prelude's 16th-note wash rather than inside it. The piano stays on `epiano`.
- **Melody**: range G3–E6, entering at bar 5 and verified to match the source
  onset-for-onset in all 35 sung bars.

### Dynamics

Gounod's marks are kept exactly as written — `pianissimo` really is
`pianissimo`. What moves is where they land. A solo line that is literally
softer than its own accompaniment disappears, and the prelude sits at
mezzopiano-to-forte for most of its length, so the voice declares

```yaml
velocityRange: [56, 127]
```

which remaps the whole 0..127 velocity domain into that band. The marks keep
their meaning and their relative spacing, landing at roughly `pianissimo` 74,
`piano` 83, `forte` 110, `fortissimo` 119 — against the piano's own 48–112.
The quiet passages now sit above the accompaniment instead of under it, and
the climax still has somewhere to go.

`velocityRange` is a track prop added to the core DSL for this (see
`packages/core/src/song.ts`); it takes the same shapes as a control `range:`.

### How the melody was placed

Gounod plays Bach's first four bars twice — once alone, then again with the
voice — which is why his bar 5 is Bach's bar 1. With the introduction in
place, **this file's bar numbers agree with Gounod's own** through bar 26.

The mapping was not done by ear: the prelude was aligned against Gounod's own
piano part bar-by-bar on pitch-class sets (Needleman-Wunsch), so every melody
bar sits over exactly the harmony he wrote it against.

### Known deviations

- **Gounod's bar 27 dropped** — the spurious *Schwencke measure*, a bar Bach
  never wrote which the prelude correctly lacks. It removes one of the two
  repeated high-C bars; the 16th-note pickup still lands on a C6. This is the
  one place after bar 26 where our numbering runs one behind Gounod's.
- **Coda compressed** from Gounod's five bars to four; the final G is held to
  the end rather than released early.
- **Tempo** stays at the prelude's 72 rather than Gounod's ♩=66.

Changelog:
- v1: initial transcription; melody from the Mutopia/Heugel violin edition,
  piano copied unchanged from `examples/bwv846.play.yaml`.
- v2: voice dynamics moved into a `velocityRange` band rather than rewriting
  Gounod's marks.
- v3: authentic Bach bar 26 restored in `examples/bwv846.play.yaml` (34 → 35
  bars, now matching a reference edition exactly), so Gounod's phrase over it
  is no longer dropped. The prelude and this file were fixed together.
- v4: Gounod's four-bar piano introduction added as an `intro` section, voice
  tacet through it. 35 → 39 bars; the voice now enters at bar 5, as written.
