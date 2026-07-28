# Syntax differentiation audit — play.yaml vs Tidal/Strudel mini-notation

Date: 2026-07-28. Full grammar audit of play.yaml against the GPL/AGPL pattern
languages (TidalCycles GPL-3, Strudel AGPL-3), prompted by the question:
*does any current syntax need refactoring to avoid reading as a mini-notation
derivative?* Companion: [livecoding-landscape.md](livecoding-landscape.md) has
the full mini-notation inventory and license map.

## Verdict

**No refactor of existing syntax is needed.** No AGPL/GPL-derived code exists
in the repo, none of Tidal's distinctive operators are implemented, and the two
shared characters (`~` rest, `_` hold) are standard music-notation conventions
that predate TidalCycles. Where play.yaml and Tidal use the *same brackets*,
they mean **different things** — which is affirmative evidence of independent
design, and refactoring those to chase cosmetic distance would destroy that
evidence while breaking every score.

The obligation this audit *does* create is forward-looking: **new generative
syntax must not adopt mini-notation spellings** (the rules below).

## Element-by-element audit

| play.yaml syntax | Tidal/Strudel counterpart | Assessment |
|---|---|---|
| space-separated tokens share the measure | space-separated tokens share the cycle | Generic "N tokens fill the slot" idea — also how Alda (EPL), MML, and jFugue work. Ours divides a *metered measure*, not an abstract cycle. Keep. |
| `~` rest (`song.ts:272`) | `~` rest | Same character, same meaning — but `~` -as-silence long predates Tidal (and is YAML's own null). Single-character convention, independently arrivable. Keep. |
| `_` hold/tie (`tokens.ts:13`) | `_` elongate | Same character, same meaning — also the LilyPond/tracker sustain convention. Our implementation (mutating prior event durations, working across barlines/nesting) is unrelated to pattern algebra. Keep. |
| `[c e g]` = **chord** (simultaneous) | `[ ]` = **subdivision** | **Inverted semantics.** Ours is the universal "stacked notes" bracket. Keep. |
| `{c d}` = **weighted subdivision** | `{ }` = **polymeter** | **Different semantics.** Ours is Alda's cram bracket. Keep. |
| `5>` `5<` postfix accent/ghost (±16 velocity) | `<a b>` paired alternation | Different meaning, different position: ours are unpaired postfix marks (standard accent semantics), never content delimiters. Keep. |
| `c4:` `c4.` duration weights | Strudel `bd:3` sample index; Tidal `@` weight | Different meaning: ours are the augmentation dot (×1.5) and a doubler (×2) from standard notation. Keep. |
| `[c e g]~` strum, `sd~` drum roll | — no counterpart | Original to play.yaml. |
| `- 8x:` measure repeat (YAML key) | `!` replicate / `*` speed | Different layer (YAML mapping key, adds time) and different form. Closest analog is MML's loop. Keep. |
| `\|\|g lyd, oct up\|\|` inline set fence | — | Original. |
| `==Dm7==` inline chord-scale fence | — | Original. |
| `&th1` / `*th1` anchors | `*` speed operator | Coincidental character collision only — standard YAML 1.1 anchors, parsed at the YAML layer, never inside a measure string. Keep. |

Not implemented anywhere in play.yaml (verified by grep + parser read):
euclid `(3,8)`, `*n`/`/n` speed, `<a b>` alternation, `!` replicate, `?`
probability, `@` weight, `{ }%n` polymeter, `.` grouping, `,` stacking, `|`
random choice, `..` ranges, combinator/transform chaining.

Prior clean-room items already on record in
[similar-projects.md](similar-projects.md): share links (web-standard
CompressionStream, no Strudel code) and hot-swap (Sonic Pi idea; MIT anyway).

## Differentiation policy for new syntax

Binding rules for every future grammar addition, especially the generative
features in [generative-design.md](generative-design.md):

1. **Ideas, never code.** Euclidean rhythms, alternation, probability, Markov
   chains are concepts/math (Toussaint 2005, Xenakis, decades of computer
   music). Implement from the definition, never from GPL/AGPL sources. Don't
   open Strudel/Tidal source while implementing; work from public docs and
   papers only.
2. **No mini-notation spellings.** Concretely banned in measure strings:
   `(p,s)` euclid calls, `*n` / `/n` step math, paired `< >` alternation,
   `?`-suffix probability, `!` replication, `@` weights, `%n` polymeter,
   `,`-stacking, `|`-choice, `..` ranges. If a proposed token would parse
   identically in Strudel, respell it.
3. **Prefer the YAML layer over string operators.** play.yaml's identity is
   "a YAML document that reads like a score." Generative constructs should be
   *named YAML directives* (like the existing `- set:`, `- 8x:`) rather than
   symbol soup inside strings. This is simultaneously the strongest
   differentiation and the most on-brand design: Tidal compresses everything
   into one expression string; we spell things out as data.
4. **Words over sigils.** Where a construct must appear inline, use readable
   names (`every 2`, `rotate 3`) not punctuation. Our precedent is the `set:`
   mini-language (`"crescendo to f over 2"`), which reads as score directions,
   not operators.
5. **Determinism.** Any randomness is seeded from score content (explicit
   `seed:` prop with a stable default) so a document always compiles to the
   same MIDI. This is also a hard technical requirement of the golden-digest
   tests. Live-coding-style unseeded randomness is a non-goal.
6. **Document lineage.** Every feature inspired by another system gets a note
   in the design doc naming the system, the license, and what was and wasn't
   taken (pattern already established in similar-projects.md).

## Why not rename `~` / `_` anyway?

Considered and rejected. They are (a) generic conventions with independent
lineage (music notation, trackers, YAML null), (b) two characters out of a
17-element signature inventory — nobody identifies mini-notation by its rest
symbol, (c) load-bearing in all 24 examples, 4 song projects, 200 tests, the
golden digest, the MusicXML converter, and users' local scores. Cosmetic
distance is not worth a breaking change to every document in existence; the
similarity that matters (operator combination) is absent by construction.
