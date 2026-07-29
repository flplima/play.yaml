# Similar projects — landscape, comparison, and what we can learn

Researched 2026-07-22 (web survey; per-project citations at the bottom).
play.yaml in one line, for positioning: **a YAML score format with a
measure-token notation** (equal-division strings, scale degrees, `[]` chords,
`{}` subdivisions, drum tokens, technique words) **compiling to timelines
played by a browser studio, a CLI, WebMIDI routing, and `.mid` export**, with
named sections/loops as the form model.

## The landscape

**Alda** — the closest *language* cousin. Plain-text scores → MIDI
(`piano: (tempo 90) o4 c8 d e f g4./f/d`), CLI/REPL only. Loved by its
community: cross-part **markers** (`%chorus` … `@chorus`), inline attribute
s-expressions, reusable phrase variables, and a cram bracket `{c d e}2` that
is exactly our `{}` group. Weakness users cite: GM-soundfont-only audio, no
notation output. ~5.9k★, active, EPL-2.0.

**ABC notation + abcjs** — the dominant ASCII tune format (since 1991, >40k
tunes on thesession.org). Header fields + letter tokens where case = octave;
abcjs renders **engraved SVG + browser playback with a score-following
cursor**. Strong for folk-tune interchange, weak for multi-track production.
abcjs ~2.3k★, MIT, active.

**LilyPond** — the text-input engraving gold standard (`\relative c' { c4 d e
f }`); publication-quality PDF/SVG, crude MIDI as a side-product. Loved:
`\relative` octave inference, named music variables, Scheme programmability.
GPL-3.0, 30 years mature.

**MML family** — chiptune-scene stateful terseness: `t120 o4 l8 cdefgab>c`
with sticky default length/octave, `[...]n` loops, channel-per-line. Outputs
chip formats (NSF/VGM) or MIDI. Scattered, niche, alive in Japan.

**TidalCycles / Strudel** — the live-coding pattern algebra (Haskell) and its
browser port (CodeMirror + Web Audio + WebMIDI — the closest *platform* to
our studio). Mini-notation is eerily close to our measures: space-separated
tokens share the cycle, `[a b]` subdivides, plus things we don't have —
`<a b>` alternates per cycle, `a*2` speeds, `a?` randomizes, `bd(3,8)`
euclidean rhythms. Loved: the mini-notation itself, pattern transforms
(`.sometimes/.every`), zero-install shareable URLs, inline visualizations.
Strudel is AGPL-3.0 (now on Codeberg) — borrow ideas, not code.

**Sonic Pi** — Ruby live-coding IDE over SuperCollider (~11.9k★, MIT, very
active, huge education community). Loved: `live_loop` hot-swap (edit while
playing, changes land on the loop boundary), deterministic timing, and the
built-in narrative tutorial.

**Smaller kin** — **FoxDot/Renardo**: Python patterns with **scale degrees by
default**, the published analog of our degree tokens. **Melrose** (Go, MIT,
active): every phrase is a named, transformable value; live-editable loops;
recently grew an MCP server for AI-agent control. **textbeat**: vertical
tracker-style plaintext with degrees and a rich articulation shorthand
mapped to velocity/CC. **jFugue/Staccato** (dormant but influential):
`C5majQ` chord-quality strings and a rhythm layer (`"x.o.x.o."` → drum map),
plus full MIDI→text round-trip.

**Orca** — 2-D character-grid generative sequencer emitting MIDI/OSC; a
sequencer brain with no sound of its own. Its "route events to external
synths" philosophy matches our WebMIDI panel.

**Audio-language layer** (SuperCollider, ChucK, Faust, Glicol) — synthesis
substrates one layer below us; play.yaml sits at the note/score layer the way
Tidal sits above SuperDirt.

**YAML/JSON prior art** — thin, which is the point: **beats** (Ruby drum
machine) uses a YAML song file with kit + patterns + a flow of named sections
with repeat counts — the closest structural precedent for our `sections:`,
drums-only. Sorrygle, Midica (a text-language hub that *imports* ABC/
LilyPond/Alda), and lydown are niche. On the standards track: **MusicXML**
(verbose, not hand-writable) and its JSON successor **MNX** (draft, active
W3C group) — the formalized version of what we do informally.

| Project | Notation | Outputs | Platform | Niche | Activity |
|---|---|---|---|---|---|
| play.yaml | YAML + measure tokens, degrees, sections | .mid, browser samples/synth, WebMIDI, MP3 | browser studio + CLI | readable transcription & playback | this repo |
| Alda | letters+durations, markers | MIDI live + .mid | CLI/REPL | composition | 5.9k★ active |
| ABC/abcjs | letter tokens, case=octave | SVG score, browser synth, MIDI | browser lib + CLIs | tunes, engraving | active, MIT |
| LilyPond | `\relative` blocks, Scheme | PDF/SVG, crude MIDI | CLI | engraving | mature |
| MML | stateful `o4 l8 cdef`, `[..]n` | chip formats, MIDI | CLI | chiptune | niche |
| Tidal/Strudel | mini-notation + combinators | live audio, WebMIDI, OSC | browser REPL | live coding | very active |
| Sonic Pi | Ruby `live_loop`/`sleep` | live audio, MIDI/OSC | desktop IDE | live coding + education | very active |
| FoxDot→Renardo | degree patterns | live audio (SC) | CLI/editor | live coding | fork active |
| Melrose | named musical objects | live MIDI | CLI + VS Code | composition | active |
| jFugue | `C5majQ` strings, rhythm layers | MIDI files | Java lib | programmatic | dormant |
| Orca | 2-D operator grid | MIDI/OSC events | desktop/web | generative | maintenance |
| MusicXML/MNX | XML / JSON interchange | interchange | spec | standards | MNX drafting |

## Where play.yaml stands

**What we do that nobody else combines:** YAML as the *structural* layer
(tracks, props, inheritance, sections with `loop`/`wait`) around a compact
*token* layer — with theory awareness few of these have: scale-degree tokens
against named scales *and chord symbols* (`==Dm7==` chord-scales), dynamics/
articulation/technique vocabularies emitting CCs, physical-model support
(SWAM expression mapping), a sampled+synth browser engine, MIDI-file export
with tempo maps and GM percussion, offline MP3 rendering, and golden-digest
regression tests over a real repertoire. Alda has the language but no studio
or samples; Strudel has the studio but cycles instead of scores (no song
form, no .mid focus); ABC has the corpus and engraving but not multi-track
production; beats had YAML sections but only drums.

**What others do better:**
- *Engraving*: LilyPond/ABC render real notation; we render none.
- *Liveness*: Sonic Pi/Strudel/Melrose hot-swap code while playing; we stop
  and restart.
- *Pattern algebra*: Tidal's transforms (alternation, euclid, probability,
  `.every`) generate variation we must write out literally.
- *Input state*: MML/LilyPond sticky octave/duration beats our per-note
  octave digits for terseness.
- *Ecosystem*: ABC's tune corpus and Sonic Pi's tutorial/education loop are
  community engines, not features.

## What we can learn (prioritized)

1. **Hot-swap editing** (Sonic Pi's most-loved feature): recompile on edit
   and splice the new timeline at the next bar boundary instead of requiring
   Stop→Play. Our compile is already fast and pure; the transport work is the
   hard part. Highest studio-feel payoff on this list. *Shipped 2026-07-22
   (generation-based splicing in `packages/web/src/player.ts`).*
2. **Shareable URLs** (Strudel): encode the score (compressed) in the URL
   hash so any song links without a server. Near-free with our source-string
   model, and the best distribution move for an open-source launch. *Shipped
   2026-07-22 (`packages/web/src/share.ts` — clean-room over web-standard
   CompressionStream, no Strudel code).*
3. **Euclidean rhythms** (Tidal/Strudel `bd(3,8)`): one token suffix that
   drummers and live-coders both expect; expands in `placeToken` like our
   roll suffix does. *Shipped 2026-07-28 as the `spread:` play item — a YAML
   directive rather than an in-string call, per
   [syntax-differentiation.md](syntax-differentiation.md); see
   [generative-design.md](generative-design.md).*
4. **Per-pass alternation** (Strudel `<a b>`): a token or `Nx`-style item
   that plays alternatives on successive loop passes — composes naturally
   with our section loops (vary the vamp every cycle). *Shipped 2026-07-28
   as the `alternate:` play item (with `arp:`, `walk:`, `chance`, `seed` in
   the same release — [generative-design.md](generative-design.md)).*
5. **Humanize/quantize control** (Alda `quant`, per-note timing feel): a
   `humanize:` prop (timing/velocity jitter, swing amount) would soften the
   grid — our drum groove currently plays machine-exact. *Shipped 2026-07-28
   (`humanize:` prop/clause, seeded and compile-time; swing stays notated as
   triplet groups).*
6. **Score preview** (abcjs): render the compiled timeline as simple SVG
   notation (or export ABC/LilyPond for engraving) with abcjs's
   score-following cursor idea. We already have token highlighting; engraved
   preview is the complement, and ABC export is a low-cost first step.
7. **Sticky octave inference** (LilyPond `\relative`, MML): an opt-in mode
   where an unmarked letter lands nearest the previous note would drop most
   octave digits from melodies. Needs care with our existing default-octave
   semantics — opt-in per track.
8. **Markers** (Alda `%name`/`@name`): named sync points inside sections for
   "everyone re-align here" moments — our `wait` covers entry, not mid-part
   re-sync.
9. **Rhythm-string drum lines** (jFugue `"x.o."`): an even terser drum lane
   for boom-bap patterns; sugar over existing kit tokens.
10. **Interchange** (Midica as hub, MNX as target): a MusicXML importer
    would unlock the world's scores as input; watching MNX's JSON naming
    (sequences/events) costs nothing and future-proofs ours.
11. **In-app tutorial** (Sonic Pi): our README is thorough but a guided
    in-studio walkthrough (edit-this-bar exercises) is what made Sonic Pi an
    education staple.
12. **License hygiene**: Strudel is AGPL — study its mini-notation and
    visualizations freely, port ideas, never code. Alda (EPL), abcjs/Sonic
    Pi/Melrose (MIT/Apache) are safe references.

Sources: [Alda](https://github.com/alda-lang/alda) ·
[abcjs](https://github.com/paulrosen/abcjs) ·
[LilyPond](https://lilypond.org/news.html) ·
[MML overview](https://woolyss.com/chipmusic-mml.php) ·
[Strudel (Codeberg)](https://codeberg.org/uzu/strudel) ·
[TidalCycles](https://github.com/tidalcycles/Tidal) ·
[Sonic Pi](https://github.com/sonic-pi-net/sonic-pi) ·
[FoxDot](https://github.com/Qirky/FoxDot) ·
[Melrose](https://github.com/emicklei/melrose) ·
[textbeat](https://github.com/flipcoder/textbeat) ·
[jFugue](http://www.jfugue.org/) ·
[Orca](https://github.com/hundredrabbits/Orca) ·
[Glicol](https://github.com/chaosprint/glicol) ·
[Midica](https://github.com/truj/midica) ·
[MNX spec](https://w3c.github.io/mnx/docs/) ·
[MNX WG](https://www.w3.org/community/music-notation/)
