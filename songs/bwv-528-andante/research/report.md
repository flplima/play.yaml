# BWV 528 — research report

Researched 2026-08-06. Replaces a report that asserted the wrong meter.

## The work

**Trio Sonata No. 4 in E minor, BWV 528**, one of the six organ trio sonatas
Bach assembled around 1730 for Wilhelm Friedemann. Three movements; the
outer two in E minor, the middle **Andante in B minor**. A trio in the strict
sense: three independent voices, one per limb, each on its own manual or the
pedals, so none can hide inside another.

## Identifying the movement

Mutopia's edition ships the sonata as three LilyPond files — `Adagio.ly`,
`Andante.ly`, `Allegro.ly` — but its rendered MIDI is numbered by score order,
which makes the naming ambiguous. The Andante was identified positively:

- `Andante.ly` opens `r8 fis h e cis e, a d` (German note names: rest, F♯, B,
  E, C♯, low E, A, D).
- `SonataIV-1.mid`'s top voice opens **f♯4 b4 e5 c♯5 e4 a4 d5** — the same
  line. `SonataIV-2.mid` opens b4 e5 e5 e5 d♯5 … in 3/8 and E minor, which is
  the third movement.

So `SonataIV-1.mid` is the Andante: **45 bars, common time**, key signature of
two sharps, three tracks (right 550 notes, left 505, feet 301).

## What the previous score got wrong

- **Meter.** It was written in 3/8. That is the third movement's meter; the
  Andante is in common time.
- **Length.** 32 bars against 45, and 280 notes against 1356.
- **`sample: organ`** — not a sample the DSL knows. It fell through to the
  default synth silently.
- Two tokens (`dis5` and one other) were German note names the DSL cannot
  read, and compiled to silence.

## Verification

`play-yaml-import --verify`: 1356 → 1356, nothing missing, invented or moved.
Re-checked against the source MIDI after assembly: identical.
