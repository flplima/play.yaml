# BWV 784 — research report

Researched 2026-08-06. Replaces a four-line report that named a source without
recording anything checkable.

## The work

**Invention No. 13 in A minor, BWV 784**, from the fifteen two-part Inventions
Bach wrote in 1723 for his eldest son Wilhelm Friedemann. Two voices, 4/4,
A minor, no tempo marking of Bach's own.

## The edition, and what it says

The Mutopia Project's LilyPond edition (see `sources.md`) has **25 bar checks
in each of the two voices and no `\repeat`** — so 25 bars is the edition's own
barring, not an artifact of the MIDI render, and there are no repeats to
expand. Its rendered MIDI is 564 notes over 100 quarter-note beats in two
tracks (301 + 263), which matches.

Other editions bar the piece differently; what is committed here follows this
one, because that is the text the notes came from.

## What the previous score got wrong

- **32 silent tokens.** The old file was written with German/Dutch note names
  (`gis4`, `dis5`) — the same convention the Mutopia LilyPond source uses via
  `\include "deutsch.ly"`, where `h` is B natural and `ais` is A sharp. The DSL
  does not read those, so `compileDoc` reported 32 unknown tokens and each one
  became silence.
- **Short.** 21 bars and 415 notes against 25 and 564.
- **Misbarred.** Its bar 1 packed four notes into beat 3 and started the next
  bar's material in beat 4.

## Verification

`play-yaml-import --verify`: 564 → 564, nothing missing, invented or moved.
Re-checked against the source MIDI after the header and casting were written:
identical.
