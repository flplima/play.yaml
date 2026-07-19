# play.yaml

A project dedicated to the `play.yaml` format — a human-readable, developer-friendly YAML schema and compact text notation DSL for describing music scores, which compiles into Standard MIDI Files or streamable MIDI events.

## Monorepo Layout

This is a monorepo managed with npm workspaces:

- `packages/core/`: The core `play.yaml` interpreter. It parses the DSL tracks, handles scales/chords/dynamics/subdivisions, and converts YAML documents to Standard MIDI Files (`.mid`) or flat timeline matrices of MIDI events.
- `packages/cli/`: Command-line player that compiles and synthesizes `play.yaml` songs directly to your system speakers via the Web Audio API using `webaudio-node`.

## Getting Started

### Prerequisites

- Node.js (>= 16.0.0)
- npm (>= 7.0.0 for workspaces support)

### Installation

Install dependencies (if any) and set up workspaces:

```bash
npm install
```

### Running Tests

Run the test suite across all workspace packages:

```bash
npm test
```

Or run tests directly in the core package:

```bash
npm test -w @play.yaml/core
```

### CLI Usage

Build the packages first:

```bash
npm run build
```

#### Compile `play.yaml` to MIDI
You can compile `.play.yaml` scores into Standard MIDI Files:

```bash
node packages/core/dist/cli.js --input packages/core/examples/my-score.play.yaml --output track.mid
```

#### Play `play.yaml` through speakers
You can play a score in real-time through your speakers using the Web Audio synthesizer:

```bash
node packages/cli/dist/cli.js packages/core/examples/my-score.play.yaml
```

Or run the preconfigured sample song play command:

```bash
npm run play -w @play.yaml/cli
```

## The DSL Notation

Scores are structured as YAML files defining one or more tracks. Inside each track, music is written as an array of strings, where each string represents **one measure**.

In a standard 4/4 measure (the default), there must be exactly 4 whitespace-separated tokens (one per beat).

### Beats & Subdivisions

- `5` — a single note filling the beat
- `~` — a rest (silent beat)
- `[1,3,5]` — a chord (all notes sound together at the start of the beat)
- `{1,2,3,4}` — a subdivision (tuplets / 16th notes / etc. splitting the beat equally)

### Suffixes (Articulation & Accents)

- `.` — staccato (note duration is cut to 30%)
- `-` — legato (note duration is held to 95%)
- `!` — micro-accent (+20 velocity spike)
- `>` or `^` — octave up
- `<` — octave down

### Example Score (`score.play.yaml`)

```yaml
meta:
  title: Quick Example
  bpm: 120
options:
  beatsPerMeasure: 4
tracks:
  - name: Melody
    channel: 1
    config:
      root: C
      scale: major
      octave: 4
    measures:
      - "f :: 1 1 5 5"          # Forte quarter notes (C4, C4, G4, G4)
      - "     6 6 5- ~"         # Inherits forte, legato A4, legato A4, G4 (legato), rest
      - "p :: {4,4,3,3}. [1,3,5]" # Piano staccato 16ths, followed by C-E-G chord
```

## Example Songs

You can find several complete multi-track songs in the [examples/](file:///Users/felipe/projects/oss/play.yaml/examples/) directory:

- [lost-woods.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/lost-woods.play.yaml): The magical "Lost Woods" theme (Saria's Song) from Ocarina of Time, configured as an infinite loop.
- [take-5.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/take-5.play.yaml): Dave Brubeck's famous jazz standard "Take Five", written in a 5/4 time signature.
- [corridors-of-time.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/corridors-of-time.play.yaml): Chrono Trigger's iconic "Corridors of Time" (Zeal Theme).
- [preciso-me-encontrar.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/preciso-me-encontrar.play.yaml): Cartola's classic Brazilian samba masterpiece.
- [bwv1007.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/bwv1007.play.yaml): J.S. Bach's Cello Suite No. 1 in G major (Prelude).
- [bwv881.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/bwv881.play.yaml): J.S. Bach's Prelude No. 12 in F minor from The Well-Tempered Clavier.
- [severance.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/severance.play.yaml): The haunting intro theme song of the TV show *Severance*.
- [experiments-cello.play.yaml](file:///Users/felipe/projects/oss/play.yaml/examples/experiments-cello.play.yaml): A short cello-soundscape composition testing dynamic variations.

To play any of these songs through your speakers:

```bash
node packages/cli/dist/cli.js examples/take-5.play.yaml
```
