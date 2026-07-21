# Percussion in play.yaml — design notes

How drums and percussion fit the DSL, the sound engines, and the `.mid`
export. Implemented as of 2026-07; this document records the design and its
reasoning for contributors.

## Principles

1. **No new grammar.** The measure grammar (equal division, `{}` groups, `[]`
   stacks, `>`/`<`, `_`, `~`, dynamics words, numbered measures, anchors) is
   already a drum machine. Percussion is a *token namespace switch*, nothing
   more: a track with `kit:` reads drum names where other tracks read pitches.
2. **General MIDI is the contract.** Every drum token maps to a GM percussion
   key and kit tracks compile onto channel 10 with no program change. That
   makes `.mid` export, DAWs, hardware synths and the CLI's `--midi` mode work
   with zero configuration, and gives scores a stable meaning outside this
   project. Raw numbers (`36`) are always accepted for unmapped keys.
3. **Sampled when possible, synthesized always.** The browser plays a CC0
   sampled library (VSCO 2 CE + VCSL) for the `acoustic` and `percussion`
   kits; the `808` kit — and any GM key with no recording, and every kit when
   samples fail to load — renders through `playDrum()` in `core/synth.ts`,
   which synthesizes all standard GM percussion keys 808-style. Playback never
   silently drops a hit.

## The `kit:` prop

```yaml
kit: acoustic      # or: percussion, 808 — any name; inherits like any prop
```

- Switches token interpretation to drum names for that track and its children.
- Kit tracks default to **channel 10**; an explicit `channel:` wins. All kit
  tracks share 10 — that is the channel's job in GM. Melodic auto-assignment
  skips 10 so big scores never leak notes onto the drum channel.
- `program` is omitted (GM percussion needs none).
- `scale`, `octave`, degree tokens and the `_`-octave prefix are inert.
- The kit name picks the *sound set*, not the token table — the table is
  global, so `conga` works in an `acoustic` track too. `acoustic` and
  `percussion` both use the sampled drum library; `808` is pure synthesis.
  (`kit: 808` arrives from YAML as a number and is normalized to a string.)

## Token table

Canonical names, their aliases, and the GM key they emit. TimelineEvents from
kit tracks carry the canonical name in `pitch` (e.g. `"bd"`) and the GM key in
`midi`.

| token | aliases | GM | | token | aliases | GM |
|---|---|---|---|---|---|---|
| `bd` | kick, bassdrum | 36 | | `cb` | cowbell | 56 |
| `sd` | sn, snare | 38 | | `tamb` | tambourine | 54 |
| `rim` | rs, sidestick | 37 | | `vibraslap` | | 58 |
| `cp` | clap | 39 | | `bongo` / `lbongo` | | 60 / 61 |
| `hh` | ch, hat, closedhat | 42 | | `quinto` | | 62 |
| `ph` | pedalhat | 44 | | `conga` | | 63 |
| `oh` | openhat | 46 | | `tumba` | | 64 |
| `ft` / `lt` | floortom / lowtom | 41 / 45 | | `timbale` / `ltimbale` | | 65 / 66 |
| `mt` / `ht` | midtom, tom / hightom | 47 / 50 | | `agogo` / `lagogo` | | 67 / 68 |
| `cy` | crash | 49 | | `cabasa` | | 69 |
| `crash2` | | 57 | | `maracas` | | 70 |
| `splash` | | 55 | | `shaker` | | 82 |
| `china` | | 52 | | `guiro` / `sguiro` | | 74 / 73 |
| `rd` | ride | 51 | | `clave` | claves | 75 |
| `rb` | ridebell | 53 | | `wb` / `lwb` | woodblock | 76 / 77 |
| `whistle` / `swhistle` | | 72 / 71 | | `cuica` / `mcuica` | | 79 / 78 |
| `sleigh` | | 83 | | `tri` / `mtri` | triangle | 81 / 80 |
| `belltree` | | 84 | | | | |

Notes: `quinto`→62 repurposes GM's "mute hi conga" as the highest conga drum
(GM has two conga slots for three drums; the sampler plays a real quinto
recording, GM synths approximate). `shaker` 82 / `sleigh` 83 / `belltree` 84
are GM2 keys — old GM1 synths approximate or ignore them.

## Suffixes on drum tokens

- `>` / `<` — accent / ghost, stackable (existing semantics).
- `~` — **roll**: `sd~` retriggers at 32nd-note pace filling its slot, with a
  0.6→1.0 velocity swell into the landing; `~~` doubles to 64ths. Rolls are
  *expanded in the compiler* into real retriggered notes, so they survive into
  `.mid` files and sound on any GM synth — the standard mockup technique for
  snare rolls and suspended-cymbal swells (`cy~ _ _ _`).
- `[sd sd]~` — the chord-strum spread doubles as a **flam** (the second stroke
  lands one `strum` late).
- `_` — let ring: extends the previous hit's duration (crash/cymbal tails).
- A rest `~` still cuts nothing short — drums are one-shots; `_` after them is
  the only duration control that matters.

## Choke groups

`DRUMS` entries may carry `choke: 'hh'`: the open hi-hat dies when a closed or
pedal hat starts. The compiler does nothing with this — it is playback
behavior. The web sampler keeps per-bus voice sets by group and fades the
previous voices out in ~10 ms at the new hit's start time. `drumChoke(note)`
in core exposes the mapping to any backend.

## Sound engines

- **`core/synth.ts` → `playDrum(ctx, dest, gmKey, velocity, time)`** — 808ish
  recipes per GM key (pitch-drop sine kick, bandpassed-noise snare, filtered
  noise hats with open/closed envelope lengths, two-detuned-squares cowbell,
  tuned sine toms/congas, noise-burst clap…). Runs anywhere Web Audio does,
  including the CLI through webaudio-node.
- **Web sampled library** — `packages/web/public/samples/drums/`, built by
  `scripts/fetch-drums.mjs` from VSCO 2 CE + VCSL (CC0): 114 hits covering 32
  GM keys, velocity-layered with round-robins (manifest format below). Keys
  without recordings fall through to `playDrum` *per note*, so one score can
  mix sampled congas with a synthesized cuica.

Drum manifest format:

```json
{ "kit": true,
  "notes": { "36": [ { "vel": 45, "url": "bd_pp_rr1.m4a" },
                     { "vel": 127, "url": "bd_ff_rr1.m4a" } ] } }
```

`vel` is the top of the velocity layer; equal `vel` entries are round-robins
picked at random. Playback shades gain inside the chosen layer so repeated
hits still breathe.

## Deliberate non-features (for now)

- **Kit-specific token tables** — one global table keeps scores portable; a
  kit that wants a different *sound* for the same key is a sound-set concern.
- **Techniques vocabulary** (`brushes`, `snares off`, `rimshot` as words) —
  VCSL has the recordings; would slot into `CONTROL_TERMS`-style tables later.
- **Non-GM instruments as first-class tokens** (cajon, darbuka) — playable
  today via raw key numbers mapped in a custom sound set; naming them means
  choosing key assignments outside GM, which wants more thought.
- **Per-lane sugar** — drummers already get one-lane-per-limb via child
  tracks and inheritance; no dedicated syntax needed.
