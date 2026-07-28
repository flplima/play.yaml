# Algorithmic generation techniques — research catalog

Date: 2026-07-28. The raw research behind
[generative-design.md](generative-design.md): every technique surveyed, who
implements it and how, licenses (verified from repositories), and how each
would look as declarative YAML. Kept as reference for future phases.

## 1. Euclidean / Bjorklund rhythms

Distribute k onsets maximally evenly over n steps (Bjorklund's SNS timing
algorithm; Toussaint 2005). E(3,8) = tresillo `x..x..x.`. Implementations
differ by rotation on ~9 of the 26 canonical patterns — an explicit `rotate`
parameter is essential.

- Tidal (GPL): `"bd(3,8,1)"`, `euclid`, `euclidInv` (off-steps),
  `euclidFull` (hits + complement), boolean form with `struct`.
- Strudel (AGPL): same mini-notation; `.euclid`, `.euclidRot`,
  `.euclidLegato` (onsets sustain to the next).
- Sonic Pi (MIT): `(spread 3, 8, rotate: 1)` → boolean ring (cites Toussaint).
- SuperCollider (GPL): `Bjorklund(k,n)` booleans, `Bjorklund2` inter-onset
  durations, `Pbjorklund`/`Pbjorklund2` patterns.
- FoxDot (CC BY-SA): `PEuclid(n,k)`, `PDur(3,8)` → `[0.75,0.75,0.5]`.
- Orca (MIT): `U` operator — euclid in one grid cell.

Two useful output modes: boolean mask and duration list. Sweet spots:
(3,8), (5,8), (7,16), (5,12), (7,11). **v1: `spread:` item.**

## 2. Probabilistic events

- Tidal: `?`/`?0.8` drop suffix, `degradeBy`/`undegradeBy` (exact
  complements — same RNG stream), `sometimesBy p f`, named ladder
  `always/almostAlways/often/sometimes/rarely/almostNever/never`
  (1/.9/.75/.5/.25/.1/0), `wchoose`.
- Sonic Pi: `one_in(6)`, `dice`, `choose`, all deterministic under its seed
  model.
- SuperCollider: `Prand`, `Pxrand` (no immediate repeat), `Pshuf`, `Pwrand`,
  `Pif`.
- FoxDot: `PRand(seed=)`, `PwRand`, player-level `sometimes/often/rarely`.
- Mégra (GPL): `pear :p 10` per-event modifiers, `apple` probabilistic
  generator modifiers.

**v1: `chance` set-clause.** The named ladder (often/rarely…) is nice enum
sugar for later.

## 3. Seeded / deterministic randomness — the architecture choice

- **Sonic Pi — seeded stateful stream**: all randomness reads a fixed
  pre-generated stream; every run resets it ("the same code sounds identical
  on every machine"); `use_random_seed` re-indexes; per-thread isolation.
- **Tidal/Strudel — pure time-hash**: `rand`/`?`/`degradeBy` hash the query
  time; no seed API; reproducible by construction; "reseeding" =
  time-shifting the pattern.
- SuperCollider: both (`thisThread.randSeed`, `Pseed`). FoxDot: `seed=`.

**v1 takes the time-hash model with an explicit `seed` mixed in** —
render = pure function of the file. Contract: every stochastic value is
`hash(seed, beatTime, salt)`.

## 4. Markov chains (deferred)

States with successor distributions; hand-authored tables (Xenakis/Hiller)
or trained by counting transitions. Literature: Ames 1989 (*Leonardo* 22(2));
Hiller & Isaacson 1959.

- SuperCollider: `Pfsm` (probability by duplicating successor indices),
  `MarkovSet.fill(1000, stream)` trains, `MarkovSetN` order-n.
- Tidal: `markovPat steps start matrix`.
- FoxDot: `PChain({0:[3,4], 3:[0,4,5]})`.
- **Mégra (GPL) — the deep case**: every generator is a variable-order
  probabilistic finite automaton. Built by shape (`cyc`, `nuc`, `flower`,
  `friendship`), explicit `rule 'aaa 'c 100 200` (multi-symbol context =
  higher order), or **learned from a sample string** (`learn :sample
  "xoxo…"`). Runtime evolution: `grow`/`shrink`/`blur`/`solidify`; the
  "small data" thesis — tiny corpora, imperfect models, as aesthetic.

YAML sketch: `markov: {order: 1, transitions: {C: {F: .5, G: .5}}}`, plus a
Mégra-style `learn: {alphabet: {x: kick}, sample: "xoxo xxoo"}` trainer.

## 5. L-systems (deferred)

Parallel rewriting: axiom + productions → self-similar strings; interpreted
symbol→pitch/dur (Prusinkiewicz 1986 ICMC). SuperCollider `Prewrite`; Tidal
`lindenmayer iterations rules axiom` consumed via `step'`. Stochastic and
context-sensitive variants exist. YAML sketch in the design doc.

## 6. Arpeggiation

- Tidal `arp` — 14 documented modes: `up down updown downup up&down down&up
  converge diverge disconverge pinkyup pinkyupdown thumbup thumbupdown`;
  `rolled`/`rolledBy` strum.
- Strudel `.arp("0 [1,3] 2")` — index patterns subsume named modes;
  `.voicing()` dictionaries.
- Sonic Pi: chord rings + `.tick`/`.reflect`/`.mirror`.
- SuperCollider: chord arrays + `\strum` (default event key, seconds between
  tones).
- **v1: `arp:` item** with the useful subset (`up down updown downup
  converge diverge random`) + `notes:`/`tones:` escapes.

## 7. Generative chord progressions (deferred — own design doc when taken)

- Rohrmeier 2011 (*JMM* 5(1)): generative grammar of tonal harmony —
  `TR → DR t`, secondary dominants `X → D(X) X`, substitutions, modulation
  as key-cast.
- Steedman 1984 (*Music Perception* 2(1)): six rules expanding 12-bar blues
  into bebop changes; tritone substitution `V7 → bII7`; ii-V chains via
  recursion.
- HarmTrace (Haskell, GPL-3): the grammar as datatypes with error-correcting
  parsers. Impro-Visor (GPL-2): probabilistic CFG lick grammars.
- JFugue (Apache-2): `ChordProgression("I IV V").setRoot("C")` — declarative
  Roman-numeral *authoring* (a safe prior-art lineage for us).

## 8. Pattern transformations (partially deferred)

The cross-system core vocabulary: reverse, palindrome, rotate, iterate,
every-N conditional, concat/interleave, stutter/echo (`ply`, `Pdup`),
shuffle vs scramble (permutation vs with-repeats), layer/superimpose/`off`
(shifted copy)/`jux` (transformed copy panned), transpose/invert.
Higher-order operators (`every`, `off`, `sometimes`, `jux`) take transforms
as arguments — which YAML expresses naturally as nested lists and
mini-notation cannot. v1 ships only `alternate` (Tidal `<>` ≈ SC `Pseq`
per-pass selection); an ordered `transforms:` list is the v2 shape.

## 9. Density & masking (deferred)

Tidal `struct` (impose boolean structure), `mask` (keep where true), `sew`/
`stitch` (switch sources by mask), ramps via `degradeBy (range 0 .9 saw)`.
SC: `Pwrand([note, Rest()], …)` with ramped p. YAML sketch:
`density: {from: .1, to: .9, over: 8}` → per-event keep-probability; a
natural extension of `chance` with the existing `over N` ramp language.

## 10. Random walks

- SuperCollider: `Pbrown(lo, hi, step)`, `Pgbrown` (geometric), `Pwalk(list,
  stepPat, directionPat)` with reflect-at-boundary.
- FoxDot: `PWalk(max, step, start)`.
- Tidal/Strudel: continuous `perlin` only; discrete walk via `markovPat`.
- Params that matter: step set/weights (±1..3 degrees), range (~2 octaves),
  boundary policy (clamp/reflect/wrap), seed. **v1: `walk:` item (reflect).**

## 11. Swing / humanize

- Tidal `swingBy (1/3) 4`; Strudel same; Sonic Pi `with_swing shift, pulse:`
  (time_warps every pulse-th run); SC `\timingOffset` + `Pgauss(0, 0.008)`;
  FoxDot `delay=PWhite(0, .05)`.
- Classic values: swing 1/3 (triplet feel); humanize timing σ 5–15 ms,
  velocity ±10–20%.
- **v1: `humanize`** (seeded, compile-time). Swing deferred: play.yaml
  already notates swing explicitly as `{a _ b}` triplet groups
  (docs/song-workflow.md convention); a `swing:` prop would duplicate that.

## 12. Constraint counterpoint (out of scope)

Strasheela (Oz — **no license declared**, avoid), Sandred's Cluster Engine,
music21 species *checkers*. Fux 1725 rules as CSP: only consonances, no
parallel/hidden perfects, prefer steps, first/last perfect. Requires a
solver; a different project. Survey: Anders & Miranda 2011 (*ACM Computing
Surveys* 43(4)).

## 13. Cellular automata & grids (deferred)

Orca (MIT) is CA-*like* but actually a spatial imperative language — not a
fit for YAML. True CA music (Wolfram ECA rows → degrees; WolframTones;
Miranda 1993/2001, Burraston & Edmonds 2005) *is* YAML-friendly:
`ca: {rule: 110, cells: 16, init: center, map: …}`.

## 14. Other families on the shelf

- **Serial ops** (music21.serial, BSD): P/I/R/RI row transforms — pure list
  math, trivial later.
- **Xenakis sieves** (Ariza 2005, *CMJ* 29(2); music21.sieve): residue-class
  unions `3@2|4@1` → pitch/rhythm grids. Extremely YAML-friendly.
- **Talea** (abjad-ext-rmakers, **MIT**): cyclic counts against a
  denominator, negative counts = rests, rotating read head — arguably the
  best declarative rhythm-generator model in the wild; strong v2 candidate.
- **Mégra lifemodel** (GPL, concept): generators with growth/decay resource
  pools — organic long-form evolution.
- **Chaos maps** (Pressing 1988): logistic map r∈[3.5,4] quantized to scale.

## 15. Declarative-format prior art (non-Tidal syntax space)

| Format | Model | License note |
|---|---|---|
| Nestup | rhythm-only nested tuplets `[4] {3 2 {3}}`, ties, rotation | **custom dual license** (modified MIT minus sublicense/sell for non-commercial; GPL-3 path commercial) — study, never vendor |
| JFugue Staccato | flat tokens `C5q`, voices/layers, `ChordProgression("I IV V")` | v5 Apache-2.0 (v3/4 LGPL) |
| LilyPond | `\retrograde`, `\inversion`, `\modalTranspose`, `\repeat unfold` — declarative transform functions | GPL-3 |
| ABC | part algebra `P:(AB)3`, variant endings | spec open; abcjs MIT |
| MML | `cdefgab`, `o4`, `l8`, `[...]2` loops, per-channel strings | no unified spec |

The split this family proves: subdivision/sequencing algebra can be fully
declarative with zero randomness; the stochastic layer stays declarative iff
randomness is a pure function of (seed, time). None of the surveyed
techniques require Turing completeness — every one is a named generator with
parameters plus an ordered transform list. That is the thesis of our whole
generative design.

## 16. Literature index

Toussaint 2005 (BRIDGES) · Ames 1989, *Leonardo* 22(2) · Reppel 2020 ICLC
(Mégra, Zenodo 3939154) · Prusinkiewicz 1986 ICMC · Rohrmeier 2011, *JMM*
5(1) · Steedman 1984, *Music Perception* 2(1) · Anders & Miranda 2011, *ACM
Comp. Surveys* 43(4) · Miranda 1993; Burraston & Edmonds 2005 (CA) ·
Pressing 1988, *CMJ* 12(2) · Xenakis, *Formalized Music* · Ariza 2005, *CMJ*
29(2) · Fux 1725 · Hiller & Isaacson 1959.
