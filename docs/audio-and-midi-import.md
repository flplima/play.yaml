# Importing music: audio → MIDI → play.yaml

Two problems that people file under one name, and they stay two tools here:

| | input | output | nature | what it delivers |
|---|---|---|---|---|
| **A. MIDI import** | `.mid` (already symbolic) | `.play.yaml` | deterministic, verifiable | **exact**, and it proves it |
| **B. Audio import** | a recording | note events → `.mid` | statistical, needs calibration | a *draft* to feed A |
| **C. Scan reading** | a page image | measured pitches + onsets | assisted, partial | a *skeleton* to check by eye |

B's output is just another `.mid`, so it feeds A. Do A first and A alone if
you have a MIDI file — `docs/song-workflow.md` §1 already says a parsed MIDI is
the best source for a transcription. C is the last resort, for works that exist
only on paper.

---

## A. MIDI → play.yaml — `play-yaml-import`

```bash
node packages/cli/dist/import-midi.js song.mid -o songs/x/x.play.yaml --verify
# verify: source 851 notes | score 851 | missing 0 extra 0 | moved 0 (max 0.0000 beat) | EXACT ✓
```

### The claim, and how it is checked

**Every note's onset beat and pitch survives.** Not durations, not
articulation — a written score quantizes, and the tool reports what that cost
instead of hiding it.

`--verify` compiles the score it just wrote and diffs it against the source
file. The two failure modes are counted apart on purpose:

- **missing / extra** — notes lost or invented. Always a bug. Exit code 1.
- **moved** — notes that landed on a different beat, with the largest move in
  beats. That is what `--snap` was *asked* to do, so the verdict is
  `COMPLETE (quantized) ✓` and the exit code stays 0.

Matching walks the source and score note lists per pitch and pairs each note
with its nearest counterpart, stepping past whichever side is surplus. Pairing
by index would work only while the counts match; once one note is dropped
every later pair is off by one and the reported shift becomes nonsense instead
of a diagnosis.

Measured on our own repertoire (export each example to `.mid`, import it back):

```
twinkle            source   14 notes | missing 0 extra 0 | moved 0 | EXACT ✓
bwv846             source  549 notes | missing 0 extra 0 | moved 0 | EXACT ✓
fur-elise          source  901 notes | missing 0 extra 0 | moved 0 | EXACT ✓
take-5             source  851 notes | missing 0 extra 0 | moved 0 | EXACT ✓   (with drums)
nocturne-op9-no2   source 1231 notes | missing 0 extra 0 | moved 0 | EXACT ✓   (12/8, tempo map)
```

`packages/core/test.ts` runs that round trip over those five scores, so it
cannot rot.

For recorded playing, `--snap 48 --legato`. On a 901-note file jittered by
±0.03 beat, `--snap 8` moved 881 notes by at most 0.06 beat and lost none;
`--snap 4` was coarse enough that three same-pitch notes collapsed onto one
grid point, and the tool said so rather than shrugging.

### What it does

- **Meter, key, tempo, track names, program changes** all come out of the file.
  `decodeMidi` used to read only tempo; it now reads time signature (`0x58`),
  key signature (`0x59`), track name (`0x03`) and program change, and tags each
  note with the MTrk it came from.
- **Voice separation** (`separateVoices`). A play.yaml track sounds a chord but
  not two independent rhythms, so a channel holding a bass under running
  sixteenths becomes two tracks — which is also what lets the bass keep
  ringing instead of being cut by the next sixteenth. Notes sharing an onset
  *and* a length stay together as a chord; each chord then joins the free
  voice whose last pitch is nearest, opening a new one when none is free. When
  every voice is busy the one that frees up soonest yields and its ringing
  note is shortened, because a written score has to choose.
- **Drums**: GM channel 10 becomes a `kit: acoustic` track written in drum
  tokens. Verified by count, not pitch — our kits deliberately fold several GM
  numbers onto one token.
- **Instrument casting** from the GM program, by family, so a Rhodes lands on
  `keys` rather than everything defaulting to `piano`.

### The emitter

`packages/core/src/notate.ts`, ported from `scripts/musicxml-to-play.py` so the
path needs no Python. A measure is `slots` equal top-level tokens (six for
6/8); each slot is laid out on the finest grid *its own* notes need — the gcd
of the onsets and offsets inside it — which is what keeps a bar of quarters
written as `c d e f` instead of dragging the whole bar down to the resolution
of one 32nd somewhere in it.

Three things it learned from real files:

- **Resolution has to divide the source's.** The internal grid is 2520 ticks
  per quarter (LCM 1–10, so triplets/quintuplets/septuplets are exact), but
  2520/480 is 5.25 — a plain 480-tick MIDI file's odd ticks land *between*
  grid points. The nocturne came back with four notes 0.0002 beat off until
  importers started passing `ticks: lcm(2520, tpqn)`.
- **Releases must not set the grid.** A note released after 0.257 beats drags
  its beat onto a ~1000-step grid, and an unquantized import came out as
  screenfuls of `~ ~ ~ _ _ _`. Past `maxSteps` (16) a slot is written from its
  onsets alone. Onsets and pitches are unaffected — only where notes *stop*.
- **`--legato`** goes further and runs every note into the next, for recorded
  MIDI where literal durations fill the bar with 32nd rests. Genuine short
  rests become holds; that is the trade, stated out loud.

### Known limits

- Mid-piece meter changes are read but not honoured: the whole file is laid
  out in the first time signature, and the tool says so on stderr. The emitter
  would need to run per-span and interleave `"N/D"` directive lines.
- No sections, no `wait:`, no repeats — an import is one long `piece:`. Form is
  a human judgement; `docs/song-workflow.md` is how it gets made.
- Velocity and CC are dropped.

---

## B. Audio → MIDI — `scripts/audio-to-midi.mjs`

```bash
npm i -D @spotify/basic-pitch                     # ~500 MB, hence not a repo dep
node scripts/audio-to-midi.mjs take.wav -o take.mid --bpm 120
node scripts/audio-to-midi.mjs --render examples/twinkle.play.yaml --score --sweep
```

Runs `@spotify/basic-pitch` — an npm package, model bundled, deps are tfjs and
`@tonejs/midi` only. `evaluateModel()` takes a plain `Float32Array` at 22050 Hz
mono, so `ffmpeg` is the whole front end: no Python, no `AudioBuffer`, no
native build. (Loading the bundled model needs an HTTP-capable IO handler, so
the script serves the package's own model directory off a throwaway localhost
port.) About 2× realtime on the pure-JS CPU backend.

### Measuring it, without a single copyrighted file

A compiled `.play.yaml` is exact ground truth and `@play.yaml/node-audio`
renders one to audio, so the whole loop closes in-tree:

```
score → render → transcribe → compare against the score's own notes
```

That is what `--render <score> --score` does. Results at ±120 ms tolerance:

| source | config | P | R | F1 |
|---|---|---|---|---|
| twinkle (mono piano, 80 bpm) | library defaults | 66.7% | 100% | 80.0 |
| twinkle | **this script's defaults** | 100% | 100% | **100** |
| BWV 846 (dense arpeggiated piano) | library defaults | 41.0% | 99.3% | 58.0 |
| BWV 846 | onset 0.85 + partial filter | 100% | 99.3% | **99.7** |
| Take Five sax line alone (174 bpm) | defaults, −56 ms latency | 100% | 77.5% | **87.3** |

Three post-processing steps matter more than the choice of model, and all
three ship in the script:

1. **Thresholds.** Basic Pitch's defaults are tuned for pop stems; on solo
   piano, onset 0.5 → 0.85 took F1 from 58 to 99.7. The script defaults to
   0.7 and `--sweep` fits the rest — decoding is cheap post-processing over
   one cached CNN pass, so a whole grid costs one transcription.
2. **Harmonic partials.** The characteristic error is a phantom note at
   +12/+19/+24 semitones above a simultaneous louder one (a C4 makes the model
   hear C5 and G5). Dropping those was worth ~13 F1 points on BWV 846 and ~17
   on twinkle. On by default; `--keep-partials` turns it off.
3. **Latency.** Onsets come out systematically late — +56 ms on the sax line.
   `--latency auto` fits the median offset to the beat grid and subtracts it;
   on that line it turned three near-misses into matches and took precision to
   100%.

What remains are true misses in fast runs: a chromatic 16th run at 174 bpm has
notes ~110 ms apart and the model merges them. That is its frame rate, not a
tuning problem.

**Keep this attached to the numbers:** they are our own dry synth renders —
one instrument, no room, no reverb. They are an optimistic ceiling and the
tuned thresholds are fitted to them. Real recordings are worse. The harness is
still the right thing to have: it makes regressions visible and gives a place
to plug a real annotated clip in.

### The whole chain

```bash
node scripts/audio-to-midi.mjs --render examples/twinkle.play.yaml -o t.mid
node packages/cli/dist/import-midi.js t.mid --snap 8 --legato --bpm 80 -o t.play.yaml --verify
```

comes back as the score it started from:

```yaml
- "c4 c4 g4 g4"
- "a4 a4 g4 _"        # the original wrote ~ here; --legato holds instead
- "f4 f4 e4 e4"
- "d4 d4 c4 ~"
```

### Mixes need separation first, and this machine can't do it

Basic Pitch works on one instrument at a time. For a full mix the pipeline is
the one everyone converges on:

```
audio → stem separation → per-stem transcription → beat/tempo grid → quantize → MIDI
          (HTDemucs)        (this script)          (beat_this)       (--snap)
```

Instrument *detection* is mostly a by-product: the stem's name is the
instrument.

**HTDemucs** (`facebookresearch/demucs`, MIT) is the open default;
`htdemucs_ft` is the fine-tuned variant and `htdemucs_6s` adds guitar and
piano stems at lower accuracy on those two. The 2025–26 SDX leaderboards are
led by the **BS-Roformer / Mel-Roformer** family, distributed as community
checkpoints rather than a packaged library. ONNX exports of HTDemucs exist,
which would let it run through `onnxruntime-node` with no Python at all —
worth a look, unverified.

None of it runs comfortably here: 4 cores, no CUDA, and at the time of writing
1.8 GB RAM free with swap exhausted. Use Docker with `--segment` lowered, a
different machine, or a hosted service for that stage.

Also unavailable locally: **only `python3.14` is installed**, with no
`uv`/`pipx`/`conda`. That excludes `basic-pitch` (Python — needs
`tensorflow<2.15.1`, ≤py3.11), `demucs` (PyTorch has no 3.14 wheels) and
`music21`. Any Python route means Docker or a second interpreter — which is
the other reason both tools here are TypeScript.

For the record, the rest of the field: **transkun** and **ByteDance
piano_transcription** (piano-only, better than Basic Pitch on piano, with
pedal), **MT3** / **YourMT3+** (multi-instrument, transcribe *and* label,
research-grade, not trained on singing), **NeuralNote** (desktop plugin
wrapping Basic Pitch), **beat_this** / **madmom** / **BeatNet** for the beat
grid. All Python, all happier with a GPU.

### Where LLMs help

Not at note detection — they are worse than a 4 MB CNN at it. They help
*after*: naming sections and form, casting instruments, spelling enharmonics
from the inferred key, turning a note dump into an idiomatic score with
`sections:`/`wait:`/`Nx:`. Treat a transcription like a downloaded `.mid`: a
research input, per `docs/song-workflow.md`.

---

## C. When the only source is a scan — `scripts/score-scan.py`

Some works have no MusicXML and no MIDI anywhere free. Mozart's Requiem and
Debussy's *Estampes* were both dead ends — Mutopia has neither, CPDL and
MuseScore are behind bot checks, and IMSLP has no engraving files for either.
What they do have is scans, and a scan means reading notes off the page by eye,
which is exactly how the wrong scores in this repo got written in the first
place. (Both were eventually **deleted** rather than guessed at: see the note
at the end of this section.)

OMR would solve it, but neither engine works here: `oemer`'s ONNX models fail
against the only onnxruntime that builds for Python 3.14, and Audiveris needs a
JVM that is not installed.

So this script does the two things the eye is worst at, by measurement:

- **which line is a note on** — it finds the five staff lines and converts a
  notehead's y-centre into a staff step and a pitch for the clef given.
- **where in the bar does it fall** — engraving spaces notes roughly in
  proportion to duration, so a notehead's x within a bar gives its onset. Bar
  lines come from consensus across a system: a real one is drawn on every
  staff, a note stem is not.

The second is the useful part, because it is **self-checking**. On the
Lacrimosa's opening the first violin measured onto slots 1,2 / 4,5 / 7,8 /
10,11 of a 12/8 bar — an eighth rest and two eighths, four times over — and the
second violin and viola onto 0,3,6,9, a quarter and an eighth rest. Onsets
landing on exact subdivisions is what tells you the reading is right; a wrong
reading scatters.

```
score-scan.py lines page.png                       # what staves are here
score-scan.py grid  page.png --staff 870:934 --clef treble --out s.png
score-scan.py read  page.png --slots 12 --staff 870:934:treble:VlnI ...
```

`grid` supplies what measurement cannot: it overlays a labelled pitch guide at
every line and space, so accidentals and note values can be read by eye without
miscounting lines.

**What it does not do**, and this bounded the Lacrimosa attempt: accidentals,
note values, ties versus slurs, or two voices sharing a staff. The vocal parts
from bar 3 of that page measure cleanly for pitch, but a dotted quarter and a
dotted eighth look alike to it, and at that scan quality the durations read by
eye did not add up to a full bar. The tool gets you a measured skeleton; it
does not get you a transcription.

### What happened to those two songs

`songs/mozart-requiem-lacrimosa/` and `songs/debussy-estampes-pagodes/` are
**gone**. Both were inventions — 5 bars of a 30-bar movement and 8 bars of a
98-bar one, neither containing the composer's notes — and neither could be
rebuilt from a source that could be checked. Deleting them was the honest
option: a repo where every other score is verified note-exact against a named
edition should not carry two that quietly are not.

They are worth redoing the moment a symbolic source turns up. A MuseScore
account, a library copy of a Bärenreiter or Henle file, or any `.mxl`/`.mid`
makes each of them twenty minutes of verified work through route A. The
research that *was* established — the Lacrimosa is 12/8 in D minor and Mozart's
autograph breaks off after bar 8; Pagodes is 4/4 in B major, marked *Modérément
animé*, 98 bars — is recorded here so it does not have to be found again.

---

## Fixed on the way: renders at 10³⁶

Any score with hi-hats — or with an expression/CC swell — came out of
`renderSongToPcm()` about 10³⁶ times too loud. `take-5` peaked at 2.27e37 with
86.6% of samples above 1.0; `sur-le-fil` at 3.4e38 with 14 non-finite samples.

The cause was a bare `setTargetAtTime`. Without an automation event at the
curve's start, node-web-audio-api extrapolates it **backwards** instead of
holding the previous value — and exp(+t/0.008) over half a second is 1e27.
Browsers hold instead, which is why it only ever showed up in offline renders.
Both sites (the hi-hat choke in `sampler.ts`, the CC glides in `bus.ts`) now go
through `glideParam`, which pins the current value at the start of the move.
That is correct on every implementation and costs one event.

All 22 examples now render below or near full scale. Two still sum past 1.0 —
`clair-de-lune` (1.12) and `sur-le-fil-cello-vst` (2.40) — but that is ordinary
mix headroom, not the pathology, and it is a musical decision rather than a
bug.
