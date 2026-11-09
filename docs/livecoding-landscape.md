# Live coding landscape — deep survey (2026-07)

Research pass over the major open-source live coding music systems: what they
are, how their syntax works, and — critically for play.yaml — **which are
copyleft**. All licenses verified against the repositories on 2026-07-27, not
from memory. Companion docs: [syntax-differentiation.md](syntax-differentiation.md)
(what this means for our syntax) and [generative-design.md](generative-design.md)
(what we build from these ideas). The earlier, broader notation survey lives in
[similar-projects.md](similar-projects.md).

## License map (verified)

| Project | License | Copyleft? | Verified from |
|---|---|---|---|
| TidalCycles | **GPL-3.0** | Yes (strong) | github.com/tidalcycles/Tidal (archived → codeberg.org/uzu/tidal) |
| Strudel | **AGPL-3.0** | Yes (network copyleft) | github.com/tidalcycles/strudel |
| Hydra | **AGPL-3.0** | Yes (network copyleft) | github.com/hydra-synth/hydra |
| SuperCollider | GPL-3.0 | Yes | github.com/supercollider/supercollider |
| Mégra | GPL-3.0 | Yes | the-drunk-coder/megra.rs (archived → codeberg.org/parkellipsen/megra.rs) |
| Sardine | GPL-3.0 | Yes | Bubobubobubobubo/sardine |
| ixi lang | GPL-3.0 | Yes | github.com/thormagnusson/ixilang |
| FoxDot | CC BY-SA 4.0 (content license on code — legally awkward) | Share-alike | Qirky/FoxDot |
| Sonic Pi | **MIT** (core; GUI binaries link GPL components) | No (core) | sonic-pi-net/sonic-pi LICENSE.md |
| Gibber | MIT | No | github.com/gibber-cc/gibber |
| Orca | MIT | No | github.com/hundredrabbits/Orca |
| Glicol | MIT | No | github.com/chaosprint/glicol |
| ChucK | Dual MIT / GPL-2.0-or-later (your choice) | Optional | github.com/ccrma/chuck |
| Extempore | BSD 2-Clause | No | github.com/digego/extempore |
| Alda | EPL-2.0 | Weak (file-level) | github.com/alda-lang/alda |

The copyleft cluster is exactly the Tidal ecosystem plus SuperCollider-family
tools. AGPL on Strudel and Hydra matters specifically because they are web
apps: even *hosting a modified copy* triggers the source-offer obligation.
play.yaml is MIT — we can **borrow ideas from anything, and code only from the
permissive cluster** (and in practice we borrow no code at all; the core is
dependency-free).

## Project profiles

### TidalCycles (GPL-3.0) — the pattern-language archetype
Haskell EDSL (Alex McLean, ~2009); audio via SuperDirt/SuperCollider over OSC.
A `Pattern a` is a function from a time-span to events; cycle-based time,
infinitely subdividable. Mini-notation strings embed sequences; combinators
transform whole patterns:

```haskell
d1 $ sound "bd sd [hh hh] bd*2"
d1 $ n "0 <1 2> 3(3,8)" # s "arpy" # pan sine
d1 $ every 4 (rev . fast 2) $ sound "bd*2 [~ cp]" # speed "1 2"
```

Signature ideas: everything-is-a-pattern (effect params included), higher-order
transforms (`every`, `jux`, `sometimesBy`, `off`), the algorave lingua franca.

### Strudel (AGPL-3.0) — Tidal in the browser
JS port of the Tidal pattern algebra (method chaining + the same mini-notation
in strings). Zero-install REPL, shareable URLs, pianoroll/punchcard
visualizations; made Tidal-style live coding massively accessible.

```js
n("0 <1 2> 3(3,8)").scale("C:minor").s("piano")
s("bd*2, ~ cp").sometimesBy(0.3, x => x.fast(2)).jux(rev)
```

### Sonic Pi (MIT core) — education-first imperative live coding
Ruby DSL; deterministic logical time (`sleep`), `live_loop` hot-swap with
beat-accurate sync. No pattern mini-language — loops plus `ring`/`tick`/
`choose`, and `spread(3,8)` for euclidean booleans.

```ruby
live_loop :melody do
  use_synth :prophet
  play scale(:e3, :minor_pentatonic).choose, release: 0.2
  sleep 0.25
end
```

### SuperCollider (GPL-3.0) — the foundational platform
`scsynth` server + `sclang`. Its pattern library is the *other* great pattern
model: lazy value **streams** (`Pseq`, `Prand`, `Pwhite`, `Pwrand`, `Pn`)
zipped into timed events by `Pbind` — event-stream, not cycle-based.

```supercollider
Pbind(\degree, Pseq([0, 2, 4, 7], inf), \dur, Pwrand([0.25, 0.5], [0.7, 0.3], inf)).play;
```

### FoxDot (CC BY-SA 4.0) — Pythonic algorave
Player objects with list patterns: `p1 >> pluck([0,2,4,7], dur=[1/2,1/4])`,
character-step drum strings `play("x-o-")`, euclidean durations `PDur(3,8)`,
pattern arithmetic (`P[0,1,2] + 7`). Maintenance mode; Renardo is the fork.

### Gibber (MIT) — browser audiovisual pioneer
Any property is sequencable: `s.note.seq([0,7,14], [1/4,1/8])`; drum strings
`Drums('x*ox*xo-')`. Sample-accurate JS scheduler; animated editor feedback.

### Orca (MIT) — spatial esolang sequencer
2-D grid; each letter is an operator evaluated per frame; bangs trigger events;
`U` is euclid, `C` clock, `D` every-Nth-frame. Sends MIDI/OSC/UDP only. The
code *is* the score.

### ChucK (MIT/GPL dual) — strongly-timed language
`=>` patches unit generators and advances time; sample-accurate `now`;
concurrent shreds. No pattern DSL — time-advancing loops.

### Extempore (BSD-2) — temporal recursion
Scheme + xtlang (JIT-compiled Lisp). Scheduling primitive is a function that
`callback`s itself at a future beat. Hot-swaps *compiled* DSP.

### Glicol (MIT) — graph-oriented, Rust/WASM
The whole language is an audio graph: `b: speed 2.0 >> seq 60 _60 _ 67 >>
sawsynth 0.01 0.1 >> lpf 300 1.0`. Sequencing is just another node (`seq`
with `_` filler tokens).

### Mégra (GPL-3.0) — probability-first
Lisp syntax over Rust. Sequencing as **variable-order Markov chains** specified
or learned live (`infer`/`learn`), chance modifiers on everything. The deepest
open-source treatment of stochastic sequencing.

### Alda (EPL-2.0) — score-as-text
Composition-first notation: `piano: o3 c8 d e f g4 a2`, voices, cram brackets
`{c d e}2`, repeats `*4`. The closest published relative of play.yaml's
"readable score" ethos (and a safe, non-Tidal prior-art lineage).

### ixi lang (GPL-3.0) — constraint as instrument
Whitespace-positional score strings (`drums -> |b  s  b b s |`) where *column
position is time*; named agents accept transform commands (`drums shake`).

### Sardine (GPL-3.0) — modern Python
Temporal recursion (`@swim`) plus its own string pattern parser (chords,
qualifiers, ranges). Firmly in the Tidal ecosystem via SuperDirt.

### Hydra (AGPL-3.0) — visuals context
Shader chains (`osc(10,0.1).rotate(0.5).out()`); parameters accept arrays that
step per frame. Included here as the second big AGPL web app in the scene.

## Tidal/Strudel mini-notation: the signature inventory

These spellings, *in combination*, are what the community reads as "Tidal
mini-notation" (verified against https://tidalcycles.org/docs/reference/mini_notation).
This is the do-not-imitate list for any new play.yaml syntax:

| Element | Meaning | Example |
|---|---|---|
| space-separated steps in a quoted string | evenly subdivide one cycle | `"bd sd hh sd"` |
| `~` | rest | `"bd ~ sd ~"` |
| `[ ]` | subgroup squeezed into one step | `"bd [hh hh] sd"` |
| `.` | group separator | `"bd sd . hh hh hh"` |
| `,` inside `[ ]`/`{ }` | simultaneous layers (polyrhythm) | `"[bd sd, hh hh hh]"` |
| `*n` | repeat/speed a step n× within its slot | `"bd*2 sd"` |
| `/n` | slow a step — once every n cycles | `"bd/2 sd"` |
| `< >` | alternation — one element per cycle | `"bd <sd cp arpy>"` |
| `!` / `!n` | replicate as separate steps | `"bd!3 sd"` |
| `?` / `?0.7` | random drop with probability | `"bd? sd hh?0.2"` |
| `@n` | elongate step to n units of width | `"bd@3 sd"` |
| `_` | extend previous event one step | `"bd _ _ sd"` |
| `(p,s)` / `(p,s,r)` | euclidean rhythm, optional rotation | `"bd(3,8,2)"` |
| `{ }` + `%n` | polymetric group, n steps per cycle | `"{bd sd, hh hh hh}%4"` |
| `\|` | random choice per cycle | `"[bd\|cp\|hh]"` |
| `:n` | sample index | `"arpy:3"` |
| `..` | numeric range expansion | `"0 .. 7"` |

Individually generic elements (euclidean rhythms as math, `~` as rest,
`"x-o-"` drum strings à la FoxDot/Gibber) predate or exist outside Tidal; it is
the **combination and exact spellings** above that constitute its identity.

## Legal context (brief, factual — not legal advice)

- Copyright protects concrete **implementation code** (and docs, samples,
  artwork) — not ideas, algorithms, or methods of operation. Reimplementing
  pattern-language *concepts* (cycles, euclidean rhythms, alternation) without
  copying code is not a license question.
- Language **syntax and APIs** are weakly protectable at most: *SAS Institute
  v. World Programming* (EWCA 2013; US 4th Cir. 2023) held a language's
  functionality/syntax largely unprotectable; *Google v. Oracle* (SCOTUS 2021)
  found reimplementing an API's declaring structure fair use.
- Practical rule for this repo: **clean-room implementations with visibly
  distinct syntax**. That avoids both residual legal ambiguity and — often more
  important in a small community — social friction with the GPL/AGPL projects.
  Copying Strudel's mini-notation *parser* into MIT code would violate AGPL;
  designing a differently-spelled notation over similar musical ideas does not.

## What this survey suggests we adopt (ideas, never code)

1. **Deterministic, seeded generativity** (Tidal/SuperCollider concept): all
   randomness must be reproducible from the score alone — a score is a
   document, so identical input must compile to identical MIDI.
2. **Euclidean rhythms** (Toussaint 2005 — math, not Tidal property): the
   single highest-value generative primitive for percussion.
3. **Per-pass variation** (Tidal `<>`/`every`, SC `Pseq`): scores with looping
   sections need bars that differ across passes.
4. **Probability masks** (Tidal `?`, Mégra chance): ghost-note realism and
   evolving textures.
5. **Stream-style generators** (SuperCollider `Pbind` mental model, not its
   API): a declarative block that *emits* a measure list fits play.yaml's
   YAML-first shape far better than an in-string operator language.
6. **Humanize** (every DAW, Sonic Pi's onset jitter): timing/velocity spread as
   a track prop, not per-note syntax.

How each becomes concrete play.yaml syntax — with spellings chosen to be
visibly *not* mini-notation — is [generative-design.md](generative-design.md).
