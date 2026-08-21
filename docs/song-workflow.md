# Song workflow — from a song name to a play.yaml project

A guide for AI agents (and humans) working in this repo. When the user says
*"make Take Five"* / *"transcribe Song X into play.yaml"*, this is the
workflow. It was distilled from building `examples/take-5.play.yaml`; follow
it and you inherit the lessons instead of relearning them.

## 0. The deliverable

A **song project directory**:

```
songs/<slug>/
  <slug>.play.yaml        # the score — the one deliverable that must be perfect
  README.md               # what this is, which recording it follows, status
  research/
    report.md             # the research findings, data-dense, with citations
    sources.md            # annotated link list: every page/file consulted
    <page>.md             # relevant web pages distilled to markdown (own words)
    melody.md, form.md,…  # per-topic extraction tables when report.md gets big
```

`<slug>` is kebab-case (`take-five`, `blue-in-green`). Both the web studio's
example picker and the core golden test pick up `songs/*/*.play.yaml`
automatically — no registration step.

**Copyright rule (this is an open-source repo):** commit only *your own*
words and *your own* transcription. Downloaded MIDI/MusicXML files, PDF
scans, and copied lyrics/article text are third-party works — use them in the
session scratchpad, extract the *facts* (notes, chords, form, tempo) into
`research/*.md` with citations, and commit the facts, not the files. A
`.mid`/`.musicxml` may be committed only when its license is verified free
(CC0/PD) — record the license next to it. Never commit lyrics.

## 1. Research first — never transcribe from memory

Spawn a research agent (WebSearch/WebFetch) before writing a single bar.
What it must bring back, all in **concert pitch** with octaves in scientific
notation (C4 = middle C = MIDI 60):

- **Key, meter, tempo** of the *specific recording* you're following (say
  which one), cross-checked in ≥2 sources. Watch for transposing instruments:
  alto sax parts are written a major 6th above sounding pitch.
- **Form** of that recording: intro bars, section order, who solos over what,
  the ending. Decide with the user (or by taste) whether the file ends or
  loops forever.
- **Melody note-by-note per bar** (pitch + beat position + duration), for
  every distinct section. A parsed MIDI file is the best source — bitmidi /
  midishow files can be downloaded to the scratchpad and read
  programmatically; cross-check against lead-sheet sites (jazzleadsheet,
  freejazzlessons, songsterr…). Simplified lead sheets lie: the record often
  varies repeated bars (Take Five's bars 6–7 swap two turns).
  `play-yaml-import <file>.mid --verify` turns such a file straight into bar
  lines and proves no note moved — a starting point to *edit* into a score,
  not a substitute for deciding the form. See
  [docs/audio-and-midi-import.md](audio-and-midi-import.md); the copyright
  rule above still applies to the `.mid` itself.
- **Harmony**: chords per bar with voicings/comping rhythm if findable.
- **Bass line** figures; **drum groove** as a per-beat grid (which limb,
  which subdivision, swung or straight), from drum-lesson sites.
- Save the agent's report as `research/report.md` verbatim, plus
  `research/sources.md` listing every URL with one line on what it provided
  and how much you trust it. Distill any load-bearing web page into its own
  `research/<page>.md` in your own words — pages die, your extraction stays.

## 2. Write the score

Read `README.md` (DSL reference) and study `examples/take-5.play.yaml` — it
is the canonical arrangement style. Conventions that matter:

- **Structure with `sections:`** — form in declaration order, instruments
  declared prop-only under top-level `tracks:`, staggered entries via `wait:`
  (never bar arithmetic), the forever-loop as the `loop: true` tail (or
  `loop: false` everywhere + an ending, if the song should finish).
- **Repeats**: `- 8x: "…"` for consecutive runs. Write repeated bars out
  literally when they recur across sections — the DSL stays readable without
  YAML anchors. Don't use `&`/`*` anchors in song files.
- **Swing** eighths are triplet groups with a hold: `{bb3 _ eb4}`; a
  quarter+eighth triplet is `{c4 _ d4}`, a full triplet `{a4 b4 c5}`, turns
  and 16ths are 4-element groups.
- **Instrument casting** onto builtin samples: piano→`piano`, upright
  bass→`bass` (pizz by default), sax/clarinet/recorder→`flute`,
  strings→`violin`/`cello`, drums→`kit: acoustic` (GM drum tokens; see
  `docs/percussion-design.md`), latin percussion→`kit: percussion`,
  electro→`kit: 808`, synths→`lead`/`pad`/`keys`.
- **Dynamics & articulation**: track-level `dynamic:`/`articulation:`, `>`
  accents, `<` ghosts (drum ghost notes are `sd<<`), hairpins and tempo words
  as bare directive strings.
- Comment the file head with key, form, and source citations; comment
  non-obvious bars (what the figure is, why an octave was chosen).

## 3. Validate — compile, measure, listen

The score is not done when it parses. Work through all three layers:

1. **Compile numbers** (no browser needed):
   `npx tsx packages/cli/src/export.ts -i songs/<slug>/<slug>.play.yaml --json`
   — check bars are a whole number, per-track note counts are plausible,
   first/last beat of every track matches the form (entries where `wait` puts
   them), pitch ranges sit inside each instrument's range, `loopStartBeats`
   lands where the cycle should start.
2. **Golden pin**: `UPDATE_GOLDEN=1 npm test -w @play.yaml/core` registers
   the song's digest; diff `examples.golden.json` to confirm only your new
   key changed. From then on any accidental semantic change fails CI.
3. **Listen**. In the studio (`npm run dev`), select the song and:
   - Press **Play with a real click** — synthetic `.click()` via eval is not
     a user gesture and the audio context won't start.
   - Or press **⬇ MP3** and inspect the rendered file (keep the tab
     foregrounded — background tabs throttle offline rendering). The MP3 is
     the ground truth for "does it sound right": check per-section levels,
     that every instrument is audible, and spot-check famous moments (the
     first melody notes, the groove feel) against the recording.
   - Headless agents: per-track solo renders + RMS/band analysis catch
     "instrument silent/buried" bugs; onset analysis against the expected
     grid catches timing bugs. See the project memory for the analyser-tap
     technique.

## 4. Finish the project directory

- `songs/<slug>/README.md`: one paragraph — what recording it follows, the
  form as declared, instrument casting, known deviations/simplifications, and
  a changelog line per revision.
- Make sure `research/` reflects what you actually used (delete dead ends or
  mark them as such in `sources.md`).
- Commit the directory in one commit whose message summarizes the
  transcription decisions (key, form, sources, deviations).

## Checklist

- [ ] `research/report.md` + `sources.md` committed; concert pitch verified; no copyrighted files committed
- [ ] Score uses `sections:` (+ `wait:`, `Nx:`), no YAML anchors, cited header comment
- [ ] `--json` compile: whole bars, sane ranges, entries and `loopStartBeats` where the form says
- [ ] Golden updated; only the new key changed
- [ ] Heard it: real-click Play and/or rendered MP3 checked against the recording
- [ ] `songs/<slug>/README.md` written
