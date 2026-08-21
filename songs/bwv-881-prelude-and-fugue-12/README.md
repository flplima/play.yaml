# J.S. Bach — Prelude and Fugue No. 12 in F minor, BWV 881

Both movements of No. 12 from *The Well-Tempered Clavier*, Book II (1742), in
order. **2/4 throughout, F minor**, 2591 notes.

| | bars | voices | notes | tempo |
|---|---|---|---|---|
| Prelude | 140 (+ pickup) | 2 | 1473 | ♩=76 |
| Fugue | 85 | 3 | 1118 | ♩=92 |

The prelude is the most galant thing in either book — a singing right hand
over a left that walks in even eighths, closer to a Scarlatti sonata than to
the counterpoint of Book I. The fugue's subject starts off the beat with a
leap of a sixth and picks its way down in sighing seconds.

- **Casting**: everything on `piano`. The five tracks are the five real voices
  (two in the prelude, three in the fugue), not five instruments.
- **Verified**: the fugue imports exactly (1118 → 1118, nothing moved); the
  prelude is complete with 20 notes nudged by at most 0.02 beat by `--snap 16`,
  which is the source sequence's own jitter.

## Two independent sources, and they agree

The prelude comes from Yo Tomita's sequence, the fugue from Kyle Rother's
scholarly LilyPond edition. Aligned at the fugue's eighth-note pickup,
**1116 of 1118 notes match Tomita's sequence of the same movement note for
note — 99.8%**; the five that differ are ornaments Tomita writes out.

## Changelog

- **2026-08-06** — rebuilt from source. The previous version had neither
  movement's notes: it spelled an F minor piece in sharps throughout, declared
  no meter (so it compiled in 4/4 rather than 2/4), and ran a few dozen bars
  against the real 140 + 85.
