/**
 * play-yaml-import — a Standard MIDI File → a play.yaml score, verifiably.
 *
 *   play-yaml-import song.mid -o songs/x/x.play.yaml --snap 48 --verify
 *
 * The claim this tool makes is narrow and checkable: **every note's onset beat
 * and pitch survives**. `--verify` compiles what it just wrote and diffs the
 * (beat, pitch) multiset against the source file, so an import either reports
 * "exact" or says precisely how many notes moved and by how much. Durations
 * and articulation are *not* claimed — a written score quantizes, and the
 * `maxShift` / `--legato` numbers say what that cost.
 *
 * What it does:
 *   - reads meter, key, tempo, track names and program changes from the file;
 *   - groups notes by MTrk and channel, keeping the file's own track names;
 *   - splits each group into monophonic-with-chords voices (`separateVoices`),
 *     because a play.yaml track cannot carry two independent rhythms;
 *   - writes GM channel 10 as a `kit:` track in drum tokens;
 *   - lays every voice out in measures with the shared emitter (`notate.ts`).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  NOTATE_TICKS, SAMPLE_PROGRAMS, compileDoc, decodeMidi, drumName, notateMeasures,
  parseYaml, separateVoices, MidiNote, NotateNote, ParsedMidi,
} from '@play.yaml/core';
import { parseFlags, run, usage } from './shared';

/**
 * The emitter's grid has to be a multiple of the file's own resolution, or a
 * note sitting on an odd tick of a 480-ticks-per-quarter file lands between
 * grid points and comes out a fraction of a tick early.
 */
function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  return (a / gcd(a, b)) * b;
}

/** What an import is asked to do. */
interface ImportOptions {
  title: string;
  bpm?: number;
  measure?: string;
  bars?: string;
  tracks?: string;
  flats?: boolean;
  snap: number;
  voices: number;
  legato: boolean;
}

const HELP = `Standard MIDI File → play.yaml score

Usage:
  play-yaml-import song.mid [-o song.play.yaml] [--snap 48] [--verify]

Flags:
  -o, --output <file>   write here (default: alongside the input, or stdout with -)
      --title <text>    score title (default: the file's name)
      --snap <k>        quantize onsets to 1/k of a quarter note (48 = 32nd
                        triplets). Omit for already-quantized MIDI: the result
                        is then exact. Recorded playing needs it.
      --voices <n>      most voices to split one channel into (default 4)
      --legato          run each note into the next instead of writing its
                        released length — for recorded MIDI, where literal
                        durations fill the bar with 32nd rests
      --bpm <n>         override the tempo read from the file
      --measure <n/d>   override the meter (a transcription rarely carries one),
                        and lay the whole file out in it even if it changes
      --bars <a-b>      import only measures a through b (1-based, inclusive) —
                        for pulling one movement out of a multi-section file
      --tracks <list>   keep only these MTrks: comma-separated names (matched
                        case-insensitively as substrings) or 1-based numbers.
                        Engravings often carry a piano reduction of the very
                        parts above it, which would import as doubles
      --flats           spell black keys as flats (a transcription rarely
      --sharps          carries a key signature; the default follows the file)
      --verify          compile the result and diff it against the source
      --json            print the verification report as JSON
  -h, --help            this help`;

const PROGRAM_SAMPLES: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const [sample, program] of Object.entries(SAMPLE_PROGRAMS)) {
    if (map[program] === undefined) map[program] = sample;
  }
  return map;
})();

/**
 * The GM family a program belongs to, when it is not one of ours exactly.
 * Families are the GM spec's own groups of eight; this keeps a Rhodes on
 * `epiano` rather than defaulting a whole orchestra to `piano`.
 */
function sampleForProgram(program: number | undefined): string {
  if (program == null) return 'piano';
  if (PROGRAM_SAMPLES[program]) return PROGRAM_SAMPLES[program];
  if (program <= 7) return 'piano';
  if (program <= 15) return 'keys';
  if (program <= 23) return 'keys';
  if (program <= 31) return 'lead';
  if (program <= 39) return 'bass';
  if (program === 42) return 'cello';
  if (program <= 47) return 'violin';
  if (program <= 55) return 'strings';
  if (program <= 79) return 'flute';
  if (program <= 87) return 'lead';
  if (program <= 95) return 'pad';
  return 'keys';
}

function slugify(name: string, fallback: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s && !/^\d/.test(s) ? s : fallback;
}

/** A stretch of the file in one meter: where it starts and how long a bar is. */
interface Span {
  startBeat: number;
  measures: number;
  numerator: number;
  denominator: number;
  measureBeats: number;
}

/**
 * Cut the file into one span per meter.
 *
 * A score in 4/4 that turns 3/4 at bar 7 cannot be written as one grid, and
 * laying the 3/4 out in 4/4 silently rebars everything after it. Each span is
 * emitted in its own meter with a bare "n/d" directive line between them,
 * which is how the DSL notates a meter change.
 */
function buildSpans(midi: ParsedMidi, lengthBeats: number): Span[] {
  const changes = midi.timeSignatures;
  const spans: Span[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const measureBeats = c.numerator * (4 / c.denominator);
    const endBeat = i + 1 < changes.length ? changes[i + 1].beat : lengthBeats;
    const measures = Math.max(0, Math.round((endBeat - c.beat) / measureBeats));
    if (measures > 0) {
      spans.push({ startBeat: c.beat, measures, numerator: c.numerator, denominator: c.denominator, measureBeats });
    }
  }
  return spans;
}

interface Group {
  key: string;
  name: string;
  drums: boolean;
  program?: number;
  notes: NotateNote[];
}

/** Does this MTrk pass a `--tracks` filter of names and/or 1-based numbers? */
function trackWanted(filter: string | undefined, index: number, name: string): boolean {
  if (!filter) return true;
  return filter.split(',').map((t) => t.trim()).filter(Boolean).some((term) => (
    /^\d+$/.test(term)
      ? parseInt(term, 10) === index + 1
      : name.toLowerCase().includes(term.toLowerCase())
  ));
}

/** Split the file's notes into (MTrk, channel) groups, named as the file names them. */
function groupNotes(midi: ParsedMidi, filter?: string): Group[] {
  const groups = new Map<string, Group>();
  for (const n of midi.notes as MidiNote[]) {
    if (!trackWanted(filter, n.track, midi.trackNames[n.track] ?? '')) continue;
    const key = `${n.track}:${n.channel}`;
    let g = groups.get(key);
    if (!g) {
      const program = midi.programs.find((p) => p.track === n.track && p.channel === n.channel)?.program;
      const named = midi.trackNames[n.track] || '';
      g = {
        key,
        name: named || (n.channel === 9 ? 'drums' : `ch${n.channel + 1}`),
        drums: n.channel === 9,
        program,
        notes: [],
      };
      groups.set(key, g);
    }
    g.notes.push({ start: n.startBeat, duration: n.durBeat, midi: n.pitch });
  }
  return [...groups.values()].filter((g) => g.notes.length);
}

interface BuiltTrack {
  key: string;
  drums: boolean;
  sample: string;
  lines: string[];
  maxShift: number;
  placed: { start: number; midi: number }[];
}

interface ImportResult {
  yaml: string;
  /** Beat window of the source that was imported (for --verify). */
  window: { fromBeat: number; toBeat: number };
  bpm: number;
  measure: string;
  tracks: BuiltTrack[];
  /** Largest onset move across every track, in quarter-note beats. */
  maxShift: number;
  noteCount: number;
}

function importMidi(bytes: Uint8Array, args: ImportOptions): ImportResult {
  const { title } = args;
  const midi = decodeMidi(bytes);
  const bpm = args.bpm || Math.round(midi.tempoMap[0].bpm * 100) / 100;
  const override = args.measure ? /^(\d+)\s*\/\s*(\d+)$/.exec(args.measure) : null;
  if (args.measure && !override) throw new Error(`--measure expects "n/d", got "${args.measure}"`);
  const meter = override
    ? { beat: 0, numerator: parseInt(override[1], 10), denominator: parseInt(override[2], 10) }
    : midi.timeSignatures[0];
  const preferFlat = args.flats ?? midi.keySignatures[0].sharps < 0;

  // Total length has to cover held notes, and the last bar even if it is
  // short, or the final span loses a measure.
  const lastBeat = midi.notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeat), 0);
  let spans = override
    ? [{
        startBeat: 0,
        measures: Math.max(1, Math.ceil(lastBeat / (meter.numerator * (4 / meter.denominator)))),
        numerator: meter.numerator,
        denominator: meter.denominator,
        measureBeats: meter.numerator * (4 / meter.denominator),
      }]
    : buildSpans(midi, lastBeat);

  // --bars a-b, counted in measures across the spans as the file bars them.
  if (args.bars) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(args.bars);
    if (!m) throw new Error(`--bars expects "a-b", got "${args.bars}"`);
    const from = parseInt(m[1], 10);
    const to = parseInt(m[2], 10);
    if (from < 1 || to < from) throw new Error(`--bars ${args.bars} is not a range`);
    const kept: Span[] = [];
    let bar = 1;
    for (const s of spans) {
      const first = Math.max(from, bar);
      const last = Math.min(to, bar + s.measures - 1);
      if (last >= first) {
        kept.push({
          ...s,
          startBeat: s.startBeat + (first - bar) * s.measureBeats,
          measures: last - first + 1,
        });
      }
      bar += s.measures;
    }
    if (!kept.length) throw new Error(`--bars ${args.bars} selects nothing (file has ${bar - 1} bars)`);
    spans = kept;
  }
  const origin = spans[0].startBeat;
  const meterOut = { numerator: spans[0].numerator, denominator: spans[0].denominator };

  const used = new Set<string>();
  const tracks: BuiltTrack[] = [];
  let maxShift = 0;
  let noteCount = 0;

  for (const group of groupNotes(midi, args.tracks)) {
    // Drums are already one "voice" — every hit is its own token, and a kit
    // track stacks simultaneous limbs the same way a chord stacks pitches.
    const voices = group.drums
      ? [group.notes]
      : separateVoices(group.notes, { maxVoices: Math.max(1, args.voices) });

    voices.forEach((voice, i) => {
      const base = slugify(group.name, group.drums ? 'drums' : 'part');
      let key = voices.length > 1 ? `${base}${i + 1}` : base;
      while (used.has(key)) key += '-';
      used.add(key);

      // One notation pass per meter span, with a "n/d" directive between them.
      const lines: string[] = [];
      let placed: { start: number; midi: number }[] = [];
      let shift = 0;
      spans.forEach((span, si) => {
        const spanEnd = span.startBeat + span.measures * span.measureBeats;
        const inSpan = voice
          .filter((n) => n.start >= span.startBeat - 1e-9 && n.start < spanEnd - 1e-9)
          .map((n) => ({ ...n, start: n.start - span.startBeat }));
        const res = notateMeasures(inSpan, {
          measureBeats: span.measureBeats,
          slots: span.numerator,
          minMeasures: span.measures,
          ticks: lcm(NOTATE_TICKS, midi.tpqn),
          snap: args.snap || undefined,
          legato: args.legato,
          preferFlat,
          spell: group.drums
            ? (m) => drumName(m) ?? `x${m}` // unmapped percussion stays visible
            : undefined,
        });
        if (si > 0) lines.push(`${span.numerator}/${span.denominator}`);
        lines.push(...res.lines.slice(0, span.measures));
        placed = placed.concat(res.placed.map((p) => ({ ...p, start: p.start + span.startBeat - origin })));
        shift = Math.max(shift, res.maxShift);
      });
      if (!placed.length) { used.delete(key); return; }
      maxShift = Math.max(maxShift, shift);
      noteCount += placed.length;
      tracks.push({ key, drums: group.drums, sample: sampleForProgram(group.program), lines, maxShift: shift, placed });
    });
  }

  const measure = `${meterOut.numerator}/${meterOut.denominator}`;
  const L: string[] = [
    `# Imported from MIDI by play-yaml-import.`,
    `# ${noteCount} notes, ${tracks.length} track(s), ${measure} at ${bpm} bpm` +
      (args.snap ? `, snapped to 1/${args.snap} (max onset shift ${maxShift.toFixed(4)} beat)` : ', unquantized'),
    '',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `tempo: ${bpm}`,
    `measure: ${measure}`,
    '',
    'tracks:',
  ];
  for (const t of tracks) {
    L.push(`  ${t.key}: { ${t.drums ? 'kit: acoustic' : `sample: ${t.sample}`} }`);
  }
  L.push('', 'sections:', '  piece:', '    loop: false');
  for (const t of tracks) {
    L.push(`    ${t.key}:`);
    L.push('      play:');
    for (const line of t.lines) L.push(`        - "${line}"`);
  }

  const lastSpan = spans[spans.length - 1];
  return {
    yaml: L.join('\n') + '\n',
    window: { fromBeat: origin, toBeat: lastSpan.startBeat + lastSpan.measures * lastSpan.measureBeats },
    bpm, measure, tracks, maxShift, noteCount,
  };
}

interface VerifyReport {
  sourceNotes: number;
  scoreNotes: number;
  /** Source notes with no counterpart in the score — notes genuinely lost. */
  missing: number;
  /** Score notes with no counterpart in the source — notes invented. */
  extra: number;
  /** Of the notes that did match, how many landed on a different beat. */
  moved: number;
  /** The largest of those moves, in quarter-note beats. */
  maxShift: number;
  /** Nothing lost, nothing invented, nothing moved. */
  exact: boolean;
  /** Nothing lost or invented — moves are the price of `--snap`. */
  complete: boolean;
}

/**
 * Compile the emitted score and diff it against the source file.
 *
 * Two different failures are worth telling apart, so they are counted apart:
 * a note that *vanished* is a bug, while a note that *moved* is what `--snap`
 * was asked to do. Matching is therefore per pitch and nearest-in-time rather
 * than exact-position, with the distance reported instead of thresholded — an
 * import that shifted every onset by an eighth still says so out loud.
 *
 * Drum tracks are compared by count only: our kits deliberately fold several
 * GM numbers onto one token, so their pitches are not expected to survive.
 */
function verify(
  bytes: Uint8Array,
  yamlText: string,
  drumKeys: Set<string>,
  window?: { fromBeat: number; toBeat: number },
  trackFilter?: string,
): VerifyReport {
  const midi = decodeMidi(bytes);
  const song = compileDoc(parseYaml(yamlText));
  if (trackFilter) {
    midi.notes = midi.notes.filter((n) => trackWanted(trackFilter, n.track, midi.trackNames[n.track] ?? ''));
  }
  // With --bars only part of the file was imported; compare against that part,
  // rebased so the excerpt's first bar is beat 0.
  if (window) {
    midi.notes = midi.notes
      .filter((n) => n.startBeat >= window.fromBeat - 1e-9 && n.startBeat < window.toBeat - 1e-9)
      .map((n) => ({ ...n, startBeat: n.startBeat - window.fromBeat }));
  }

  const byPitch = (notes: { start: number; midi: number }[]) => {
    const m = new Map<number, number[]>();
    for (const n of notes) {
      const arr = m.get(n.midi);
      if (arr) arr.push(n.start);
      else m.set(n.midi, [n.start]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  };

  const src = byPitch(midi.notes.filter((n) => n.channel !== 9)
    .map((n) => ({ start: n.startBeat, midi: n.pitch })));
  const got = byPitch(song.tracks.filter((t) => !drumKeys.has(t.name))
    .flatMap((t) => t.timeline.map((e) => ({ start: e.time, midi: e.midi }))));

  let missing = 0;
  let extra = 0;
  let moved = 0;
  let maxShift = 0;
  const EPS = 1e-6;

  for (const [pitch, want] of src) {
    // Same pitch, both in time order: walk the two lists together and pair
    // each note with its nearest counterpart, stepping past whichever side is
    // surplus. Pairing strictly by index would work only while the counts
    // match — once one note is dropped, every later pair is off by one and the
    // reported shift becomes nonsense instead of a diagnosis.
    const have = got.get(pitch) ?? [];
    let i = 0;
    let j = 0;
    while (i < want.length && j < have.length) {
      const d = Math.abs(want[i] - have[j]);
      if (j + 1 < have.length && Math.abs(want[i] - have[j + 1]) < d) {
        extra++;
        j++;
      } else if (i + 1 < want.length && Math.abs(want[i + 1] - have[j]) < d) {
        missing++;
        i++;
      } else {
        if (d > EPS) {
          moved++;
          maxShift = Math.max(maxShift, d);
        }
        i++;
        j++;
      }
    }
    missing += want.length - i;
    extra += have.length - j;
  }
  for (const [pitch, have] of got) if (!src.has(pitch)) extra += have.length;

  const drumSource = midi.notes.filter((n) => n.channel === 9).length;
  const drumScore = song.tracks.filter((t) => drumKeys.has(t.name))
    .reduce((n, t) => n + t.timeline.length, 0);
  missing += Math.max(0, drumSource - drumScore);
  extra += Math.max(0, drumScore - drumSource);

  const sourceNotes = midi.notes.length;
  const scoreNotes = song.tracks.reduce(
    (n, t) => n + t.timeline.length, 0);

  return {
    sourceNotes,
    scoreNotes,
    missing,
    extra,
    moved,
    maxShift,
    exact: missing === 0 && extra === 0 && moved === 0,
    complete: missing === 0 && extra === 0,
  };
}

run(() => {
  const { flags, positional } = parseFlags(process.argv.slice(2), {
    input: { names: ['--input', '-i'], value: true },
    output: { names: ['--output', '-o'], value: true },
    title: { names: ['--title'], value: true },
    bpm: { names: ['--bpm', '-b'], value: true },
    measure: { names: ['--measure'], value: true },
    bars: { names: ['--bars'], value: true },
    tracks: { names: ['--tracks'], value: true },
    spelling: { names: ['--flats', '--sharps'], spelling: true },
    snap: { names: ['--snap'], value: true },
    voices: { names: ['--voices'], value: true },
    legato: { names: ['--legato'] },
    verify: { names: ['--verify'] },
    json: { names: ['--json'] },
    help: { names: ['--help', '-h'] },
  });
  const input = (flags.input as string | undefined) ?? positional[0];
  if (flags.help || !input) usage(HELP, flags.help);

  const inputPath = path.resolve(process.cwd(), input);
  const bytes = new Uint8Array(fs.readFileSync(inputPath));
  const opts: ImportOptions = {
    title: (flags.title as string | undefined) ?? path.basename(inputPath).replace(/\.[^.]+$/, ''),
    bpm: Number(flags.bpm) || undefined,
    measure: flags.measure as string | undefined,
    bars: flags.bars as string | undefined,
    tracks: flags.tracks as string | undefined,
    flats: flags.spelling === undefined ? undefined : flags.spelling === '--flats',
    snap: flags.snap ? Number(flags.snap) : 0,
    voices: flags.voices ? Number(flags.voices) : 4,
    legato: Boolean(flags.legato),
  };
  const result = importMidi(bytes, opts);

  const output = flags.output === '-'
    ? null
    : (flags.output as string | undefined) ?? inputPath.replace(/\.[^.]+$/, '') + '.play.yaml';
  if (output) fs.writeFileSync(output, result.yaml);
  else process.stdout.write(result.yaml);

  if (!flags.verify) {
    console.error(
      `# ${result.noteCount} notes, ${result.tracks.length} track(s), ${result.measure} at ${result.bpm} bpm` +
      (opts.snap ? `, max onset shift ${result.maxShift.toFixed(4)} beat` : '') +
      (output ? ` → ${path.relative(process.cwd(), output)}` : ''),
    );
    return;
  }

  const drumKeys = new Set(result.tracks.filter((t) => t.drums).map((t) => t.key));
  const report = verify(bytes, result.yaml, drumKeys, result.window, opts.tracks);
  if (flags.json) {
    process.stderr.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.error(
      `# verify: source ${report.sourceNotes} notes | score ${report.scoreNotes} | ` +
      `missing ${report.missing} extra ${report.extra} | ` +
      `moved ${report.moved} (max ${report.maxShift.toFixed(4)} beat) | ` +
      (report.exact ? 'EXACT ✓' : report.complete ? 'COMPLETE (quantized) ✓' : 'NOTES LOST ✗'),
    );
  }
  // Moving notes is what --snap is for; losing them never is.
  if (!report.complete) process.exit(1);
});
