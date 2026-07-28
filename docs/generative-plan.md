# Generative features — implementation plan

Date: 2026-07-28. Executes [generative-design.md](generative-design.md) under
the policy in [syntax-differentiation.md](syntax-differentiation.md). Research
inputs: [livecoding-landscape.md](livecoding-landscape.md) and
[generative-techniques.md](generative-techniques.md).

## Phase 1 — core module (`packages/core/src/generate.ts`, new)

Pure, dependency-free functions; no new IR — generators expand to ordinary
measure strings before compilation.

1. `hash01(seed, a, b): number` — deterministic integer-mix RNG in `[0,1)`.
   Own construction (xorshift-style avalanche), stable across platforms —
   never `Math.random`.
2. `bjorklund(pulses, steps): boolean[]` — implemented from Toussaint's
   definition (maximally even distribution via the Euclidean algorithm), plus
   rotation. Property-tested against known patterns (E(3,8) tresillo
   `x..x..x.`, E(5,8), E(7,16)).
3. `expandSpread(spec): string` — layers → per-step tokens → chord merge →
   measure string.
4. `expandArp(spec, scaleCtx): string` — chord tones via existing
   `chordToScale`/`parseScale` + mode ordering → letter-note tokens.
5. `expandWalk(spec, state): string` — seeded weighted walk over degrees with
   reflecting bounds; walk state persists across items within one track.

## Phase 2 — wiring into the compiler (`packages/core/src/song.ts`)

1. `playItems()` (song.ts:413): recognize generator mapping items
   (`spread`/`arp`/`walk`) and `alternate:`; thread a **pass index** through
   `Nx:` expansion so `alternate` cycles per pass. Generators expand to
   measure strings here, so `playMeasureEntries`, `occupiesBar`,
   `measureSpan`, sections and the golden pipeline see plain measures.
   - As built: ALL expansion lives in `playItems` (single funnel, every
     consumer agrees). This works because `walk` emits degree tokens (the
     running scale applies later, in `placeToken`) and `arp` resolves its own
     `chord:`/`notes:` — so no generator needs `ctx.scale` at expansion time.
     Walk continuity is a small state object threaded through the expansion.
     Consequence: generators use their own `seed:` field (default 1); the
     track `seed` prop drives chance/humanize.
2. `TrackProps` + `INHERITED` (song.ts:31, 905): add `seed`, `chance`,
   `humanize`. Add to `SECTION_DIRECTIVE_PROPS` where sensible (`seed`).
3. `EmitCtx` (song.ts:216): add `seed`, `chance`; drop notes in the two emit
   paths of `placeToken` when `hash01(seed, time, midi) >= chance` (dropped
   note ⇒ `held = null`).
4. `parsePlayFull`: humanize post-pass over `ctx.events` (before the
   repeated-pitch trim); clamp times at 0; velocity clamped 1..127.
5. `set.ts`: new clauses `chance <0..1>|off`, `humanize <0..1>|off`,
   `humanize time X velocity Y`, `seed N` → `SetPatch` fields, consumed in
   `applyPatch` and play-directive mapping items.

## Phase 3 — sync points outside core

1. `packages/web/src/noteSpans.ts` — generated measures don't exist in the
   source text; `indexOf` misses must **skip without desyncing the cursor**
   for subsequent hand-written measures. Verify `alternate`/generator items
   flow through `playMeasureEntries` without throwing.
2. README.md — new "Generators" subsection in the DSL reference.
3. `docs/similar-projects.md` — mark wishlist items 3/4 (euclid, alternation)
   shipped with a pointer here.

## Phase 4 — tests & examples

1. `packages/core/test.ts`: new sections — bjorklund known patterns; spread
   layering/rotate/melodic; alternate cycling inside `4x:` and `loop: N`
   sections; chance 0/1 edge cases + determinism (same seed ⇒ identical
   timeline, different seed ⇒ different); humanize bounds + determinism;
   arp modes; walk bounds/continuity; set-clause parsing.
2. New `examples/generative-lab.play.yaml` exercising every feature
   (spread kit groove, alternate fills, chance hats, humanized keys, arp
   pad, walk melody).
3. `UPDATE_GOLDEN=1 npm test -w @play.yaml/core` — expect **only** the new
   example added to `examples.golden.json`; any changed digest for existing
   files means a behavioral regression (chance/humanize default off must be
   bit-identical).
4. `npm test` at root (core suite + cli/web `tsc --noEmit`).

## Risks / decisions on record

- **Golden stability** is the regression oracle: defaults (`chance` absent,
  `humanize` absent, no generator items) must leave all 24 existing digests
  untouched.
- **Highlight degradation**: generated bars get no editor highlight in v1
  (no source text to point at) — acceptable; noted in README.
- **Forever-loop tails**: `alternate` can't vary an infinite compiled body;
  documented in the design doc.
- **Naming collisions**: `spread`, `alternate`, `arp`, `walk`, `chance`,
  `humanize`, `seed` — none collide with existing play-item keys (`set`,
  `scale`, numbered, `Nx:`) or track props; all are words, none are
  mini-notation spellings.

## Status

- [x] Research (landscape, techniques, codebase audit)
- [x] Docs: landscape, differentiation, design, plan
- [x] Phase 1 — generate.ts (hash01, bjorklund, spread/arp/walk, humanize)
- [x] Phase 2 — song.ts / set.ts wiring (playItems expansion, pass threading,
      chance/humanize/seed props + clauses + directives + section overrides)
- [x] Phase 3 — README "Generators" section, similar-projects.md items 3/4/5
      marked shipped; noteSpans needed no code change (generated bars are
      skipped gracefully — no source text to highlight)
- [x] Phase 4 — 23 new test checks (223 total), examples/generative-lab
      .play.yaml, golden regenerated (only the new entry; all 24 existing
      digests bit-identical)
