# J.S. Bach — Trio Sonata No. 4 in E minor, BWV 528: II. Andante

The slow movement of the fourth organ trio sonata (c.1730). **45 bars, common
time, B minor**, three real voices — right hand, left hand, pedal — 1356 notes.

- **Casting**: all three on `keys`. The DSL has no organ sample; `keys`
  sustains where `bass` would pluck.
- **Tempo**: ♩=39 (Mutopia's marking for this movement).
- **Verified**: `play-yaml-import --verify` — 1356 source notes in, 1356 out,
  0 missing, 0 extra, 0 moved.

## Changelog

- **2026-08-06** — rebuilt from source. The previous version had the movement
  in **3/8** (that is the *third* movement, Un poco allegro), ran **32 bars
  instead of 45**, had 280 notes against 1356, asked for `sample: organ` —
  which the DSL does not know, so it fell through to the default synth — and
  contained 2 tokens that compiled to silence.
