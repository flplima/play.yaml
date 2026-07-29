# Generative features — design

Date: 2026-07-28. What algorithmic generation play.yaml gets, why, and the
exact syntax. Grounded in [livecoding-landscape.md](livecoding-landscape.md)
(who does what, licenses) and bound by the rules in
[syntax-differentiation.md](syntax-differentiation.md) (no mini-notation
spellings; YAML directives over string operators; words over sigils; seeded
determinism; ideas, never code). The phased build-out is in
[generative-plan.md](generative-plan.md).

## Design principles

1. **A score is a document.** The same file always compiles to the same MIDI.
   Every random choice derives from a pure hash of `(seed, position)` — the
   Tidal *concept* of time-hashed randomness (and Sonic Pi's seeded-stream
   goal: "the same code sounds identical on every machine"), implemented
   independently. This is also what keeps the golden-digest tests meaningful.
2. **Generators are data, not operators.** Tidal compresses generativity into
   an expression string; play.yaml spells it out as named YAML items. A
   generator *expands to an ordinary measure string* inside the compiler, so
   everything downstream (weights, holds, sections, numbered bars, `Nx:`
   repeats, MIDI export) works unchanged.
3. **Small core.** Each generator is a pure function in one new module
   (`packages/core/src/generate.ts`), no dependencies, no new IR.

## Technique catalog (distilled)

What the ecosystem implements, where, and what we take. Full survey with API
details sits in the research appendix of [generative-plan.md](generative-plan.md).

| Technique | Prior art (license) | Verdict for play.yaml |
|---|---|---|
| Euclidean rhythms E(k,n,rot) | Toussaint 2005 (math); Tidal `(3,8)` (GPL), Sonic Pi `spread` (MIT), SC `Pbjorklund` (GPL), FoxDot `PDur` | **v1** — `spread:` item |
| Per-event probability | Tidal `?`/`degradeBy`, Mégra `pear :p`, SC `Pwrand` | **v1** — `chance` clause |
| Seeded determinism | Sonic Pi seed stream; Tidal time-hash | **v1** — `seed:` prop + hash RNG |
| Per-pass alternation | Tidal `<a b>`, SC `Pseq` | **v1** — `alternate:` item |
| Arpeggiation | Tidal `arp` (14 modes), Strudel `.arp`, SC `\strum` | **v1** — `arp:` item |
| Random walk over scale | SC `Pbrown`/`Pwalk`, FoxDot `PWalk` | **v1** — `walk:` item |
| Humanize (time/velocity jitter) | every DAW; SC `\timingOffset` `Pgauss`; Sonic Pi rrand idiom | **v1** — `humanize` prop/clause |
| Swing | Tidal `swingBy`, Sonic Pi `with_swing` | deferred — our `{a _ b}` triplet groups already notate swing; revisit as a prop |
| Markov chains | Mégra PFA (GPL), SC `Pfsm`/`MarkovSet`, Ames 1989 | deferred v2 — `markov:` item (sketch below) |
| L-systems | Prusinkiewicz 1986; SC `Prewrite`, Tidal `lindenmayer` | deferred v2 — `lsystem:` sketch below |
| Talea / cyclic-count rhythms | abjad-ext-rmakers (MIT) | deferred v2 — best declarative rhythm model in the wild |
| Masks / density ramps | Tidal `struct`/`mask`/`degradeBy saw` | deferred — `chance` + `||…||` ramps cover the core use |
| Xenakis sieves | music21.sieve (BSD), Ariza 2005 | deferred — pure data, easy later |
| Harmony grammars (ii-V-I, Rohrmeier/Steedman) | HarmTrace (GPL), JFugue `ChordProgression` (Apache-2) | deferred — big design surface, own doc when we take it |
| Cellular automata | Orca (MIT) model; Wolfram ECA | deferred — `ca:` is YAML-friendly but niche |
| Counterpoint solvers | Strasheela (no license!), Cluster Engine | out of scope — implies a constraint solver |

## v1 feature specification

### Determinism: the `seed` prop

```yaml
seed: 7          # any integer; track prop, inherited; default 1
```

Every stochastic decision is `hash(seed, beatTime, salt)` — a small integer
mixing function in `generate.ts`. Same file → same MIDI, always; change
`seed` to browse variations. `seed` is inheritable, settable per track, per
section directive, and via `set: seed 7`.

### 1. `spread:` — euclidean rhythm generator (play item)

Distributes hits as evenly as possible over a step grid (Bjorklund/Toussaint).
One mapping item generates **one measure**; layers stack:

```yaml
kit: standard
play:
  - spread: {steps: 16, bd: 5, hh: [13, 2], sd: [2, 4]}
  #           grid       ^pulses  ^[pulses, rotate]
  - 3x:
      - spread: {steps: 8, bd: 3, oh: [1, 4]}
```

- `steps:` (required) — grid resolution for the measure.
- Every other key is a measure token (drum name, note, degree — anything
  `placeToken` accepts); its value is `pulses` or `[pulses, rotate]`.
- Layers landing on the same step merge into a chord `[bd hh]`; empty steps
  become rests. The item expands to a plain measure string and compiles like
  any hand-written bar (weights, `Nx:`, sections all apply).
- Melodic tracks work too: `- spread: {steps: 8, 1: 3, 5^: [2, 3]}`.

Deliberately *not* `bd(3,8)`: no in-string call syntax. The name follows
Sonic Pi's `spread` (MIT — and only the word travels; the expansion is
implemented from Toussaint's definition).

### 2. `alternate:` — per-pass variation (play item)

Inside an `Nx:` repeat (or a finite `loop: N` section), plays a different
entry each pass, cycling:

```yaml
play:
  - 4x:
      - "bd ~ sd ~"
      - alternate:
          - "hh hh hh hh"       # passes 1 and 3
          - "hh hh {hh hh hh}"  # passes 2 and 4
```

- Entries may be measure strings, directives, or nested generator items.
- Outside any repeat, the first entry plays.
- In a forever-looping section tail the compiled body is fixed, so
  `alternate` varies within finite passes only — documented limitation.

Deliberately *not* `<a b>`: alternation is a named list, not paired angle
brackets in a string.

### 3. `chance` — seeded note probability (set clause)

A running probability that each struck note actually sounds, `0..1`
(`chance off` = `chance 1`). Available everywhere `set` language works:

```yaml
tracks:
  hats:
    kit: standard
    set: chance 0.9              # track-wide ghosting
    play:
      - "hh hh hh hh hh hh hh hh"
      - "||chance 0.5|| hh hh hh hh ||chance off|| hh hh hh hh"
      - chance: 0.7              # directive item form
```

Dropped notes are silent but still occupy their time slot (the groove
breathes; nothing shifts). Deterministic per `(seed, time, pitch)`.

Deliberately *not* `hh?0.5`: no `?` suffix; probability is a worded state
change, like our dynamics.

### 4. `humanize` — timing/velocity jitter (prop + set clause)

```yaml
humanize: 0.5                    # 0..1 intensity preset
# or explicit:
humanize: {time: 0.02, velocity: 6}   # ± beats, ± velocity steps
# or as a clause: set: humanize 0.5   /   ||humanize off||
```

Seeded, applied at compile time (visible in the MIDI export, not a playback
effect). Intensity 1 ≈ ±0.03 beats, ±10 velocity. Onset of the first beat of
the piece is never anticipated below 0.

### 5. `arp:` — arpeggio generator (play item)

Chord tones patterned over a measure:

```yaml
play:
  - arp: {chord: Dm7, mode: updown, steps: 8}
  - arp: {chord: Gm6, mode: up, steps: 8, octaves: 2}
  - arp: {notes: [d3, f3, a3, c4], mode: converge, steps: 8}
```

- `chord:` resolves tones through the existing chord-scale machinery
  (`Dm7` → D dorian → 1-3-5-7; plain triads give three tones), or pass
  `notes:` explicitly. `tones: [1,3,5,9]` overrides the degree pick.
- `mode:` `up down updown downup converge diverge random` (random is seeded).
- `steps:` tokens in the measure (cycling the tone list); `octaves:` extends
  the pool upward.
- Expands to letter-note tokens, so `==Dm7==` context, transposition and
  inheritance behave exactly as if you'd written the bar by hand.

### 6. `walk:` — random walk melody generator (play item)

A drunk walk over the **current scale** (degrees, so inline `==chords==` and
`scale:` re-key it):

```yaml
play:
  - "==Dm7=="
  - walk: {steps: 8, start: 1, span: [-3, 10]}
  - walk: {steps: 8, moves: [-2, -1, 1, 2], weights: [1, 3, 3, 1], seed: 12}
```

- `steps:` notes per measure; `start:` first degree (default 1; subsequent
  `walk` items continue where the last left off within the same track).
- `moves:`/`weights:` — allowed degree steps and their odds (defaults
  `[-2,-1,1,2]`, equal). `span:` reflecting boundaries in degrees.
- Emits degree tokens. Generators expand before track props apply, so `walk`
  and `arp`'s random mode take their own `seed:` field (default 1); the track
  `seed` prop drives `chance` and `humanize`.

Lineage: SuperCollider `Pwalk`/`Pbrown` and FoxDot `PWalk` (concept only).

## Deferred sketches (v2+, for the record)

```yaml
# Markov (Mégra-inspired, GPL — concept only; Ames 1989 for the math)
- markov: {steps: 8, start: 1, moves: {1: {3: 0.5, 5: 0.5}, 3: {1: 1.0}}}

# L-system (Prusinkiewicz 1986)
- lsystem: {axiom: F, rules: {F: "F+G", G: "F-"}, depth: 4,
            map: {F: {step: 1}, G: {step: -2}, "+": {dur: 0.5}}}

# Talea (abjad-ext-rmakers, MIT — cyclic counts, negative = rest)
- talea: {counts: [3, 2, -1, 2], denominator: 16, note: 1}

# Sieve (Xenakis / Ariza 2005)
- sieve: {formula: "3@2|4@1", steps: 16, note: bd}
```

Swing-as-prop, density ramps (`chance … over N`), harmony grammars, and CA
each get their own design pass before implementation.

## What stays out

- **Unseeded/live randomness** — breaks score-as-document and golden tests.
- **In-string operator algebra** (`*`, `/`, `!`, `@`, `?`, `< >`, `(k,n)`) —
  the entire point of [syntax-differentiation.md](syntax-differentiation.md).
- **Turing-complete scripting** — the survey confirms none of these
  techniques need it: every one is a named generator (data) plus transforms
  (data).
- **Counterpoint solving** — a constraint solver is a different project.
