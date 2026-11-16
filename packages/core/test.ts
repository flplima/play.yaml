import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  compileDoc, parsePlayFull, TimelineEvent, TrackProps, PlayInput, DEFAULT_TEMPO, DEFAULT_SAMPLE,
  DEFAULT_VELOCITY,
} from './src/song';
import { parseSet } from './src/set';
import { noteToMidi, measureToBeats } from './src/theory';
import { divideByWeight, peelSuffix, tokenSpans, tokenWeight, isRestToken } from './src/tokens';
import { isDirectiveString } from './src/set';
import { bjorklund, expandArp, expandSpread, expandWalk, hash01 } from './src/generate';
import { encodeMidi } from './src/exporter';
import { decodeMidi, compareMidi } from './src/fidelity';
import { notateMeasures, separateVoices } from './src/notate';
import { parseYaml } from './src/yaml';
import { tempoSegments, beatsToSeconds, secondsToBeats, TempoSegment } from './src/time';
import { panicMessages } from './src/midiPanic';
import { DEFAULT_CONTROLS, DEFAULT_GATE, controlValue } from './src/vocabulary';
import { NotationEvent, Score, handOf, keyFromScale, scoreFromDoc, scoreNotes } from './src/notation';
import { encodeMusicXml } from './src/musicxml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
const failed: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`  ✗ ${name}`);
    console.error(String(error instanceof Error ? error.message : error).replace(/^/gm, '      '));
  }
}

/** Compile one track's measures to its note timeline. */
function parsePlay(play: PlayInput, props: TrackProps = {}): TimelineEvent[] {
  return parsePlayFull(play, props).timeline;
}
function times(tl: TimelineEvent[]): number[] {
  return tl.map((n) => n.time);
}
function midis(tl: TimelineEvent[]): number[] {
  return tl.map((n) => n.midi);
}

console.log('noteToMidi:');
check('bare letters default to octave 4 (c → 60)', () => {
  assert.strictEqual(noteToMidi('c'), 60);
  assert.strictEqual(noteToMidi('a'), 69);
});
check('accidentals and octaves (eb3, f#2, B5)', () => {
  assert.strictEqual(noteToMidi('eb3'), 51);
  assert.strictEqual(noteToMidi('f#2'), 42);
  assert.strictEqual(noteToMidi('B5'), 83);
});
check('default octave override', () => {
  assert.strictEqual(noteToMidi('c', 2), 36);
});
check('non-notes are rejected', () => {
  assert.strictEqual(noteToMidi('~'), null);
  assert.strictEqual(noteToMidi('x'), null);
});

console.log('\nmeasureToBeats:');
check('4/4 → 4, 3/4 → 3, 6/8 → 3, plain number passes through', () => {
  assert.strictEqual(measureToBeats('4/4'), 4);
  assert.strictEqual(measureToBeats('3/4'), 3);
  assert.strictEqual(measureToBeats('6/8'), 3);
  assert.strictEqual(measureToBeats(5), 5);
  assert.strictEqual(measureToBeats(undefined), 4);
});

console.log('\nequal division:');
check('4 tokens in 4/4 are quarter notes', () => {
  const tl = parsePlay('c d e d');
  assert.deepStrictEqual(times(tl), [0, 1, 2, 3]);
  assert.strictEqual(tl[0].duration, 0.9);
});
check('8 tokens in 4/4 are eighth notes', () => {
  const tl = parsePlay(['c c ~ ~ c c ~ ~']);
  assert.deepStrictEqual(times(tl), [0, 0.5, 2, 2.5]);
  assert.strictEqual(tl[0].duration, 0.45);
});
check('measures advance by measure length', () => {
  const tl = parsePlay(['c c g g', 'a a g ~']);
  assert.deepStrictEqual(times(tl), [0, 1, 2, 3, 4, 5, 6]);
});
check('multiline string = one measure per line', () => {
  const tl = parsePlay('c c g g\na a g ~');
  assert.deepStrictEqual(times(tl), [0, 1, 2, 3, 4, 5, 6]);
});

console.log('\ntokens:');
check('tokenSpans splits at depth 0 and keeps offsets; fences are one token', () => {
  const text = '{c [d e]} f ||oct up|| ==Dm7== g';
  const spans = tokenSpans(text);
  assert.deepStrictEqual(spans.map((s) => s.text), ['{c [d e]}', 'f', '||oct up||', '==Dm7==', 'g']);
  for (const s of spans) assert.strictEqual(text.slice(s.from, s.to), s.text);
});
check('peelSuffix separates marks from the token; a bare ~ is a rest, not a suffix', () => {
  assert.deepStrictEqual(peelSuffix('[c e g]~>'), { core: '[c e g]', marks: '~>' });
  assert.deepStrictEqual(peelSuffix('~:'), { core: '~', marks: ':' });
  assert.deepStrictEqual(peelSuffix('~'), { core: '~', marks: '' });
  assert.ok(isRestToken('~:') && isRestToken('~') && !isRestToken('c~'));
});
check('tokenWeight and divideByWeight share a span by dots and colons', () => {
  assert.deepStrictEqual(['c', 'c.', 'c:', 'c:.', 'c::'].map(tokenWeight), [1, 1.5, 2, 3, 4]);
  assert.deepStrictEqual(divideByWeight(['c:', 'd', 'e'], 4), [
    { offset: 0, span: 2 }, { offset: 2, span: 1 }, { offset: 3, span: 1 },
  ]);
  assert.deepStrictEqual(divideByWeight([], 4), []);
});
check('isDirectiveString: marks are directives, notes (even "f") are measures', () => {
  assert.ok(isDirectiveString('legato') && isDirectiveString('allargando over 2'));
  assert.ok(!isDirectiveString('f') && !isDirectiveString('c d e d') && !isDirectiveString(''));
});
check('a lone _ is the hold token, a bare ~ a rest, and unweighted tokens divide equally', () => {
  const held = parsePlay('c _ _ _');
  assert.strictEqual(held.length, 1);
  assert.strictEqual(held[0].duration, 3.6);
  assert.strictEqual(parsePlay('c ~ ~ ~').length, 1);
  assert.deepStrictEqual(times(parsePlay('c d e d')), [0, 1, 2, 3]);
});
check('[c e g] chords are simultaneous', () => {
  const tl = parsePlay('[c e g] ~ ~ ~');
  assert.deepStrictEqual(times(tl), [0, 0, 0]);
  assert.deepStrictEqual(midis(tl), [60, 64, 67]);
});
check('{c d} groups subdivide their slot', () => {
  const tl = parsePlay('{c d} e ~ ~');
  assert.deepStrictEqual(times(tl), [0, 0.5, 1]);
});
check('groups recurse: {c {d e}}', () => {
  const tl = parsePlay('{c {d e}} ~ ~ ~');
  assert.deepStrictEqual(times(tl), [0, 0.5, 0.75]);
});
check('chords nest inside groups: {c [e g]}', () => {
  const tl = parsePlay('{c [e g]} ~ ~ ~');
  assert.deepStrictEqual(times(tl), [0, 0.5, 0.5]);
});
check('a full measure of beat groups: {g2 d3 b3 a3} {b3 d3 b3 d3} …', () => {
  const tl = parsePlay('{g2 d3 b3 a3} {b3 d3 b3 d3} {g2 d3 b3 a3} {b3 d3 b3 d3}');
  assert.strictEqual(tl.length, 16);
  assert.deepStrictEqual(times(tl).slice(0, 6), [0, 0.25, 0.5, 0.75, 1, 1.25]);
});
check('unknown tokens fall back to rests', () => {
  assert.strictEqual(parsePlay('c xyz9 e ~').length, 2);
});
check('an unreadable token is reported, not just silenced', () => {
  // The whole point: a mistyped mark ("sostenuto" before it was vocabulary)
  // used to swallow a bar with nothing to point at.
  const song = compileDoc({ play: ['c ~ ~ ~', 'ritardadno', 'c ~ ~ ~'] });
  assert.strictEqual(song.warnings.length, 1);
  assert.match(song.warnings[0], /bar 2/);
  assert.match(song.warnings[0], /ritardadno/);
  // …and it still plays, so a half-written score is not blocked.
  assert.strictEqual(song.tracks[0].timeline.length, 2);
});
check('a panic lifts the pedals before it kills the notes', () => {
  // Regression: Stop sent only All Notes Off + All Sound Off, and the MIDI
  // spec has All Notes Off leave damper-pedalled notes ringing — so a score
  // holding the sustain pedal kept sounding after Stop.
  const ch0 = panicMessages([0]);
  const order = ch0.map((m) => m.controller);
  assert.deepStrictEqual(order, [64, 66, 67, 121, 123, 120]);
  assert.ok(order.indexOf(64) < order.indexOf(123), 'sustain must be released before all-notes-off');
  assert.ok(ch0.every((m) => m.value === 0));
  assert.strictEqual(panicMessages().length, 16 * 6); // every channel
  // Reset All Controllers must not be asked to touch volume or pan.
  assert.ok(!order.includes(7) && !order.includes(10));
});
check('a control range can be a ceiling, a band, or a curve', () => {
  assert.strictEqual(controlValue({ cc: 64 }, 1), 127); // default 0..127
  assert.strictEqual(controlValue({ cc: 64, range: 110 }, 1), 110); // ceiling
  assert.strictEqual(controlValue({ cc: 64, range: 110 }, 0), 0);
  assert.strictEqual(controlValue({ cc: 74, range: [40, 100] }, 0), 40); // band
  assert.strictEqual(controlValue({ cc: 74, range: [40, 100] }, 1), 100);
  assert.strictEqual(controlValue({ cc: 74, range: [127, 0] }, 1), 0); // inverted
  // A curve is piecewise linear across evenly spaced breakpoints.
  const curve = { cc: 64, range: [0, 24, 96, 118] };
  assert.strictEqual(controlValue(curve, 0), 0);
  assert.strictEqual(controlValue(curve, 1), 118);
  assert.strictEqual(controlValue(curve, 0.5), 60); // midpoint of the 24→96 leg
  assert.strictEqual(controlValue(curve, 1 / 3), 24);
});
check('pedal words follow the control they are given', () => {
  const song = compileDoc({
    controls: { pedal: { cc: 64, range: 110 } },
    play: ['con pedale', 'c ~ ~ ~'],
  });
  assert.deepStrictEqual(song.tracks[0].controls, [{ time: 0, cc: 64, value: 110 }]);
});
check('a score that declared `sustain` still answers to the pedal words', () => {
  const song = compileDoc({ controls: { sustain: 64 }, play: ['half pedal', 'c ~ ~ ~'] });
  assert.deepStrictEqual(song.tracks[0].controls.map((c) => c.cc), [64]);
});
check('pedale sincopato re-takes the pedal every bar', () => {
  const song = compileDoc({
    controls: { pedal: { cc: 64 } },
    set: 'pedale sincopato',
    play: ['c ~ ~ ~', 'd ~ ~ ~', 'e ~ ~ ~'],
  });
  const pedal = song.tracks[0].controls.filter((c) => c.cc === 64);
  assert.strictEqual(pedal.length, 6); // lift + catch, three bars
  // It lifts *on* the barline and catches straight after — that is the point.
  assert.deepStrictEqual(pedal.map((c) => c.time), [0, 0.06, 4, 4.06, 8, 8.06]);
  assert.deepStrictEqual(pedal.map((c) => c.value), [0, 127, 0, 127, 0, 127]);
});
check('pedal per bar releases before the barline instead', () => {
  const song = compileDoc({ controls: { pedal: { cc: 64 } }, set: 'pedal per bar', play: ['c ~ ~ ~'] });
  const pedal = song.tracks[0].controls.filter((c) => c.cc === 64);
  assert.deepStrictEqual(pedal.map((c) => [c.time, c.value]), [[0, 127], [3.94, 0]]);
});
check('senza pedale cancels the pattern and drops the dampers', () => {
  const song = compileDoc({
    controls: { pedal: { cc: 64 } },
    set: 'pedale sincopato',
    play: ['c ~ ~ ~', 'senza pedale', 'd ~ ~ ~'],
  });
  const pedal = song.tracks[0].controls.filter((c) => c.cc === 64);
  assert.strictEqual(pedal[pedal.length - 1].value, 0);
  // Nothing re-takes it in the bar after the cancel.
  assert.strictEqual(pedal.filter((c) => c.time >= 4).length, 1);
});
check('a clean score carries no warnings', () => {
  assert.deepStrictEqual(compileDoc({ play: ['c ~ ~ ~', 'legato', 'e ~ ~ ~'] }).warnings, []);
});
check('sostenuto is a real articulation, not a silent bar', () => {
  // Regression: BWV 846 lost bar 25 to this word.
  const song = compileDoc({ play: ['c ~ ~ ~', 'forte', 'sostenuto', 'e ~ ~ ~'] });
  assert.deepStrictEqual(song.warnings, []);
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [0, 4]);
  // Gate only — it must not undo the `forte` above it.
  assert.strictEqual(song.tracks[0].timeline[1].velocity, 96); // forte
});

console.log('\nchords as scales:');
check('a chord symbol implies its chord-scale', () => {
  assert.deepStrictEqual(midis(parsePlay('1 3 5 7', { scale: 'A7', octave: 3 })), [57, 61, 64, 67]);
  // Dm7 is dorian: the 6th is B natural, not Bb
  assert.deepStrictEqual(midis(parsePlay('6 ~ ~ ~', { scale: 'Dm7', octave: 3 })), [59]);
  assert.deepStrictEqual(midis(parsePlay('6 ~ ~ ~', { scale: 'Dm', octave: 3 })), [58]);
});
check('maj7/maj9 are ionian — not swallowed by the bare-minor pattern', () => {
  // Regression: case-insensitive /^(m…)/ used to match "maj7" first, turning
  // every major-seventh chord aeolian (b3/b6/b7).
  assert.deepStrictEqual(midis(parsePlay('1 3 5 7', { scale: 'Cmaj7', octave: 4 })), [60, 64, 67, 71]);
  assert.deepStrictEqual(midis(parsePlay('3 ~ ~ ~', { scale: 'Dbmaj9', octave: 4 })), [65]);
  assert.deepStrictEqual(midis(parsePlay('4 ~ ~ ~', { scale: 'Fmaj7#11', octave: 4 })), [71]); // lydian
});
check('half-diminished, diminished and augmented qualities', () => {
  assert.deepStrictEqual(midis(parsePlay('1 3 5 7', { scale: 'Em7b5', octave: 3 })), [52, 55, 58, 62]);
  assert.deepStrictEqual(midis(parsePlay('1 3 5 7', { scale: 'G#dim7', octave: 2 })), [44, 47, 50, 53]);
  assert.deepStrictEqual(midis(parsePlay('1 3 ~ ~', { scale: 'Caug', octave: 4 })), [60, 64]);
});
check('a slash bass is accepted and degrees stay on the chord root', () => {
  assert.deepStrictEqual(
    midis(parsePlay('1 3 5 ~', { scale: 'Gm6/Bb', octave: 3 })),
    midis(parsePlay('1 3 5 ~', { scale: 'Gm6', octave: 3 })),
  );
});
check('==Dm7== re-keys the degrees mid-measure', () => {
  const tl = parsePlay('==Dm== 1 ==A7== 1', { octave: 3 });
  assert.deepStrictEqual(midis(tl), [50, 57]); // d3 then a3
  assert.deepStrictEqual(times(tl), [0, 2]); // the marks take no slot
});
check('==C mixolydian== works as well as a chord', () => {
  assert.deepStrictEqual(midis(parsePlay('==c mixolydian== 7 ~ ~ ~', { octave: 4 })), [70]);
});

console.log('\noctave-down prefix:');
check('_ before a degree or note drops it an octave', () => {
  assert.deepStrictEqual(midis(parsePlay('1 _1 __1 ~', { scale: 'd minor', octave: 3 })),
    [50, 38, 26]);
  assert.deepStrictEqual(midis(parsePlay('d3 _d3 ~ ~')), [50, 38]);
});
check('the prefix matches the existing suffix form', () => {
  assert.deepStrictEqual(
    midis(parsePlay('_5 ~ ~ ~', { scale: 'd minor', octave: 3 })),
    midis(parsePlay('5- ~ ~ ~', { scale: 'd minor', octave: 3 })),
  );
});

console.log('\nheld notes:');
check('_ prolongs the previous note instead of striking a new one', () => {
  const tl = parsePlay('c _ _ _');
  assert.strictEqual(tl.length, 1);
  assert.strictEqual(tl[0].duration, 4 * 0.9);
});
check('a rest still cuts the sound, and cannot be prolonged across', () => {
  const tl = parsePlay('c ~ _ _');
  assert.strictEqual(tl.length, 1);
  assert.strictEqual(tl[0].duration, 0.9);
});
check('_ ties across the barline', () => {
  const tl = parsePlay(['c ~ ~ ~'.replace('~ ~ ~', '_ _ _'), '_ _ _ _']);
  assert.strictEqual(tl.length, 1);
  assert.strictEqual(tl[0].duration, 8 * 0.9);
});
check('a chord is prolonged as a whole', () => {
  const tl = parsePlay('[c e g] _ ~ ~');
  assert.strictEqual(tl.length, 3);
  assert.deepStrictEqual(tl.map((n) => n.duration), [1.8, 1.8, 1.8]);
});
check('inside a group, _ prolongs only the note before it', () => {
  const tl = parsePlay('{c d _ _} ~ ~ ~');
  assert.deepStrictEqual(tl.map((n) => [n.time, n.duration]), [[0, 0.225], [0.25, 0.675]]);
});
check('_ picks up the gate in force when it lands', () => {
  const tl = parsePlay(['c _ _ _'], { gate: 1 });
  assert.strictEqual(tl[0].duration, 4);
});

console.log('\nscale degrees:');
check('degree 1 = scale root at the track octave (g2 = 1)', () => {
  const tl = parsePlay('1 2 3 4', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [43, 45, 47, 48]); // g2 a2 b2 c3
});
check('degrees past 7 climb octaves (8 = root an octave up)', () => {
  const tl = parsePlay('8 10 15 ~', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [55, 59, 67]); // g3 b3 g4
});
check('#/b suffixes shift a semitone (4# = c#3, 7b = f3)', () => {
  const tl = parsePlay('4# 7b ~ ~', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [49, 53]);
});
check('default scale is c major at octave 4', () => {
  assert.deepStrictEqual(midis(parsePlay('1 3 5 8')), [60, 64, 67, 72]);
});
check('degrees at 0 and below step under the root (0 = f#2, -1 = e2)', () => {
  const tl = parsePlay('0 -1 -2 ~', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [42, 40, 38]); // f#2 e2 d2
});
check('minor scale', () => {
  const tl = parsePlay('1 3 ~ ~', { scale: 'a minor', octave: 3 });
  assert.deepStrictEqual(midis(tl), [57, 60]); // a3 c4
});
check('non-diatonic scales: harmonic minor holds eb AND f# over g', () => {
  const tl = parsePlay('6 7 ~ ~', { scale: 'g harmonic minor', octave: 2 });
  assert.deepStrictEqual(midis(tl), [51, 54]); // eb3, f#3
});
check('multi-word abbreviations: "g harm min", "g bebop dom"', () => {
  assert.deepStrictEqual(
    midis(parsePlay('6 7 ~ ~', { scale: 'g harm min', octave: 2 })),
    midis(parsePlay('6 7 ~ ~', { scale: 'g harmonic minor', octave: 2 })),
  );
  const tl = parsePlay('7 8 ~ ~', { scale: 'g bebop dom', octave: 2 });
  assert.deepStrictEqual(midis(tl), [53, 54]); // f3 and f#3 side by side
});
check('8-note scales wrap the octave at degree 9', () => {
  const tl = parsePlay('1 9 ~ ~', { scale: 'g octatonic', octave: 2 });
  assert.deepStrictEqual(midis(tl), [43, 55]); // g2 → g3
});
check('greek modes: g lydian has a raised 4th, g mixolydian a lowered 7th', () => {
  assert.deepStrictEqual(midis(parsePlay('4 ~ ~ ~', { scale: 'g lydian', octave: 2 })), [49]); // c#3
  assert.deepStrictEqual(midis(parsePlay('7 ~ ~ ~', { scale: 'g mixolydian', octave: 2 })), [53]); // f3
  assert.deepStrictEqual(
    midis(parsePlay('1 2 3 4', { scale: 'g ionian', octave: 2 })),
    midis(parsePlay('1 2 3 4', { scale: 'g major', octave: 2 })),
  );
});
check('scale inherits to children like any prop', () => {
  const song = compileDoc({
    scale: 'g major',
    octave: 2,
    tracks: { cello: { play: '1 ~ ~ ~' } },
  });
  assert.strictEqual(song.tracks[0].timeline[0].midi, 43);
});
check('degrees and letters mix in one measure', () => {
  const tl = parsePlay('1 c3 ~ ~', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [43, 48]);
});

console.log('\noctave modifiers:');
check('^ and + raise an octave, - lowers one', () => {
  const tl = parsePlay('5 5^ 5+ 5-', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [50, 62, 62, 38]); // d3, d4, d4, d2
});
check('modifiers stack: 1^^ is two octaves up', () => {
  assert.deepStrictEqual(midis(parsePlay('1 1^ 1^^ 1--', { scale: 'g major', octave: 2 })),
    [43, 55, 67, 19]);
});
check('^ equals the wrap-around degree (1^ === 8)', () => {
  assert.deepStrictEqual(
    midis(parsePlay('1^ 5- ~ ~', { scale: 'g major', octave: 2 })),
    midis(parsePlay('8 -2 ~ ~', { scale: 'g major', octave: 2 })),
  );
});
check('accidentals come first: 4#^', () => {
  const tl = parsePlay('4# 4#^ ~ ~', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [49, 61]);
});
check('letters take modifiers too: c^ / eb3-', () => {
  assert.deepStrictEqual(midis(parsePlay('c c^ c- eb3-')), [60, 72, 48, 39]);
});
check('modifiers work inside chords and groups', () => {
  const tl = parsePlay('[1 5^] {1 1^} ~ ~', { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [43, 62, 43, 55]);
});
check('8-note scales shift by a true octave, not a scale length', () => {
  assert.deepStrictEqual(midis(parsePlay('1 1^ ~ ~', { scale: 'g octatonic', octave: 2 })), [43, 55]);
});

console.log('\nplay directives:');
check('a scale marker changes subsequent degrees', () => {
  const tl = parsePlay(
    ['1 ~ ~ ~', { scale: 'd major' }, '1 ~ ~ ~'],
    { scale: 'g major', octave: 2 },
  );
  assert.deepStrictEqual(midis(tl), [43, 38]); // g2, then d2
  assert.deepStrictEqual(times(tl), [0, 4]);
});
check('an octave marker shifts subsequent degrees and letters', () => {
  const tl = parsePlay(['1 c ~ ~', { octave: 3 }, '1 c ~ ~'], { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [43, 36, 55, 48]);
});
check('a velocity marker applies onward', () => {
  const tl = parsePlay(['c ~ ~ ~', { velocity: 40 }, 'c ~ ~ ~']);
  assert.deepStrictEqual(tl.map((n) => n.velocity), [90, 40]);
});
check('markers do not advance time or count as measures', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', { scale: 'd major' }, '1 ~ ~ ~'] });
  assert.strictEqual(song.lengthBeats, 8);
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [0, 4]);
});
check('a combined marker sets several props at once', () => {
  const tl = parsePlay(
    ['1 ~ ~ ~', { scale: 'd major', octave: 3 }, '1 ~ ~ ~'],
    { scale: 'g major', octave: 2 },
  );
  assert.deepStrictEqual(midis(tl), [43, 50]); // g2, then d3
});

console.log('\nset shorthand:');
check('scale abbreviations work anywhere a scale does', () => {
  assert.deepStrictEqual(
    midis(parsePlay('4 7 ~ ~', { scale: 'g mix', octave: 2 })),
    midis(parsePlay('4 7 ~ ~', { scale: 'g mixolydian', octave: 2 })),
  );
});
check('set as a track prop patches scale and octave', () => {
  const song = compileDoc({ scale: 'g major', octave: 2, set: 'g lydian, octave up', play: '1 4 ~ ~' });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.midi), [55, 61]); // g3, c#4
});
check('set as a play-list item', () => {
  const tl = parsePlay(
    ['1 ~ ~ ~', { set: 'g mix, oct down' }, '7 ~ ~ ~'],
    { scale: 'g major', octave: 2 },
  );
  assert.deepStrictEqual(midis(tl), [43, 41]); // g2, then f2 (mixolydian 7th, octave 1)
});
check('inline ||…|| directive splits a measure mid-way', () => {
  const tl = parsePlay('1 2 3 4 ||c lyd, oct up|| 5 6 7 8', { scale: 'c major', octave: 4 });
  assert.deepStrictEqual(times(tl), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]); // 8 tokens, directive free
  assert.deepStrictEqual(midis(tl), [60, 62, 64, 65, 79, 81, 83, 84]); // c-lydian octave 5 after
});
check('a directive-only line is not a measure', () => {
  const song = compileDoc({
    scale: 'g major', octave: 2,
    play: ['1 ~ ~ ~', '||g lyd, oct up||', '1 ~ ~ ~'],
  });
  assert.strictEqual(song.lengthBeats, 8);
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => [n.time, n.midi]), [[0, 43], [4, 55]]);
});
check('absolute octave clause: "oct 3"', () => {
  const tl = parsePlay(['1 ~ ~ ~', { set: 'oct 3' }, '1 ~ ~ ~'], { scale: 'g major', octave: 2 });
  assert.deepStrictEqual(midis(tl), [43, 55]);
});
check('unknown set clauses throw', () => {
  assert.throws(() => parseSet('warp speed'), /Unknown set clause/);
});

console.log('\narticulation (gate):');
check('default gate leaves a gap; legato overlaps into the next slot', () => {
  assert.strictEqual(parsePlay('c d ~ ~')[0].duration, 0.9);
  const legato = parsePlay('c d ~ ~', { gate: 1.05 });
  assert.strictEqual(legato[0].duration, 1.05);
  // Overlap is what tells a physical model to slur: note 1 still sounds at 1.0.
  assert.ok(legato[0].time + legato[0].duration > legato[1].time);
});
check('named articulations via set: legato / staccato / detached', () => {
  const tl = parsePlay(['c ~ ~ ~', { set: 'legato' }, 'c ~ ~ ~', { set: 'staccato' }, 'c ~ ~ ~']);
  assert.deepStrictEqual(tl.map((n) => n.duration), [0.9, 1.05, 0.4]);
});
check('gate is inheritable and overridable per track', () => {
  const song = compileDoc({
    gate: 1.05,
    tracks: { a: { play: 'c ~ ~ ~' }, b: { gate: 0.4, play: 'c ~ ~ ~' } },
  });
  assert.strictEqual(song.tracks[0].timeline[0].duration, 1.05);
  assert.strictEqual(song.tracks[1].timeline[0].duration, 0.4);
});

console.log('\nplaying techniques:');
check('bow position words run from the fingerboard to the bridge on the bow control', () => {
  const { controls } = parsePlayFull(['c', { set: 'sul tasto' }, 'c', { set: 'ordinario' }, 'c',
    { set: 'sul ponticello' }, 'c']);
  assert.ok(controls.every((c) => c.cc === DEFAULT_CONTROLS.bow.cc));
  const [tasto, ordinario, ponticello] = controls.map((c) => c.value);
  assert.ok(tasto < ordinario && ordinario < ponticello);
});
check('vibrato words, from senza (none) to molto (full)', () => {
  const { controls } = parsePlayFull(['c', { set: 'senza vibrato' }, 'c', { set: 'poco vibrato' }, 'c',
    { set: 'molto vibrato' }, 'c']);
  const [senza, poco, molto] = controls.map((c) => c.value);
  assert.strictEqual(senza, 0);
  assert.strictEqual(molto, 127);
  assert.ok(senza < poco && poco < molto);
});
check('bow pressure words, light under heavy', () => {
  const { controls } = parsePlayFull(['c', { set: 'light bow' }, 'c', { set: 'heavy bow' }, 'c']);
  assert.ok(controls.every((c) => c.cc === DEFAULT_CONTROLS.pressure.cc));
  assert.ok(controls[0].value < controls[1].value);
});
check('a declared control overrides the conventional CC', () => {
  const song = compileDoc({ controls: { bow: 20 }, play: ['c', { set: 'sul tasto' }, 'c'] });
  assert.strictEqual(song.tracks[0].controls[0].cc, 20);
});
check('a control range can narrow or invert the mapping', () => {
  const narrow = compileDoc({
    controls: { bow: { cc: 74, min: 40, max: 80 } },
    play: ['c', { set: 'sul tasto' }, 'c', { set: 'sul ponticello' }, 'c'],
  });
  assert.deepStrictEqual(narrow.tracks[0].controls.map((c) => c.value), [40, 76]);
  const inverted = compileDoc({
    controls: { bow: { cc: 74, min: 127, max: 0 } },
    play: ['c', { set: 'sul tasto' }, 'c'],
  });
  assert.strictEqual(inverted.tracks[0].controls[0].value, 127);
});
check('techniques work with no controls declared at all', () => {
  assert.deepStrictEqual(parseSet('sul ponticello').ccs, [{ cc: 74, value: 114 }]);
  assert.deepStrictEqual(parseSet('molto vibrato').ccs, [{ cc: 1, value: 127 }]);
});
check('a track-level set: opens the instrument at beat 0', () => {
  const song = compileDoc({ set: 'sul tasto, molto vibrato, mezzoforte', play: 'c d e f' });
  assert.deepStrictEqual(song.tracks[0].controls, [
    { time: 0, cc: 74, value: 0 },
    { time: 0, cc: 1, value: 127 },
  ]);
  assert.strictEqual(song.tracks[0].timeline[0].velocity, 80); // the mezzoforte applied too
});

console.log('\ncontrol changes:');
check('raw cc clauses emit control events at their beat', () => {
  const { controls } = parsePlayFull(['c ~ ~ ~', { set: 'cc74 30' }, 'c ~ ~ ~']);
  assert.deepStrictEqual(controls, [{ time: 4, cc: 74, value: 30 }]);
});
check('named controls resolve through the track\'s alias map', () => {
  const song = compileDoc({
    controls: { bow: 74, pressure: 71 },
    play: ['c ~ ~ ~', { set: 'bow 30, pressure 90' }, 'c ~ ~ ~'],
  });
  assert.deepStrictEqual(song.tracks[0].controls, [
    { time: 4, cc: 74, value: 30 },
    { time: 4, cc: 71, value: 90 },
  ]);
});
check('an inline ||…|| control lands mid-measure', () => {
  const { controls } = parsePlayFull('c ||cc74 30|| d e f');
  assert.strictEqual(controls[0].time, 1);
});
check('cc values clamp to 0..127', () => {
  assert.deepStrictEqual(parseSet('cc74 300').ccs, [{ cc: 74, value: 127 }]);
});
check('a numeric control uses the conventional CC; unknown names still throw', () => {
  assert.deepStrictEqual(parseSet('bow 30').ccs, [{ cc: 74, value: 30 }]);
  assert.throws(() => parseSet('wobble 30'), /Unknown set clause/);
});

console.log('\ntranspose:');
check('transpose shifts absolute pitches, which octave: cannot reach', () => {
  const plain = compileDoc({ play: 'e4 f4 g4' });
  const up = compileDoc({ transpose: 12, play: 'e4 f4 g4' });
  assert.deepStrictEqual(midis(plain.tracks[0].timeline), [64, 65, 67]);
  assert.deepStrictEqual(midis(up.tracks[0].timeline), [76, 77, 79]);
  // The point of the prop: `octave:` is the default for *bare* names only.
  const octave = compileDoc({ octave: 5, play: 'e4 f4 g4' });
  assert.deepStrictEqual(midis(octave.tracks[0].timeline), [64, 65, 67]);
});
check('transpose reaches degrees, chords and octave-dropped tokens alike', () => {
  const song = compileDoc({ scale: 'c major', transpose: -12, play: '1 [1 3 5] _2' });
  const tl = song.tracks[0].timeline;
  assert.strictEqual(tl[0].midi, 48); // degree 1 = c4, down an octave
  assert.deepStrictEqual(midis(tl.slice(1, 4)), [48, 52, 55]);
  assert.strictEqual(tl[4].midi, 38); // `_2` = d4 an octave down, then transposed
});
check('a kit track is left alone — its tokens name drums, not pitches', () => {
  const song = compileDoc({ kit: 'acoustic', transpose: 12, play: 'bd sd bd sd' });
  const plain = compileDoc({ kit: 'acoustic', play: 'bd sd bd sd' });
  assert.deepStrictEqual(midis(song.tracks[0].timeline), midis(plain.tracks[0].timeline));
});
check('transpose inherits like any other prop', () => {
  const song = compileDoc({
    transpose: 12,
    tracks: { lead: { play: 'c4' }, bass: { transpose: 0, play: 'c4' } },
  });
  assert.strictEqual(song.tracks[0].timeline[0].midi, 72);
  assert.strictEqual(song.tracks[1].timeline[0].midi, 60); // own value wins
});

console.log('\nbow release:');
const releaseDoc = (extra: Record<string, unknown> = {}) => compileDoc({
  controls: { expression: 11 },
  dynamic: 'mezzoforte',
  release: 0.5,
  // Two notes, a bar's rest, then two more: one pause in the middle, one end.
  play: ['c4 d4 ~ ~', 'e4 f4 ~ ~'],
  ...extra,
});
check('the bow eases off into a rest instead of stopping dead', () => {
  const controls = releaseDoc().tracks[0].controls.filter((c) => c.cc === 11);
  const held = controls[0].value;
  // Somewhere before the rest the expression must fall well below the dynamic.
  const duringRest = controls.filter((c) => c.time > 1 && c.time <= 2);
  assert.ok(duringRest.length >= 2, `expected a taper, got ${duringRest.length} events`);
  assert.ok(
    duringRest[duringRest.length - 1].value < held / 2,
    `taper ended at ${duringRest[duringRest.length - 1].value}, held was ${held}`,
  );
  assert.ok(
    duringRest.every((c, i) => i === 0 || c.value <= duringRest[i - 1].value),
    'the taper must fall monotonically',
  );
});
check('the bow is put back for the next phrase', () => {
  const controls = releaseDoc().tracks[0].controls.filter((c) => c.cc === 11);
  const held = controls[0].value;
  const atEntry = controls.filter((c) => Math.abs(c.time - 4) < 1e-9);
  assert.ok(atEntry.length >= 1, 'nothing restores the expression at the next entry');
  assert.strictEqual(atEntry[atEntry.length - 1].value, held);
});
check('slurred notes inside a phrase are not released', () => {
  // c4 → d4 are consecutive; only the rest after them counts as a pause.
  const controls = releaseDoc().tracks[0].controls.filter((c) => c.cc === 11);
  const betweenNotes = controls.filter((c) => c.time > 0 && c.time < 0.9);
  assert.strictEqual(betweenNotes.length, 0, 'a slur must not trigger a release');
});
check('release honours the control\'s own floor, not silence', () => {
  const song = compileDoc({
    controls: { expression: { cc: 11, range: [78, 127] } },
    dynamic: 'mezzoforte', release: 0.5, play: ['c4 d4 ~ ~'],
  });
  const values = song.tracks[0].controls.filter((c) => c.cc === 11).map((c) => c.value);
  assert.strictEqual(Math.min(...values), 78);
});
check('gap: decides what counts as a pause', () => {
  const wide = releaseDoc({ release: { over: 0.5, gap: 4 } });
  const mid = wide.tracks[0].controls.filter((c) => c.cc === 11 && c.time > 1 && c.time <= 2);
  assert.strictEqual(mid.length, 0, 'a 2-beat rest must not trigger a 4-beat gap threshold');
});
check('release does nothing without an expression control', () => {
  const song = compileDoc({ release: 0.5, play: ['c4 d4 ~ ~'] });
  assert.deepStrictEqual(song.tracks[0].controls, []);
});

console.log('\nmix controls (volume, pan, reverb, chorus):');
check('the four GM mix controls need no `controls:` declaration', () => {
  assert.deepStrictEqual(parseSet('volume 100').ccs, [{ cc: 7, value: 100 }]);
  assert.deepStrictEqual(parseSet('pan 20').ccs, [{ cc: 10, value: 20 }]);
  assert.deepStrictEqual(parseSet('reverb 40').ccs, [{ cc: 91, value: 40 }]);
  assert.deepStrictEqual(parseSet('chorus 64').ccs, [{ cc: 93, value: 64 }]);
});
check('room words scale the reverb send', () => {
  assert.deepStrictEqual(parseSet('dry').ccs, [{ cc: 91, value: 0 }]);
  assert.deepStrictEqual(parseSet('secco').ccs, [{ cc: 91, value: 0 }]);
  assert.deepStrictEqual(parseSet('room').ccs, [{ cc: 91, value: 38 }]);
  assert.deepStrictEqual(parseSet('cathedral').ccs, [{ cc: 91, value: 121 }]);
  // A hall is wetter than a room, and a cathedral wetter still.
  const at = (word: string) => parseSet(word).ccs![0].value;
  assert.ok(at('room') < at('hall') && at('hall') < at('church') && at('church') < at('cathedral'));
});
check('celeste and ensemble are chorus words', () => {
  const at = (word: string) => parseSet(word).ccs![0];
  assert.deepStrictEqual(at('no chorus'), { cc: 93, value: 0 });
  assert.strictEqual(at('celeste').cc, 93);
  assert.ok(at('celeste').value > 0);
  assert.deepStrictEqual(at('voix celeste'), at('celeste'));
  assert.ok(at('unda maris').value < at('ensemble').value);
});
check('pan centre lands exactly on 64', () => {
  assert.deepStrictEqual(parseSet('pan centre').ccs, [{ cc: 10, value: 64 }]);
  assert.deepStrictEqual(parseSet('pan center').ccs, [{ cc: 10, value: 64 }]);
  assert.deepStrictEqual(parseSet('hard left').ccs, [{ cc: 10, value: 0 }]);
  assert.deepStrictEqual(parseSet('hard right').ccs, [{ cc: 10, value: 127 }]);
});
check('the fader is not a dynamic — "fade out" and "piano" are different things', () => {
  assert.deepStrictEqual(parseSet('fade out').ccs, [{ cc: 7, value: 0 }]);
  assert.strictEqual(parseSet('fade out').velocity, undefined);
  assert.strictEqual(parseSet('piano').ccs, undefined);
  const both = parseSet('piano, fade out');
  assert.strictEqual(both.velocity, 48);
  assert.deepStrictEqual(both.ccs, [{ cc: 7, value: 0 }]);
});
check('a mix word drifts with "over", like any other technique', () => {
  const song = compileDoc({
    play: ['c ~ ~ ~', { set: 'volume 127' }, 'c ~ ~ ~', { set: 'fade out over 1' }, 'c ~ ~ ~'],
  });
  const fader = song.tracks[0].controls.filter((c) => c.cc === 7);
  assert.strictEqual(fader[0].value, 127);
  assert.strictEqual(fader[fader.length - 1].value, 0);
  assert.ok(fader.length > 2, 'the fade is stepped, not a jump');
});
check('a drift starts from the value the track opened on', () => {
  // The opening `set:` is emitted at beat 0 but was not remembered, so the
  // first drift on that control had nowhere to come from and collapsed into a
  // jump: every step of the ramp landed on the target.
  const song = compileDoc({
    set: 'volume 127',
    play: ['c ~ ~ ~', { set: 'fade out over 1' }, 'c ~ ~ ~'],
  });
  const fader = song.tracks[0].controls.filter((c) => c.cc === 7);
  assert.strictEqual(fader[0].value, 127); // the opening
  assert.ok(fader[1].value < 127 && fader[1].value > 0, `ramp jumped to ${fader[1].value}`);
  assert.strictEqual(fader[fader.length - 1].value, 0);
});
check('a track can still remap a mix control to its own CC', () => {
  const song = compileDoc({
    controls: { reverb: { cc: 19, range: [0, 90] } },
    play: ['c ~ ~ ~', { set: 'hall' }, 'c ~ ~ ~'],
  });
  assert.deepStrictEqual(song.tracks[0].controls, [{ time: 4, cc: 19, value: 56 }]);
});

console.log('\ntempo changes:');
check('set: tempo N is an immediate change at that measure', () => {
  const song = compileDoc({ tempo: 100, play: ['c ~ ~ ~', { set: 'tempo 60' }, 'c ~ ~ ~'] });
  assert.strictEqual(song.bpm, 100);
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 60, rampBeats: 0 }]);
});
check('set: tempo N over M ramps across M measures', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', { set: 'tempo 60 over 2' }, 'c ~ ~ ~'] });
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 60, rampBeats: 8 }]);
});
check('a direct tempo: key works as a directive too', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', { tempo: 90 }, 'c ~ ~ ~'] });
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 90, rampBeats: 0 }]);
});
check('tempo changes are merged across tracks and sorted', () => {
  const song = compileDoc({
    tracks: {
      a: { play: ['c ~ ~ ~', { set: 'tempo 60' }, 'c ~ ~ ~'] },
      b: { play: ['c ~ ~ ~', 'c ~ ~ ~', { set: 'tempo 120' }, 'c ~ ~ ~'] },
    },
  });
  assert.deepStrictEqual(song.tempoMap.map((t) => [t.time, t.bpm]), [[4, 60], [8, 120]]);
});
check('exported .mid carries the extra tempo meta-events', () => {
  const plain = encodeMidi(compileDoc({ play: ['c ~ ~ ~', 'c ~ ~ ~'] }));
  const ramped = encodeMidi(compileDoc({ play: ['c ~ ~ ~', { set: 'tempo 60 over 1' }, 'c ~ ~ ~'] }));
  const countTempo = (b: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < b.length - 2; i++) if (b[i] === 0xff && b[i + 1] === 0x51) n++;
    return n;
  };
  assert.strictEqual(countTempo(plain), 1);
  assert.strictEqual(countTempo(ramped), 17); // initial + 16 ramp steps
});
check('exported .mid carries control changes', () => {
  const buf = encodeMidi(compileDoc({ play: ['c ~ ~ ~', { set: 'cc74 30' }, 'c ~ ~ ~'] }));
  let found = false;
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0xb0 && buf[i + 1] === 74 && buf[i + 2] === 30) found = true;
  }
  assert.ok(found, 'expected a CC74=30 message in the file');
});

console.log('\nmusical terms:');
check('dynamic marks set velocity (pianissimo, mezzoforte, fortissimo)', () => {
  const tl = parsePlay(['c ~ ~ ~', { set: 'pianissimo' }, 'c ~ ~ ~', { set: 'fortissimo' }, 'c ~ ~ ~']);
  assert.deepStrictEqual(tl.map((n) => n.velocity), [90, 32, 112]);
});
check('spelled-out and plain-english dynamics', () => {
  assert.strictEqual(parsePlay(['c', { set: 'forte' }, 'c'])[1].velocity, 96);
  assert.strictEqual(parsePlay(['c', { set: 'quiet' }, 'c'])[1].velocity, 48);
});
check('louder / softer step relative to the current dynamic', () => {
  const tl = parsePlay(['c ~ ~ ~', { set: 'mezzopiano' }, 'c ~ ~ ~', { set: 'louder' }, 'c ~ ~ ~',
    { set: 'softer, softer' }, 'c ~ ~ ~']);
  assert.deepStrictEqual(tl.map((n) => n.velocity), [90, 64, 80, 48]);
});
check('a bare "forte" sets forte velocity, f major sets scale', () => {
  assert.strictEqual(parseSet('forte').velocity, 96);
  assert.strictEqual(parseSet('f major').scale, 'f major');
});
check('velocityRange remaps the marks into a band, keeping their order', () => {
  const play = ['c ~ ~ ~', { set: 'pianissimo' }, 'c ~ ~ ~', { set: 'fortissimo' }, 'c ~ ~ ~'];
  const plain = parsePlay(play).map((n) => n.velocity);
  assert.deepStrictEqual(plain, [90, 32, 112]);
  // The whole 0..127 domain lands inside the band, so nothing escapes it and
  // the written dynamics keep their relative order.
  const rank = (vs: number[]) => [...vs].sort((a, b) => a - b).map((v) => vs.indexOf(v));
  const band = parsePlay(play, { velocityRange: [56, 127] }).map((n) => n.velocity);
  assert.ok(Math.min(...band) >= 56 && Math.max(...band) <= 127);
  assert.deepStrictEqual(rank(band), rank(plain));
  assert.ok(band[1] > plain[1], 'the pianissimo was lifted into the band');
  // A single number is a ceiling, and the curve form is honoured, both as
  // they are for a control `range:`.
  const ceiling = parsePlay(play, { velocityRange: 64 }).map((n) => n.velocity);
  assert.ok(Math.max(...ceiling) <= 64);
  assert.deepStrictEqual(rank(ceiling), rank(plain));
  assert.strictEqual(parsePlay(['c'], { velocity: 127, velocityRange: [0, 10, 100] })[0].velocity, 100);
});
check('velocityRange survives the track/section merge', () => {
  const song = compileDoc({
    tracks: { lead: { velocityRange: [56, 127] } },
    sections: { a: { lead: { play: ['c ~ ~ ~', { set: 'pianissimo' }, 'c ~ ~ ~'] } } },
  });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.velocity), [106, 74]);
});
check('articulation words: staccato, tenuto, smooth', () => {
  const tl = parsePlay(['c', { set: 'staccato' }, 'c', { set: 'tenuto' }, 'c', { set: 'smooth' }, 'c']);
  assert.deepStrictEqual(tl.map((n) => n.duration), [3.6, 1.6, 3.92, 4.2]);
});
check('character marks expand to dynamic + articulation', () => {
  const [plain, dolce] = parsePlay(['c ~ ~ ~', { set: 'dolce' }, 'c ~ ~ ~']);
  assert.strictEqual(plain.velocity, 90);
  assert.strictEqual(dolce.velocity, 56);
  assert.ok(dolce.duration > plain.duration, 'dolce is more connected');
});
check('tempo marks: allegro, adagio', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', { set: 'allegro' }, 'c ~ ~ ~', { set: 'adagio' }, 'c ~ ~ ~'] });
  assert.deepStrictEqual(song.tempoMap.map((t) => [t.time, t.bpm]), [[4, 132], [8, 66]]);
});
check('ritardando / accelerando ramp relative to the running tempo', () => {
  const song = compileDoc({
    tempo: 100,
    play: ['c ~ ~ ~', { set: 'ritardando over 2' }, 'c ~ ~ ~'],
  });
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 80, rampBeats: 8 }]);
});
check('"rit." with a trailing dot, and plain-english slower/faster', () => {
  assert.strictEqual(parseSet('rit.').tempo?.scale, 0.8);
  assert.strictEqual(parseSet('slower').tempo?.scale, 0.9);
  assert.strictEqual(parseSet('faster').tempo?.scale, 1.1);
});
check('gradual tempo marks take a target: "allargando to adagio over 3"', () => {
  const song = compileDoc({
    tempo: 100,
    play: ['c ~ ~ ~', { set: 'allargando to adagio over 3' }, 'c ~ ~ ~'],
  });
  assert.strictEqual(parseSet('rit to 60 over 2').tempo?.bpm, 60);
  assert.strictEqual(parseSet('ritardando over 2 to 54').tempo?.bpm, 54);
  assert.strictEqual(parseSet('ritardando over 2 to 54').tempo?.overMeasures, 2);
  assert.strictEqual(parseSet('cresc. over 2 to forte').velocityRamp?.to, 96);
  assert.strictEqual(parseSet('cresc. over 2 to forte').velocityRamp?.overMeasures, 2);
});
check('"a tempo" returns to the tempo the track started at', () => {
  const song = compileDoc({
    tempo: 77,
    play: ['c ~ ~ ~', { set: 'allegro' }, 'c ~ ~ ~', { set: 'a tempo' }, 'c ~ ~ ~'],
  });
  assert.deepStrictEqual(song.tempoMap.map((t) => t.bpm), [132, 77]);
});
check('crescendo interpolates velocity across its span', () => {
  const tl = parsePlay(['c c c c', { set: 'piano, crescendo to forte over 1' }, 'c c c c', 'c ~ ~ ~']);
  const during = tl.slice(4, 8).map((n) => n.velocity);
  assert.strictEqual(during[0], 48); // starts at piano
  assert.ok(during[1] > during[0] && during[2] > during[1], `rising: ${during}`);
  assert.strictEqual(tl[8].velocity, 96); // lands on forte and stays
});
check('dynamic: and articulation: props are the worded velocity/gate', () => {
  const song = compileDoc({ dynamic: 'pianissimo', articulation: 'staccato', play: 'c ~ ~ ~' });
  assert.strictEqual(song.tracks[0].timeline[0].velocity, 32);
  assert.strictEqual(song.tracks[0].timeline[0].duration, 0.4);
});
check('a character mark as dynamic: sets both, and children inherit', () => {
  const song = compileDoc({ dynamic: 'dolce', tracks: { a: { play: 'c ~ ~ ~' } } });
  assert.strictEqual(song.tracks[0].timeline[0].velocity, 56);
  assert.ok(song.tracks[0].timeline[0].duration > 1);
});
check('diminuendo without a target simply fades', () => {
  const tl = parsePlay(['c c c c', { set: 'diminuendo over 1' }, 'c c c c']);
  assert.ok(tl[7].velocity < tl[4].velocity, 'fading');
});

console.log('\nbare expression marks:');
check('a bare string of expression words is a mark, not a measure', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', 'legato', 'c ~ ~ ~'] });
  assert.strictEqual(song.lengthBeats, 8); // the mark took no time
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => [n.time, n.duration]),
    [[0, 0.9], [4, 1.05]]);
});
check('multi-clause marks work bare too', () => {
  const song = compileDoc({
    tempo: 100,
    play: ['c ~ ~ ~', 'fortissimo, sul ponticello, allargando to adagio over 2', 'c ~ ~ ~'],
  });
  assert.strictEqual(song.tracks[0].timeline[1].velocity, 112);
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 66, rampBeats: 8 }]);
  assert.deepStrictEqual(song.tracks[0].controls, [{ time: 4, cc: 74, value: 114 }]);
});
check('a measure wins any tie: "f" is the note, not forte', () => {
  const song = compileDoc({ play: ['f'] });
  assert.strictEqual(song.tracks[0].timeline.length, 1);
  assert.strictEqual(song.tracks[0].timeline[0].pitch, 'F4');
  assert.strictEqual(song.lengthBeats, 4);
});
check('marks do not shift the numbering of later measures', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', 'legato', { 3: 'e ~ ~ ~' }] });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [0, 8]);
});
check('gibberish is still treated as a measure, not a mark', () => {
  const song = compileDoc({ play: ['c ~ ~ ~', 'xyzzy plugh', 'c ~ ~ ~'] });
  assert.strictEqual(song.lengthBeats, 12); // three measures, the middle silent
});

console.log('\nnumbered measures:');
check('numbered keys place measures at their slot', () => {
  const song = compileDoc({ play: [{ 1: 'c ~ ~ ~' }, { 2: 'e ~ ~ ~' }] });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => [n.time, n.midi]), [[0, 60], [4, 64]]);
});
check('gaps in numbering become silence', () => {
  const song = compileDoc({ play: [{ 1: 'c ~ ~ ~' }, { 4: 'e ~ ~ ~' }] });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [0, 12]);
  assert.strictEqual(song.lengthBeats, 16);
});
check('plain strings continue after a numbered measure', () => {
  const song = compileDoc({ play: [{ 3: 'c ~ ~ ~' }, 'e ~ ~ ~'] });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [8, 12]);
});
check('set items interleave with numbered measures', () => {
  const song = compileDoc({
    scale: 'g major', octave: 2,
    play: [{ 1: '1 ~ ~ ~' }, { set: 'd maj' }, { 2: '1 ~ ~ ~' }],
  });
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.midi), [43, 38]);
});
check('numbered measures parse from yaml', () => {
  const doc = parseYaml('play:\n  - 1: "c d e d"\n  - 2: "e d c ~"\n');
  assert.strictEqual(compileDoc(doc).tracks[0].timeline.length, 7);
});

console.log('\ncompileDoc:');
check('minimal doc: root play with defaults (Twinkle)', () => {
  const song = compileDoc({
    play: ['c c g g', 'a a g ~', 'f f e e', 'd d c ~'],
  });
  assert.strictEqual(song.bpm, DEFAULT_TEMPO);
  assert.strictEqual(song.tracks.length, 1);
  assert.strictEqual(song.tracks[0].name, 'main');
  assert.strictEqual(song.tracks[0].sample, DEFAULT_SAMPLE);
  assert.strictEqual(song.tracks[0].timeline.length, 14);
  assert.strictEqual(song.lengthBeats, 16);
});
check('children inherit every prop except play, and can override', () => {
  const song = compileDoc({
    tempo: 100,
    measure: '3/4',
    sample: 'strings',
    octave: 3,
    tracks: {
      melody: { play: 'c d e' },
      bassline: { sample: 'bass', octave: 2, play: 'c ~ ~' },
    },
  });
  assert.strictEqual(song.bpm, 100);
  assert.deepStrictEqual(song.tracks.map((t) => t.name), ['melody', 'bassline']);
  assert.strictEqual(song.tracks[0].sample, 'strings');
  assert.strictEqual(song.tracks[0].timeline[0].midi, 48); // c3 inherited octave
  assert.strictEqual(song.tracks[1].sample, 'bass');
  assert.strictEqual(song.tracks[1].timeline[0].midi, 36); // c2 overridden octave
  assert.strictEqual(song.measureBeats, 3);
});
check('root can play alongside its children', () => {
  const song = compileDoc({ play: 'c ~ ~ ~', tracks: { child: { play: 'e ~ ~ ~' } } });
  assert.deepStrictEqual(song.tracks.map((t) => t.name), ['main', 'child']);
});
check('nested children inherit through the chain', () => {
  const song = compileDoc({
    sample: 'flute',
    tracks: { a: { octave: 5, tracks: { b: { play: 'c' } } } },
  });
  assert.strictEqual(song.tracks[0].name, 'b');
  assert.strictEqual(song.tracks[0].sample, 'flute');
  assert.strictEqual(song.tracks[0].timeline[0].midi, 72); // c5 via parent chain
});
check('channels auto-assign but explicit ones win', () => {
  const song = compileDoc({
    tracks: { a: { play: 'c' }, b: { channel: 10, play: 'c' }, c: { play: 'c' } },
  });
  assert.deepStrictEqual(song.tracks.map((t) => t.channel), [1, 10, 2]);
});
check('sample maps to a GM program for export', () => {
  const song = compileDoc({ sample: 'bass', play: 'c' });
  assert.strictEqual(song.tracks[0].program, 33);
});
check('empty doc throws', () => {
  assert.throws(() => compileDoc({}), /nothing to play/);
});

console.log('\nyaml:');
check('nested tracks parse', () => {
  const doc = parseYaml('tempo: 90\ntracks:\n  melody:\n    sample: piano\n    play: "c d e d"\n');
  assert.strictEqual(doc.tempo, 90);
  assert.strictEqual(doc.tracks.melody.sample, 'piano');
});
check('inline flow maps parse, measure strings do not', () => {
  const doc = parseYaml('controls: { bow: 74, pressure: 71 }\nplay:\n  - "{1 2 3 4}"\n');
  assert.deepStrictEqual(doc.controls, { bow: 74, pressure: 71 });
  assert.strictEqual(doc.play[0], '{1 2 3 4}');
  assert.strictEqual(parseYaml('a: {1 2 3 4}\n').a, '{1 2 3 4}');
});
check('block scalar play: | with one measure per line', () => {
  const doc = parseYaml('play: |\n  c c g g\n  a a g ~\n');
  assert.strictEqual(doc.play, 'c c g g\na a g ~');
  assert.strictEqual(compileDoc(doc).tracks[0].timeline.length, 7);
});

console.log('\nexporter:');
check('single track → format 0 SMF', () => {
  const buf = encodeMidi(compileDoc({ play: 'c d e d' }));
  assert.deepStrictEqual([...buf.slice(0, 4)], [0x4d, 0x54, 0x68, 0x64]);
  assert.strictEqual(buf[9], 0); // format 0
});
check('multitrack → format 1 with conductor', () => {
  const buf = encodeMidi(compileDoc({ tracks: { a: { play: 'c' }, b: { play: 'e' } } }));
  assert.strictEqual(buf[9], 1); // format 1
  assert.strictEqual((buf[10] << 8) | buf[11], 3); // conductor + 2 tracks
});

console.log('\naccents:');
check('`>` raises one note\'s velocity by 16, stackable', () => {
  const tl = parsePlay('1 2> 3>> 4', { velocity: 80 });
  assert.deepStrictEqual(tl.map((n) => n.velocity), [80, 96, 112, 80]);
});
check('an accent on a chord lifts every member', () => {
  const tl = parsePlay('[c e g]> ~ ~ ~', { velocity: 80 });
  assert.deepStrictEqual(tl.map((n) => n.velocity), [96, 96, 96]);
});
check('accents work inside groups and clamp at 127', () => {
  const tl = parsePlay('{c d>} ~ ~ ~', { velocity: 120 });
  assert.deepStrictEqual(tl.map((n) => n.velocity), [120, 127]);
});
check('an accented-note line is still a measure, not a directive', () => {
  const song = compileDoc({ play: ['c> d e d'] });
  assert.strictEqual(song.tracks[0].timeline.length, 4);
});

console.log('\nmeter changes:');
check('a 2/4 bar inside 4/4 takes two beats', () => {
  const { timeline, lengthBeats } = parsePlayFull([
    'c d e d',
    { set: '2/4' },
    'g g',
    { set: '4/4' },
    'c d e d',
  ]);
  assert.deepStrictEqual(times(timeline), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(lengthBeats, 10);
});
check('`measure:` directive key works like the set clause', () => {
  const { timeline } = parsePlayFull(['c d e d', { measure: '2/4' }, 'g g', 'c c']);
  assert.deepStrictEqual(times(timeline), [0, 1, 2, 3, 4, 5, 6, 7]);
});
check('lengthBeats honours meter changes through compileDoc', () => {
  const song = compileDoc({ play: ['c d e d', { set: '2/4' }, 'g g'] });
  assert.strictEqual(song.lengthBeats, 6);
});

console.log('\nrelative tempo words:');
check('più lento drops the running tempo at once', () => {
  const { tempos } = parsePlayFull(['c d e d', { set: 'più lento' }, 'c d e d'], { tempo: 100 });
  assert.strictEqual(tempos.length, 1);
  assert.strictEqual(tempos[0].bpm, 75);
  assert.strictEqual(tempos[0].rampBeats, 0);
});
check('meno mosso slows, più mosso quickens, with or without the accent', () => {
  assert.ok(parseSet('meno mosso').tempo!.scale! < 1);
  assert.ok(parseSet('più mosso').tempo!.scale! > 1);
  assert.deepStrictEqual(parseSet('piu mosso'), parseSet('più mosso'));
});

console.log('\nstring techniques:');
check('`<` softens a note, the dual of the accent', () => {
  const tl = parsePlay('1 2< 3<< 4', { velocity: 80 });
  assert.deepStrictEqual(tl.map((n) => n.velocity), [80, 64, 48, 80]);
});
check('pizzicato / col legno / tremolo / sordino need a mapped control', () => {
  assert.throws(() => parseSet('pizzicato'), /needs a "playmode" control/);
  const patch = parseSet('pizzicato', { playmode: 20 });
  assert.deepStrictEqual(patch.ccs, [{ cc: 20, value: 64 }]);
  assert.deepStrictEqual(parseSet('col legno', { playmode: 20 }).ccs, [{ cc: 20, value: 127 }]);
  assert.deepStrictEqual(parseSet('tremolo fast', { tremolo: 21 }).ccs, [{ cc: 21, value: 127 }]);
  assert.deepStrictEqual(parseSet('con sordino', { sordino: 22 }).ccs, [{ cc: 22, value: 127 }]);
});
check('a declared-control clause in a bare string is a directive, not a measure', () => {
  // 'polyphony' is only known to the track's controls, not the classifier —
  // the line must still classify as a directive and emit the CC.
  const { timeline, controls } = parsePlayFull(
    ['arco, polyphony 64', '1 2 3 4'],
    { controls: { playmode: 20, polyphony: 26 } },
  );
  assert.strictEqual(timeline.length, 4); // no phantom silent measure or "64" note
  assert.deepStrictEqual(controls.map((c) => c.cc).sort(), [20, 26]);
});
check('an unmapped technique word is still a directive, not a measure', () => {
  // classification is lenient; compilation stays strict and explains itself
  assert.throws(
    () => parsePlayFull(['c d e d', 'pizzicato', 'c d e d']),
    /needs a "playmode" control/,
  );
});
check('left-hand fingering words drive the fingering control', () => {
  assert.deepStrictEqual(parseSet('open strings', { fingering: 25 }).ccs, [{ cc: 25, value: 127 }]);
  assert.deepStrictEqual(parseSet('mid position', { fingering: 25 }).ccs, [{ cc: 25, value: 0 }]);
});
check('martelé and spiccato read as articulation words', () => {
  // Both are off-the-string strokes: shorter than the default gate, and
  // martelé is a hammered, louder one.
  assert.ok(parseSet('spiccato').gate! < DEFAULT_GATE);
  const m = parseSet('martelé');
  assert.ok(m.gate! < DEFAULT_GATE);
  assert.ok(m.velocity! > DEFAULT_VELOCITY);
});
check('declared expression control mirrors dynamics as CCs', () => {
  const { controls } = parsePlayFull(
    ['1 2 3 4', { set: 'fortissimo' }, '1 2 3 4'],
    { velocity: 64, controls: { expression: 11 } },
  );
  assert.deepStrictEqual(controls[0], { time: 0, cc: 11, value: 64 }); // opening
  assert.deepStrictEqual(controls[1], { time: 4, cc: 11, value: 112 });
});
check('a crescendo becomes an expression ramp at eighth-note steps', () => {
  const { controls } = parsePlayFull(
    ['1 2 3 4', { set: 'crescendo to fortissimo over 1' }, '1 2 3 4'],
    { velocity: 64, controls: { expression: 11 } },
  );
  const ramp = controls.filter((c) => c.time > 4 && c.time <= 8);
  assert.strictEqual(ramp.length, 8); // 4 beats × 2 per beat
  assert.strictEqual(ramp[ramp.length - 1].value, 112);
  assert.ok(ramp[0].value > 64 && ramp[0].value < 112);
});
check('without a declared expression control no CCs are emitted', () => {
  const { controls } = parsePlayFull(['1 2 3 4', { set: 'fortissimo' }, '1 2 3 4'], { velocity: 64 });
  assert.deepStrictEqual(controls, []);
});

console.log('\nrepeated-note legato:');
check('a same-pitch restrike trims the earlier note instead of being cut', () => {
  const tl = parsePlay('c c d d', { gate: 1.05 });
  assert.strictEqual(tl[0].duration, 0.98); // released just before the restrike
  assert.strictEqual(tl[1].duration, 1.05); // c→d overlap kept: cross-pitch slur
  assert.strictEqual(tl[2].duration, 0.98);
});
check('different pitches keep their legato overlap untouched', () => {
  const tl = parsePlay('c d e f', { gate: 1.05 });
  assert.ok(tl.every((n) => n.duration === 1.05));
});

console.log('\nstrum (rolled chords):');
check('`[c e g]~` rolls in written order, ending together', () => {
  const tl = parsePlay('[c e g]~ ~ ~ ~');
  assert.deepStrictEqual(times(tl), [0, 0.03, 0.06]);
  assert.deepStrictEqual(midis(tl), [60, 64, 67]); // written order = bass first
  const ends = tl.map((n) => n.time + n.duration);
  assert.ok(Math.max(...ends) - Math.min(...ends) < 0.01);
});
check('written order controls direction — a down-strum', () => {
  const tl = parsePlay('[g e c]~ ~ ~ ~');
  assert.deepStrictEqual(midis(tl), [67, 64, 60]); // treble speaks first
  assert.deepStrictEqual(times(tl), [0, 0.03, 0.06]);
});
check('`~~` doubles the spread; `strum` prop/set retunes it', () => {
  assert.deepStrictEqual(times(parsePlay('[c e g]~~ ~ ~ ~')), [0, 0.06, 0.12]);
  assert.deepStrictEqual(times(parsePlay('[c e g]~ ~ ~ ~', { strum: 0.1 })), [0, 0.1, 0.2]);
  const { timeline } = parsePlayFull([{ set: 'strum 0.05' }, '[c e g]~ ~ ~ ~']);
  assert.deepStrictEqual(times(timeline), [0, 0.05, 0.1]);
});
check('the roll clamps inside fast subdivisions', () => {
  const tl = parsePlay('{[c e g]~ c c c} c c c', { strum: 0.5 });
  const chord = tl.slice(0, 3);
  assert.ok(chord[2].time <= 0.25 * 0.6 + 1e-9); // ≤ 60% of a 16th slot
});
check('voices 2 breaks a rolled triple stop like a bow would', () => {
  const tl = parsePlay('[c e g]~ _ _ _', { voices: 2 });
  // the bass is short — released once the top note has landed…
  assert.ok(tl[0].duration < 0.5);
  // …but overlaps the note that displaces it long enough for a
  // string-crossing model to voice them on separate strings.
  const overlap = tl[0].time + tl[0].duration - tl[2].time;
  assert.ok(overlap >= 0.08, `overlap ${overlap}`);
  // The top pair sustains, and the following holds extend only them.
  assert.ok(tl[1].duration > 3);
  assert.ok(tl[2].duration > 3);
});
check('`tail` overrides the release: negative ends before the displacer', () => {
  const tl = parsePlay('[c e g]~ _ _ _', { voices: 2, strum: 0.15, strumTail: -0.02 });
  const bassEnd = tl[0].time + tl[0].duration;
  assert.ok(bassEnd < tl[2].time, `bass ends ${bassEnd} before top at ${tl[2].time}`);
  assert.strictEqual(parseSet('tail -0.02').strumTail, -0.02);
  assert.strictEqual(parseSet('tail 0.3').strumTail, 0.3);
});
check('voices only applies to rolled chords; `voices all` clears it', () => {
  const tl = parsePlay('[c e g] ~ ~ ~', { voices: 2 });
  assert.ok(tl.every((n) => n.duration === 0.9)); // unrolled chord untouched
  assert.strictEqual(parseSet('voices 2').voices, 2);
  assert.strictEqual(parseSet('voices all').voices, 0);
});
check('strum combines with an accent: `[c e]>~`', () => {
  const tl = parsePlay('[c e]>~ ~ ~ ~', { velocity: 80 });
  assert.deepStrictEqual(times(tl), [0, 0.03]);
  assert.deepStrictEqual(tl.map((n) => n.velocity), [96, 96]);
});

console.log('\ncontrol drifts:');
check('a technique word with a span glides from the last value', () => {
  const { controls } = parsePlayFull(
    ['sul tasto', '1 2 3 4', 'sul ponticello over 2', '1 2 3 4', '1 2 3 4'],
    {},
  );
  // sul tasto: one CC74=0 at beat 0; then 16 steps (8 beats × 2) rising to 114
  assert.deepStrictEqual(controls[0], { time: 0, cc: 74, value: 0 });
  const ramp = controls.slice(1);
  assert.strictEqual(ramp.length, 16);
  assert.strictEqual(ramp[ramp.length - 1].value, 114); // sul ponticello = 0.9
  assert.ok(ramp[0].value > 0 && ramp[0].value < 114);
  assert.strictEqual(ramp[ramp.length - 1].time, 12);
});
check('named control drift: "bow to 110 over 1"', () => {
  const { controls } = parsePlayFull(
    [{ set: 'bow 20' }, '1 2 3 4', { set: 'bow to 110 over 1' }, '1 2 3 4'],
    {},
  );
  const ramp = controls.filter((c) => c.time > 4);
  assert.strictEqual(ramp.length, 8);
  assert.strictEqual(ramp[7].value, 110);
});
check('a drift with no prior value lands immediately at the target', () => {
  const { controls } = parsePlayFull([{ set: 'vibrato over 2' }, '1 2 3 4', '1 2 3 4'], {});
  assert.ok(controls.every((c) => c.value === 76)); // vibrato = 0.6 of 0..127
});

console.log('\nyaml anchors (repeats):');
check('&anchor / *alias replays a measure', () => {
  const doc = parseYaml('play:\n  - &theme "c d e d"\n  - "g g g g"\n  - *theme\n');
  assert.strictEqual(doc.play[2], 'c d e d');
  assert.strictEqual(compileDoc(doc).tracks[0].timeline.length, 12);
});
check('anchors work on numbered measures', () => {
  const doc = parseYaml('play:\n  - 1: &a "c d e d"\n  - 2: *a\n');
  assert.strictEqual((doc.play[1] as any)[2], 'c d e d');
});
check('an unknown alias throws', () => {
  assert.throws(() => parseYaml('play:\n  - *nope\n'), /no &nope anchor/);
});

console.log('\nset patches on tracks and directives:');
check('a track-level set: applies its tempo, meter and relative dynamic to the track', () => {
  const song = compileDoc({ set: 'allegro, louder', play: 'c d e d' });
  assert.strictEqual(song.bpm, 132);
  assert.strictEqual(song.tracks[0].timeline[0].velocity, 106);
  const meter = compileDoc({ tracks: { a: { set: '3/4', play: 'c d e' } } });
  assert.strictEqual(meter.tracks[0].timeline[2].time, 2);
  assert.strictEqual(meter.lengthBeats, 3);
});
check('track-level set: applies strum, voices and tail', () => {
  const song = compileDoc({ set: 'strum 0.05, voices 2, tail -0.02', play: '[c e g]~ _ _ _' });
  const tl = song.tracks[0].timeline;
  assert.deepStrictEqual(tl.map((n) => n.time), [0, 0.05, 0.1]);
  const bassEnd = tl[0].time + tl[0].duration;
  assert.ok(bassEnd < tl[2].time, 'negative tail releases the bass before the top lands');
});
check('a tempo: directive updates the running tempo for later rits', () => {
  const song = compileDoc({
    tempo: 120,
    play: ['c ~ ~ ~', { tempo: 90 }, 'c ~ ~ ~', { set: 'ritardando over 1' }, 'c ~ ~ ~'],
  });
  // The rit must ramp from 90 (the directive), not from the stale 120.
  assert.deepStrictEqual(song.tempoMap.map((t) => t.bpm), [90, 72]);
});
check('a velocity: directive cancels an in-flight hairpin', () => {
  const tl = parsePlay(['c c c c', { set: 'piano, crescendo to forte over 2' }, 'c c c c',
    { velocity: 40 }, 'c c c c']);
  assert.ok(tl.slice(8).every((n) => n.velocity === 40));
});

console.log('\ndrums (kit tracks):');
check('kit tracks read drum names and land on channel 10, no program', () => {
  const song = compileDoc({ kit: 'acoustic', play: 'bd hh sd hh' });
  const t = song.tracks[0];
  assert.deepStrictEqual(t.timeline.map((n) => n.midi), [36, 42, 38, 42]);
  assert.deepStrictEqual(t.timeline.map((n) => n.pitch), ['bd', 'hh', 'sd', 'hh']);
  assert.strictEqual(t.channel, 10);
  assert.strictEqual(t.program, undefined);
  assert.strictEqual(t.kit, 'acoustic');
});
check('longhand aliases and raw GM numbers work', () => {
  const tl = parsePlay('kick snare clap 46', { kit: 'acoustic' });
  assert.deepStrictEqual(tl.map((n) => n.midi), [36, 38, 39, 46]);
  assert.strictEqual(tl[3].pitch, 'oh'); // raw 46 names itself back
});
check('unknown drum words are rests; pitch names do not leak in', () => {
  // "cb" is the cowbell in a kit track, never C-flat.
  const tl = parsePlay('bd xyz cb ~', { kit: 'acoustic' });
  assert.deepStrictEqual(tl.map((n) => n.midi), [36, 56]);
});
check('kit inherits to children; explicit channel wins', () => {
  const song = compileDoc({
    kit: 'acoustic',
    tracks: { groove: { play: 'bd ~ sd ~' }, aux: { channel: 11, play: 'cb cb cb cb' } },
  });
  assert.deepStrictEqual(song.tracks.map((t) => t.channel), [10, 11]);
  assert.strictEqual(song.tracks[1].kit, 'acoustic');
});
check('melodic auto-channels skip 10', () => {
  const song = compileDoc({
    tracks: Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`t${i}`, { play: 'c' }]),
    ),
  });
  assert.ok(!song.tracks.some((t) => t.channel === 10));
  assert.strictEqual(song.tracks[10].channel, 12); // 1..9, then 11, 12
});
check('accents, groups and chords compose with drum tokens', () => {
  const tl = parsePlay('bd> {hh hh} [bd sd] hh<', { kit: 'acoustic', velocity: 80 });
  assert.deepStrictEqual(tl.map((n) => [n.midi, n.velocity]), [
    [36, 96], [42, 80], [42, 80], [36, 80], [38, 80], [42, 64],
  ]);
  assert.deepStrictEqual(times(tl), [0, 1, 1.5, 2, 2, 3]);
});
check('`sd~` rolls: retriggers fill the slot and swell', () => {
  const tl = parsePlay('sd~ ~ ~ ~', { kit: 'acoustic' });
  assert.strictEqual(tl.length, 8); // one beat at 32nds
  assert.ok(tl.every((n) => n.midi === 38));
  assert.ok(tl[7].velocity > tl[0].velocity, 'crescendo into the landing');
  assert.strictEqual(tl[7].velocity, 90); // lands on the running dynamic
});
check('`~~` doubles the roll speed; a flam via `[sd sd]~`', () => {
  assert.strictEqual(parsePlay('sd~~ ~ ~ ~', { kit: 'acoustic' }).length, 16);
  const flam = parsePlay('[sd sd]~ ~ ~ ~', { kit: 'acoustic' });
  assert.strictEqual(flam.length, 2);
  assert.ok(flam[1].time - flam[0].time > 0 && flam[1].time - flam[0].time < 0.1);
});
check('`_` extends a hit; dynamics words still apply', () => {
  const song = compileDoc({ kit: 'acoustic', play: ['cy _ _ _', 'pianissimo', 'bd ~ ~ ~'] });
  const tl = song.tracks[0].timeline;
  assert.strictEqual(tl[0].duration, 3.6); // crash rings through the holds
  assert.strictEqual(tl[1].velocity, 32); // pianissimo applied to bd
  assert.strictEqual(song.lengthBeats, 8);
});
check('a drum measure is a measure, not a directive', () => {
  const song = compileDoc({ kit: '808', play: ['bd hh sd hh', 'bd hh sd oh'] });
  assert.strictEqual(song.lengthBeats, 8);
});
check('kit: 808 as a bare YAML number normalizes to a string', () => {
  const song = compileDoc(parseYaml('kit: 808\nplay: "bd ~ sd ~"\n'));
  assert.strictEqual(song.tracks[0].kit, '808');
  assert.strictEqual(song.tracks[0].channel, 10);
});

console.log('\nduration weights (`.` and `:` suffixes):');
check('`:` doubles a note\'s share: "c: d c" is half + two quarters', () => {
  const tl = parsePlay('c: d c');
  assert.deepStrictEqual(times(tl), [0, 2, 3]);
  assert.deepStrictEqual(tl.map((n) => n.duration), [1.8, 0.9, 0.9]);
});
check('`.` is a dot (×1.5); suffixes stack and combine: `c:.` = 3 beats', () => {
  const tl = parsePlay('c:. d');
  assert.deepStrictEqual(times(tl), [0, 3]);
  assert.deepStrictEqual(tl.map((n) => n.duration), [2.7, 0.9]);
  const stacked = parsePlay('c:: e', { measure: 5 });
  assert.deepStrictEqual(times(stacked), [0, 4]); // 4+1 weights in 5 beats
});
check('dotted pairs in other meters: "c. d." fills 3/4 evenly', () => {
  const tl = parsePlay('c. d.', { measure: '3/4' });
  assert.deepStrictEqual(times(tl), [0, 1.5]);
});
check('weights work inside groups', () => {
  const tl = parsePlay('{c: d} e ~ ~');
  assert.deepStrictEqual(times(tl), [0, 0.666667, 1]);
});
check('rests and holds take weights too', () => {
  const rested = parsePlay('c ~: d');
  assert.deepStrictEqual(times(rested), [0, 3]);
  const held = parsePlay('c _: d');
  assert.strictEqual(held[0].duration, 2.7); // c prolonged through the double hold
  assert.strictEqual(held[1].time, 3);
});
check('duration weights combine with accents and rolls', () => {
  const tl = parsePlay('[c e]:>~ d d', { velocity: 80 });
  assert.deepStrictEqual(times(tl), [0, 0.03, 2, 3]);
  assert.ok(tl[0].velocity === 96 && tl[1].velocity === 96);
});

console.log('\nsections:');
check('sections play in order; parallel tracks align; absent tracks rest', () => {
  const song = compileDoc({
    tracks: { bass: { sample: 'bass' } },
    sections: {
      intro: { loop: false, lead: { play: ['c ~ ~ ~'] } },
      groove: { loop: false, lead: { play: ['e ~ ~ ~'] }, bass: { play: ['g2 ~ ~ ~'] } },
    },
  } as any);
  const lead = song.tracks.find((t) => t.name === 'lead')!;
  const bass = song.tracks.find((t) => t.name === 'bass')!;
  assert.deepStrictEqual(lead.timeline.map((n) => n.time), [0, 4]);
  assert.deepStrictEqual(bass.timeline.map((n) => n.time), [4]); // silent through the intro
  assert.strictEqual(song.lengthBeats, 8);
  assert.strictEqual(song.loopStartBeats, undefined);
});
check('top-level tracks declare the instrument; sections carry the music', () => {
  const song = compileDoc({
    tracks: { drums: { kit: 'acoustic' } },
    sections: { a: { loop: false, drums: { play: ['bd ~ sd ~'] } } },
  } as any);
  assert.strictEqual(song.tracks[0].kit, 'acoustic');
  assert.strictEqual(song.tracks[0].channel, 10);
});
check('section length is the longest track (waits included)', () => {
  const song = compileDoc({
    sections: {
      a: {
        loop: false,
        lead: { play: ['c ~ ~ ~', 'd ~ ~ ~'] },
        late: { wait: 3, play: ['e ~ ~ ~'] },
      },
      b: { loop: false, lead: { play: ['g ~ ~ ~'] } },
    },
  } as any);
  const late = song.tracks.find((t) => t.name === 'late')!;
  assert.deepStrictEqual(late.timeline.map((n) => n.time), [12]); // 3 bars wait
  // section a spans 4 bars (wait 3 + 1), so section b starts at bar 5
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [0, 4, 16]);
});
check('loop: N unrolls; the wait applies only to the first pass', () => {
  const song = compileDoc({
    sections: {
      riff: { loop: 2, lead: { wait: 1, play: ['c ~ ~ ~'] } },
      tail: { loop: false, lead: { play: ['g ~ ~ ~'] } },
    },
  } as any);
  // pass 1: wait 1 bar + play (bars 1-2); pass 2: no wait (bar 3); tail bar 4
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [4, 8, 12]);
  assert.strictEqual(song.loopStartBeats, undefined); // no forever loop declared
});
check('loop: 0 skips a section', () => {
  const song = compileDoc({
    sections: {
      muted: { loop: 0, lead: { play: ['c ~ ~ ~'] } },
      a: { loop: false, lead: { play: ['e ~ ~ ~'] } },
    },
  } as any);
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.midi), [64]);
  assert.strictEqual(song.lengthBeats, 4);
});
check('loop defaults to true: the tail cycles and sets loopStartBeats', () => {
  const song = compileDoc({
    sections: {
      intro: { loop: false, lead: { play: ['c ~ ~ ~'] } },
      theme: { lead: { play: ['e ~ ~ ~'] } },
      chorus: { lead: { play: ['g ~ ~ ~'] } },
    },
  } as any);
  assert.strictEqual(song.loopStartBeats, 4); // after the 1-bar intro
  assert.strictEqual(song.lengthBeats, 12);
});
check('a waited pickup into the loop plays once, before the loop point', () => {
  const song = compileDoc({
    sections: {
      theme: { lead: { wait: 1, play: ['c ~ ~ ~'] }, pad: { play: ['e ~ ~ ~', 'f ~ ~ ~'] } },
    },
  } as any);
  // pass 1 with waits (bars 1-2), then the clean pass (bars 3-4) that loops
  assert.strictEqual(song.loopStartBeats, 8);
  const lead = song.tracks.find((t) => t.name === 'lead')!;
  assert.deepStrictEqual(lead.timeline.map((n) => n.time), [4, 8]); // waited, then clean at loop start
  assert.strictEqual(song.lengthBeats, 16);
});
check('directives inside sections land at the section\'s bars', () => {
  const song = compileDoc({
    sections: {
      a: { loop: false, lead: { play: ['c ~ ~ ~'] } },
      b: { loop: false, lead: { velocity: 40, play: [{ set: 'tempo 60' }, 'e ~ ~ ~'] } },
    },
  } as any);
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.velocity), [90, 40]);
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 60, rampBeats: 0 }]);
});
check('sections misuse fails loud', () => {
  assert.throws(
    () => compileDoc({ play: 'c', sections: { a: { lead: { play: ['c'] } } } } as any),
    /not both/,
  );
  assert.throws(
    () => compileDoc({ tracks: { lead: { play: 'c' } }, sections: { a: { lead: { play: ['c'] } } } } as any),
    /instrument only/,
  );
  assert.throws(
    () => compileDoc({ sections: { a: { lead: { play: ['c'] } }, b: { loop: false, lead: { play: ['c'] } } } } as any),
    /forever-looping tail/,
  );
  assert.throws(
    () => compileDoc({ sections: { a: { loop: false, lead: { sample: 'bass', play: ['c'] } } } } as any),
    /declare it on the top-level track/,
  );
});
check('an Nx: item repeats measures inline', () => {
  const tl = parsePlay(['c ~ ~ ~', { '3x': 'd ~ ~ ~' }, 'e ~ ~ ~'] as any);
  assert.deepStrictEqual(tl.map((n) => [n.time, n.midi]),
    [[0, 60], [4, 62], [8, 62], [12, 62], [16, 64]]);
});
check('Nx: items take lists, nest, and 0x skips', () => {
  const tl = parsePlay([
    { '2x': [{ '2x': 'c ~ ~ ~' }, 'g ~ ~ ~'] },
    { '0x': 'b ~ ~ ~' },
  ] as any);
  assert.deepStrictEqual(tl.map((n) => n.midi), [60, 60, 67, 60, 60, 67]);
});
check('Nx: items parse from yaml and work inside sections', () => {
  const doc = parseYaml('sections:\n  a:\n    loop: false\n    lead:\n      play:\n        - 4x: "c ~ ~ ~"\n');
  const song = compileDoc(doc);
  assert.deepStrictEqual(song.tracks[0].timeline.map((n) => n.time), [0, 4, 8, 12]);
});
check('Nx: item misuse fails loud', () => {
  assert.throws(() => parsePlay([{ '2x': 'c', set: 'mf' }] as any), /can't mix/);
  assert.throws(() => parsePlay([{ '2x': null }] as any), /needs the measures/);
  assert.throws(() => parsePlay([{ '2x': [{ 3: 'c ~ ~ ~' }] }] as any), /Numbered measures/);
});

check('the exported .mid carries a loopStart marker', () => {
  const song = compileDoc({
    sections: {
      intro: { loop: false, lead: { play: ['c ~ ~ ~'] } },
      theme: { lead: { play: ['e ~ ~ ~'] } },
    },
  } as any);
  const buf = encodeMidi(song);
  const marker = [0xff, 0x06, 9, ...'loopStart'.split('').map((c) => c.charCodeAt(0))];
  let found = false;
  for (let i = 0; i < buf.length - marker.length; i++) {
    if (marker.every((b, j) => buf[i + j] === b)) found = true;
  }
  assert.ok(found, 'expected a loopStart marker meta event');
});

console.log('\nrubato (stolen time):');

check('rubato leaves the notes and the bar lines exactly where they were', () => {
  const strict = parsePlay(['c d e f', 'g a b c5']);
  const free = parsePlay(['c d e f', 'g a b c5'], { rubato: 0.6 });
  assert.deepStrictEqual(free.map((e) => e.midi), strict.map((e) => e.midi));
  // every downbeat is still a downbeat — what is stolen is paid back by the bar
  assert.strictEqual(free[0].time, 0);
  assert.strictEqual(free[4].time, 4);
});

check('rubato moves the notes inside the bar, and off it does nothing', () => {
  const strict = parsePlay(['c d e f']);
  const free = parsePlay(['c d e f'], { rubato: 0.6 });
  assert.ok(free.some((e, i) => e.time !== strict[i].time), 'expected the beat to breathe');
  // the note after the downbeat leans late; the bar catches up afterwards
  assert.ok(free[1].time > strict[1].time, 'expected a lean after the downbeat');
  assert.ok(free[3].time < strict[3].time, 'expected the bar to hurry home');
  assert.deepStrictEqual(parsePlay(['c d e f'], { rubato: 0 }), strict);
  assert.deepStrictEqual(parsePlay(['c d e f'], { rubato: undefined }), strict);
});

check('rubato never reorders notes, at any depth', () => {
  for (const rubato of [0.25, 0.5, 0.85, 1]) {
    const tl = parsePlay(['c d e f g a b c5'], { rubato });
    for (let i = 1; i < tl.length; i++) {
      assert.ok(tl[i].time > tl[i - 1].time, `depth ${rubato}: notes crossed`);
      assert.ok(tl[i].duration > 0, `depth ${rubato}: non-positive duration`);
    }
  }
});

check('rubato is deterministic — the same score compiles the same twice', () => {
  const once = parsePlay(['c d e f', 'g a b c5'], { rubato: 0.7 });
  const twice = parsePlay(['c d e f', 'g a b c5'], { rubato: 0.7 });
  assert.deepStrictEqual(once, twice);
});

check('the worded marks set rubato, and a battuta cancels it', () => {
  assert.strictEqual(parseSet('rubato').rubato, 0.5);
  assert.strictEqual(parseSet('molto rubato').rubato, 0.85);
  assert.strictEqual(parseSet('poco rubato').rubato, 0.25);
  assert.strictEqual(parseSet('rubato 0.4').rubato, 0.4);
  assert.strictEqual(parseSet('a battuta').rubato, 0);
  assert.strictEqual(parseSet('senza rubato').rubato, 0);
  assert.strictEqual(parseSet('rubato 5').rubato, 1); // clamped
});

check('rubato can be switched on and off mid-piece', () => {
  const tl = parsePlayFull(['c d e f', 'rubato', 'c d e f', 'a battuta', 'c d e f']).timeline;
  const bar = (n: number) => tl.filter((e) => e.time >= n * 4 && e.time < (n + 1) * 4);
  const offsets = (n: number) => bar(n).map((e) => Math.round((e.time - n * 4) * 1000) / 1000);
  assert.deepStrictEqual(offsets(0), [0, 1, 2, 3], 'bar 1 should be strict');
  assert.notDeepStrictEqual(offsets(1), [0, 1, 2, 3], 'bar 2 should breathe');
  assert.deepStrictEqual(offsets(2), [0, 1, 2, 3], 'bar 3 should be strict again');
});

console.log('\ntempo timing (beats → seconds):');
check('constant tempo is a straight line', () => {
  const segs = tempoSegments(120);
  assert.strictEqual(beatsToSeconds(segs, 0), 0);
  assert.strictEqual(beatsToSeconds(segs, 4), 2); // 120 bpm = 0.5 s per beat
});
check('an immediate change bends the line at its beat', () => {
  const segs = tempoSegments(120, [{ time: 4, bpm: 60, rampBeats: 0 }]);
  assert.strictEqual(beatsToSeconds(segs, 4), 2);
  assert.strictEqual(beatsToSeconds(segs, 6), 4); // 60 bpm after the change
});
check('a ramp lands between the flat extremes', () => {
  const ramped = tempoSegments(120, [{ time: 0, bpm: 60, rampBeats: 4 }]);
  const end = beatsToSeconds(ramped, 4);
  assert.ok(end > 2 && end < 4, `ramp end ${end} sits between all-120 (2s) and all-60 (4s)`);
  // After the ramp the new tempo holds.
  assert.ok(Math.abs(beatsToSeconds(ramped, 6) - (end + 2)) < 1e-9);
});
check('secondsToBeats undoes beatsToSeconds, ramps included', () => {
  const cases: TempoSegment[][] = [
    tempoSegments(120),
    tempoSegments(120, [{ time: 4, bpm: 60, rampBeats: 0 }]),
    tempoSegments(90, [{ time: 2, bpm: 54, rampBeats: 8 }, { time: 16, bpm: 120, rampBeats: 0 }]),
  ];
  for (const segs of cases) {
    for (const beat of [0, 0.5, 3, 4, 7.25, 16, 23.5]) {
      const back = secondsToBeats(segs, beatsToSeconds(segs, beat));
      assert.ok(Math.abs(back - beat) < 1e-9, `beat ${beat} round-tripped to ${back}`);
    }
  }
});
check('secondsToBeats floors at beat 0 before the song starts', () => {
  const segs = tempoSegments(120);
  assert.strictEqual(secondsToBeats(segs, 0), 0);
  assert.strictEqual(secondsToBeats(segs, -1), 0);
});

console.log('\ngenerators (spread / arp / walk):');
check('bjorklund places the canonical patterns', () => {
  const pat = (p: number, s: number, r = 0) =>
    bjorklund(p, s, r).map((hit) => (hit ? 'x' : '.')).join('');
  assert.strictEqual(pat(3, 8), 'x..x..x.');   // tresillo
  assert.strictEqual(pat(4, 4), 'xxxx');
  assert.strictEqual(pat(0, 8), '........');
  assert.strictEqual(pat(1, 8, 0), 'x.......');
  // Rotation advances the starting point of the same cycle.
  assert.strictEqual(pat(3, 8, 3), pat(3, 8).slice(3) + pat(3, 8).slice(0, 3));
});
check('spread expands layers to one measure, merging shared steps', () => {
  assert.strictEqual(expandSpread({ steps: 8, bd: 3 }), 'bd ~ ~ bd ~ ~ bd ~');
  assert.strictEqual(expandSpread({ steps: 4, bd: 4, hh: 4 }), '[bd hh] [bd hh] [bd hh] [bd hh]');
  assert.strictEqual(expandSpread({ steps: 8, oh: [1, 4] }), '~ ~ ~ ~ oh ~ ~ ~');
});
check('spread compiles inside a kit track', () => {
  const tl = parsePlay([{ spread: { steps: 8, bd: 3, hh: [2, 4] } }], { kit: 'standard' });
  assert.strictEqual(tl.length, 5); // 3 kicks + 2 hats
  assert.deepStrictEqual(times(tl.filter((e) => e.pitch === 'bd')), [0, 1.5, 3]);
});
check('spread works with degrees on melodic tracks', () => {
  const tl = parsePlay([{ spread: { steps: 8, 1: 3 } }]);
  assert.deepStrictEqual(midis(tl), [60, 60, 60]);
  assert.deepStrictEqual(times(tl), [0, 1.5, 3]);
});
check('spread validates its shape', () => {
  assert.throws(() => expandSpread({ steps: 8, bd: 9 }), /can't exceed steps/);
  assert.throws(() => expandSpread({ steps: 0, bd: 1 }), /steps/);
  assert.throws(() => expandSpread({ steps: 8 } as never), /at least one layer/);
});
check('arp orders chord tones by mode', () => {
  assert.strictEqual(expandArp({ chord: 'C', steps: 3 }), 'C4 E4 G4');
  assert.strictEqual(expandArp({ chord: 'Dm7', mode: 'down', steps: 4 }), 'C5 A4 F4 D4');
  assert.strictEqual(expandArp({ chord: 'C', mode: 'updown', steps: 4 }), 'C4 E4 G4 E4');
  assert.strictEqual(expandArp({ notes: ['d3', 'f3', 'a3', 'c4'], mode: 'converge', steps: 4 }),
    'D3 C4 F3 A3');
});
check('arp random mode is seeded and deterministic', () => {
  const one = expandArp({ chord: 'C', mode: 'random', steps: 8, seed: 3 });
  assert.strictEqual(one, expandArp({ chord: 'C', mode: 'random', steps: 8, seed: 3 }));
  assert.notStrictEqual(one, expandArp({ chord: 'C', mode: 'random', steps: 8, seed: 4 }));
});
check('walk starts at start, stays in span, and is deterministic', () => {
  const state = { count: 0 };
  const bar = expandWalk({ steps: 8, start: 1, span: [-3, 10], seed: 5 }, state);
  const degrees = bar.split(' ').map(Number);
  assert.strictEqual(degrees.length, 8);
  assert.strictEqual(degrees[0], 1);
  assert.ok(degrees.every((d) => d >= -3 && d <= 10));
  const again = expandWalk({ steps: 8, start: 1, span: [-3, 10], seed: 5 }, { count: 0 });
  assert.strictEqual(bar, again);
});
check('a second walk item continues where the first left off', () => {
  const state = { count: 0 };
  const first = expandWalk({ steps: 4, seed: 9 }, state).split(' ').map(Number);
  const second = expandWalk({ steps: 4, seed: 9 }, state).split(' ').map(Number);
  const step = Math.abs(second[0] - first[3]);
  assert.ok(step >= 1 && step <= 2, `continues by one move (moved ${step})`);
});
check('alternate cycles per pass inside a repeat', () => {
  const tl = parsePlay([{ '4x': [{ alternate: ['c', 'd'] }] }]);
  assert.deepStrictEqual(midis(tl), [60, 62, 60, 62]);
  assert.deepStrictEqual(times(tl), [0, 4, 8, 12]);
});
check('alternate outside a repeat plays its first entry', () => {
  assert.deepStrictEqual(midis(parsePlay([{ alternate: ['e', 'g'] }])), [64]);
});
check('alternate entries may be generator items', () => {
  const tl = parsePlay(
    [{ '2x': [{ alternate: [{ spread: { steps: 4, bd: 1 } }, 'sd sd sd sd'] }] }],
    { kit: 'standard' },
  );
  assert.strictEqual(tl.filter((e) => e.pitch === 'bd').length, 1);
  assert.strictEqual(tl.filter((e) => e.pitch === 'sd').length, 4);
});
check('alternate rejects directive entries', () => {
  assert.throws(() => parsePlay([{ alternate: [{ set: 'legato' }] }] as never), /measure strings or generator/);
});

console.log('\nchance / humanize / seed:');
check('hash01 is deterministic and uniform-ish', () => {
  assert.strictEqual(hash01(1, 2, 3), hash01(1, 2, 3));
  assert.notStrictEqual(hash01(1, 2, 3), hash01(2, 2, 3));
  const vals = Array.from({ length: 100 }, (_, i) => hash01(7, i));
  assert.ok(vals.every((v) => v >= 0 && v < 1));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  assert.ok(mean > 0.35 && mean < 0.65, `mean ${mean}`);
});
check('chance 0 silences, chance 1 (and off) changes nothing', () => {
  const base = parsePlay(['c d e f']);
  assert.strictEqual(parsePlay(['c d e f'], { chance: 0 }).length, 0);
  assert.deepStrictEqual(parsePlay(['c d e f'], { chance: 1 }), base);
});
check('chance is deterministic per seed and varies across seeds', () => {
  const props = { chance: 0.5, kit: 'standard' };
  const bars = ['hh hh hh hh hh hh hh hh', 'hh hh hh hh hh hh hh hh', 'hh hh hh hh hh hh hh hh', 'hh hh hh hh hh hh hh hh'];
  const a = parsePlay(bars, { ...props, seed: 1 });
  const b = parsePlay(bars, { ...props, seed: 1 });
  const c = parsePlay(bars, { ...props, seed: 2 });
  assert.deepStrictEqual(a, b);
  assert.ok(a.length > 0 && a.length < 32, `dropped some of 32 hats (kept ${a.length})`);
  assert.notDeepStrictEqual(times(a), times(c));
});
check('a dropped note keeps its slot — later notes never shift', () => {
  const full = parsePlay(['c d e f']);
  const thinned = parsePlay(['c d e f'], { chance: 0.5, seed: 3 });
  for (const e of thinned) {
    assert.ok(times(full).includes(e.time), `kept note at ${e.time} sits on the grid`);
  }
});
check('chance switches mid-measure with ||chance …||', () => {
  const tl = parsePlay(['||chance 0|| c d ||chance off|| e f']);
  assert.deepStrictEqual(midis(tl), [64, 65]);
  assert.deepStrictEqual(times(tl), [2, 3]);
});
check('humanize jitters within its bounds, deterministically', () => {
  const base = parsePlay(['c d e f']);
  const loose = parsePlay(['c d e f'], { humanize: 1, seed: 5 });
  assert.strictEqual(loose.length, base.length);
  assert.ok(loose.some((e, i) => e.time !== base[i].time), 'timing moved');
  loose.forEach((e, i) => {
    assert.ok(Math.abs(e.time - base[i].time) <= 0.03 + 1e-9, `time within ±0.03 (${e.time})`);
    assert.ok(Math.abs(e.velocity - base[i].velocity) <= 10, `velocity within ±10 (${e.velocity})`);
  });
  assert.deepStrictEqual(loose, parsePlay(['c d e f'], { humanize: 1, seed: 5 }));
});
check('humanize accepts explicit time/velocity and off', () => {
  const only = parsePlay(['c d'], { humanize: { velocity: 5 }, seed: 2 });
  assert.deepStrictEqual(times(only), [0, 2]); // time untouched
  const off = parsePlayFull(['humanize off', 'c d'], { humanize: 1, seed: 2 }).timeline;
  assert.deepStrictEqual(times(off), [0, 2]);
});
check('set clauses: chance, seed, humanize', () => {
  assert.strictEqual(parseSet('chance 0.6').chance, 0.6);
  assert.strictEqual(parseSet('chance off').chance, 1);
  assert.strictEqual(parseSet('seed 42').seed, 42);
  assert.deepStrictEqual(parseSet('humanize 0.5').humanize, { time: 0.015, velocity: 5 });
  assert.strictEqual(parseSet('humanize off').humanize, null);
  assert.throws(() => parseSet('chance 2'), /probability/);
});
check('seed/chance/humanize inherit and compile through a document', () => {
  const song = compileDoc({
    seed: 7,
    chance: 0.5,
    tracks: { keys: { play: ['c d e f g a b c^', 'c d e f g a b c^'] } },
  });
  const notes = song.tracks[0].timeline.length;
  assert.ok(notes > 0 && notes < 16, `inherited chance thinned the line (kept ${notes})`);
});
check('alternate varies passes of a loop: N section', () => {
  const song = compileDoc({
    tracks: { keys: {} },
    sections: {
      groove: {
        loop: 2,
        keys: { play: [{ alternate: ['c c c c', 'd d d d'] }] },
      },
    },
  });
  const tl = song.tracks[0].timeline;
  assert.deepStrictEqual(midis(tl), [60, 60, 60, 60, 62, 62, 62, 62]);
});

console.log('\nexamples (golden):');
check('every example matches its golden digest', () => {
  // Strudel-style repertoire snapshots: the whole examples/ directory is the
  // regression suite. On an intentional change to compiled output, regenerate
  // with:  UPDATE_GOLDEN=1 npm test -w @play.yaml/core
  const goldenPath = path.join(__dirname, 'examples.golden.json');
  const examplesDir = path.join(__dirname, '../../examples');
  const songsDir = path.join(__dirname, '../../songs');
  const scores: [string, string][] = fs.readdirSync(examplesDir)
    .filter((f) => f.endsWith('.play.yaml')).sort()
    .map((f) => [f, path.join(examplesDir, f)]);
  // Song projects (songs/<slug>/<slug>.play.yaml — see docs/song-workflow.md).
  if (fs.existsSync(songsDir)) {
    for (const dir of fs.readdirSync(songsDir).sort()) {
      const full = path.join(songsDir, dir);
      if (!fs.statSync(full).isDirectory()) continue;
      for (const f of fs.readdirSync(full).filter((f) => f.endsWith('.play.yaml')).sort()) {
        scores.push([`songs/${dir}/${f}`, path.join(full, f)]);
      }
    }
  }
  const digests: Record<string, { tracks: number; notes: number; lengthBeats: number; sha256: string }> = {};
  for (const [key, file] of scores) {
    const song = compileDoc(parseYaml(fs.readFileSync(file, 'utf8')));
    digests[key] = {
      tracks: song.tracks.length,
      notes: song.tracks.reduce((n, t) => n + t.timeline.length, 0),
      lengthBeats: song.lengthBeats,
      // `warnings` is diagnostics, not music: hashing it would move every
      // digest whenever the compiler learns to report something new.
      sha256: crypto.createHash('sha256')
        .update(JSON.stringify({ ...song, warnings: undefined }))
        .digest('hex'),
    };
  }
  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(goldenPath, JSON.stringify(digests, null, 2) + '\n');
    console.log(`    (golden file written: ${Object.keys(digests).length} examples)`);
    return;
  }
  assert.ok(fs.existsSync(goldenPath), 'examples.golden.json is missing — create it with UPDATE_GOLDEN=1');
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  assert.deepStrictEqual(
    digests,
    golden,
    'compiled examples drifted from examples.golden.json — if intentional, rerun with UPDATE_GOLDEN=1',
  );
});

console.log('\nfidelity (decodeMidi / compareMidi):');

// A small three-track song we can encode, perturb and re-score.
const fidSong = compileDoc(
  parseYaml(`
title: fidelity fixture
tempo: 90
measure: 4/4
tracks:
  lead: { velocity: 100 }
  mid: { velocity: 80 }
  low: { velocity: 80 }
sections:
  a:
    loop: false
    lead: { play: ["c4 e4 g4 c5", "b4 g4 e4 c4", "d4 f4 a4 d5", "c4 e4 g4 c5"] }
    mid:  { play: ["e3 g3 c4 e4", "d4 b3 g3 e3", "f3 a3 d4 f4", "e3 g3 c4 e4"] }
    low:  { play: ["c2 c2 g2 g2", "g2 g2 c2 c2", "d2 d2 a2 a2", "c2 c2 g2 g2"] }
`),
);

check('decodeMidi round-trips note count and tempo from encodeMidi', () => {
  const bytes = encodeMidi(fidSong, { bpm: fidSong.bpm });
  const parsed = decodeMidi(bytes);
  const noteCount = fidSong.tracks.reduce((n, t) => n + t.timeline.length, 0);
  assert.strictEqual(parsed.notes.length, noteCount, 'decoded note count matches');
  assert.strictEqual(Math.round(parsed.tempoMap[0].bpm), 90, 'decoded tempo matches');
});

check('a MIDI compared to itself scores 100%', () => {
  const bytes = encodeMidi(fidSong, { bpm: fidSong.bpm });
  const r = compareMidi(bytes, bytes);
  assert.strictEqual(r.transpose, 0, 'no transposition needed');
  assert.strictEqual(r.offsetBeats, 0, 'no offset needed');
  assert.ok(r.harmony > 0.999, `harmony ~1 (got ${r.harmony})`);
  assert.ok(r.pitch > 0.999, `pitch ~1 (got ${r.pitch})`);
  assert.ok(r.coverage > 0.999, `full coverage (got ${r.coverage})`);
  assert.ok(r.score > 99.5, `score ~100 (got ${r.score.toFixed(1)})`);
});

check('detects a whole-song transposition and still matches the harmony', () => {
  const bytes = encodeMidi(fidSong, { bpm: fidSong.bpm });
  // Same music a major third up: chroma still matches once the key is found.
  const up = {
    ...fidSong,
    tracks: fidSong.tracks.map((t) => ({
      ...t,
      timeline: t.timeline.map((n) => ({ ...n, midi: n.midi + 4 })),
    })),
  };
  // gen is the +4 rendition, orig is the reference — so orig is shifted +4 to match.
  const r = compareMidi(encodeMidi(up, { bpm: fidSong.bpm }), bytes);
  assert.strictEqual(r.transpose, 4, `found +4 semitones (got ${r.transpose})`);
  assert.ok(r.harmony > 0.999, `harmony recovered after transposing (got ${r.harmony})`);
});

check('a different tempo does not hurt harmony but shows in the tempo score', () => {
  const a = encodeMidi(fidSong, { bpm: 90 });
  const b = encodeMidi(fidSong, { bpm: 135 }); // same notes/beats, +50% tempo
  const r = compareMidi(a, b);
  assert.ok(r.harmony > 0.999, `harmony unaffected by tempo (got ${r.harmony})`);
  assert.ok(r.tempo < 0.5, `tempo score penalizes 90 vs 135 (got ${r.tempo.toFixed(2)})`);
});

check('a wrong (scrambled) rendition scores far below a faithful one', () => {
  const ref = encodeMidi(fidSong, { bpm: fidSong.bpm });
  // Push every pitch to an unrelated, key-clashing value.
  const junk = {
    ...fidSong,
    tracks: fidSong.tracks.map((t) => ({
      ...t,
      timeline: t.timeline.map((n, i) => ({ ...n, midi: 30 + ((n.midi * 7 + i * 5) % 40) })),
    })),
  };
  const good = compareMidi(ref, ref).score;
  const bad = compareMidi(encodeMidi(junk, { bpm: fidSong.bpm }), ref).score;
  assert.ok(bad < good - 20, `scrambled (${bad.toFixed(1)}) well under faithful (${good.toFixed(1)})`);
});

check('flags the bar we corrupt as a weakest window', () => {
  const ref = encodeMidi(fidSong, { bpm: fidSong.bpm });
  // Wreck only the third bar (beats 8..12) of the lead line.
  const broken = {
    ...fidSong,
    tracks: fidSong.tracks.map((t) =>
      t.name !== 'lead'
        ? t
        : {
            ...t,
            timeline: t.timeline.map((n) =>
              n.time >= 8 && n.time < 12 ? { ...n, midi: n.midi + 6 } : n,
            ),
          },
    ),
  };
  const r = compareMidi(encodeMidi(broken, { bpm: fidSong.bpm }), ref, { windowBeats: 4 });
  const worstWin = r.worst[0];
  assert.ok(worstWin.startBeat >= 8 && worstWin.startBeat < 12, `worst window is bar 3 (got beat ${worstWin.startBeat})`);
});


console.log('\nnotation (MIDI → play.yaml):');

check('decodeMidi reads meter, key, track names and program changes', () => {
  const doc = parseYaml(`
tempo: 96
measure: 3/4
tracks:
  rh: { sample: flute }
  lh: { sample: bass }
sections:
  a:
    loop: false
    rh: { play: ["c4 d4 e4"] }
    lh: { play: ["c2 ~ g2"] }
`);
  const parsed = decodeMidi(encodeMidi(compileDoc(doc)));
  assert.deepStrictEqual(parsed.timeSignatures, [{ beat: 0, numerator: 3, denominator: 4 }]);
  assert.deepStrictEqual(parsed.keySignatures, [{ beat: 0, sharps: 0, minor: false }]);
  assert.deepStrictEqual(parsed.trackNames, ['Conductor', 'rh', 'lh']);
  assert.deepStrictEqual([...new Set(parsed.notes.map((n) => n.track))].sort(), [1, 2]);
  assert.deepStrictEqual(parsed.programs.map((p) => p.program), [73, 33]);
});

check('a compound meter survives the .mid round trip as itself', () => {
  // 12/8 and 6/4 are both six quarter notes; only the notation tells them
  // apart, so the compiler carries it and the exporter writes it.
  for (const [measure, expect] of [['12/8', '12/8'], ['6/8', '6/8'], ['9/8', '9/8'], ['5/4', '5/4']] as const) {
    const song = compileDoc({ measure, play: ['c'] });
    const ts = decodeMidi(encodeMidi(song)).timeSignatures[0];
    assert.strictEqual(`${ts.numerator}/${ts.denominator}`, expect, `${measure} round trip`);
  }
});

check('notateMeasures writes a bar that compiles back to the same notes', () => {
  const notes = [
    { start: 0, duration: 1, midi: 60 },
    { start: 1, duration: 0.5, midi: 62 },
    { start: 1.5, duration: 0.5, midi: 64 },
    { start: 2, duration: 2, midi: 65 },
  ];
  const res = notateMeasures(notes, { measureBeats: 4, slots: 4 });
  // beat 2 is two eighths, so it becomes a group; the half note holds on.
  assert.deepStrictEqual(res.lines, ['c4 {d4 e4} f4 _']);
  const back = compileDoc({ play: res.lines });
  assert.deepStrictEqual(
    back.tracks[0].timeline.map((e) => [e.time, e.midi]),
    notes.map((n) => [n.start, n.midi]),
  );
});

check('co-onset notes become a chord, a held note becomes a hold', () => {
  const res = notateMeasures([
    { start: 0, duration: 4, midi: 60 },
    { start: 0, duration: 4, midi: 64 },
    { start: 0, duration: 4, midi: 67 },
  ], { measureBeats: 4, slots: 4 });
  assert.deepStrictEqual(res.lines, ['[c4 e4 g4] _ _ _']);
});

check('a rest is written where nothing sounds', () => {
  const res = notateMeasures([{ start: 2, duration: 1, midi: 60 }], { measureBeats: 4, slots: 4 });
  assert.deepStrictEqual(res.lines, ['~ ~ c4 ~']);
});

check('snapping reports the largest onset it moved', () => {
  const res = notateMeasures([
    { start: 0.02, duration: 1, midi: 60 },
    { start: 1.1, duration: 1, midi: 62 },
  ], { measureBeats: 4, slots: 4, snap: 4 });
  assert.deepStrictEqual(res.placed.map((p) => p.start), [0, 1]);
  assert.ok(Math.abs(res.maxShift - 0.1) < 1e-9, `maxShift ${res.maxShift}`);
});

check('a slot needing too many steps drops release positions, not onsets', () => {
  // A quarter note released after 0.257 beats would otherwise force a
  // ~1000-step grid on the beat that holds it.
  const res = notateMeasures([
    { start: 0, duration: 0.257, midi: 60 },
    { start: 1, duration: 0.257, midi: 62 },
    { start: 2, duration: 0.257, midi: 64 },
    { start: 3, duration: 0.257, midi: 65 },
  ], { measureBeats: 4, slots: 4 });
  assert.deepStrictEqual(res.lines, ['c4 d4 e4 f4']);
});

check('the grid resolution can follow an imported file’s own ticks', () => {
  // 2520 ticks/quarter cannot represent an odd 480-tick position (2520/480
  // is 5.25); lcm(2520, 480) can.
  const odd = 7 / 480;
  const res = notateMeasures([{ start: odd, duration: 1, midi: 60 }],
    { measureBeats: 4, slots: 4, ticks: 10080 });
  assert.ok(Math.abs(res.placed[0].start - odd) < 1e-9, `placed at ${res.placed[0].start}`);
});

check('separateVoices splits a held bass out from a moving line', () => {
  const voices = separateVoices([
    { start: 0, duration: 4, midi: 48 },
    { start: 0, duration: 1, midi: 72 },
    { start: 1, duration: 1, midi: 74 },
    { start: 2, duration: 1, midi: 76 },
    { start: 3, duration: 1, midi: 77 },
  ]);
  assert.strictEqual(voices.length, 2);
  assert.deepStrictEqual(voices[0].map((n) => n.midi), [72, 74, 76, 77]);
  assert.deepStrictEqual(voices[1].map((n) => n.midi), [48]);
  assert.strictEqual(voices[1][0].duration, 4, 'the bass keeps ringing');
});

check('separateVoices keeps a chord together instead of fanning it out', () => {
  const voices = separateVoices([
    { start: 0, duration: 1, midi: 60 },
    { start: 0, duration: 1, midi: 64 },
    { start: 0, duration: 1, midi: 67 },
  ]);
  assert.strictEqual(voices.length, 1);
  assert.deepStrictEqual(voices[0].map((n) => n.midi), [60, 64, 67]);
});

check('separateVoices never loses a note, and every voice is monophonic', () => {
  const song = compileDoc(parseYaml(fs.readFileSync(
    path.join(__dirname, '../../examples/clair-de-lune.play.yaml'), 'utf8')));
  for (const track of song.tracks) {
    const notes = track.timeline.filter((e) => e.midi != null)
      .map((e) => ({ start: e.time, duration: e.duration, midi: e.midi as number }));
    if (!notes.length) continue;
    const voices = separateVoices(notes);
    assert.strictEqual(voices.flat().length, notes.length, `${track.name} keeps every note`);
    for (const voice of voices) {
      for (let i = 1; i < voice.length; i++) {
        const prev = voice[i - 1];
        const overlaps = voice[i].start > prev.start + 1e-9
          && voice[i].start < prev.start + prev.duration - 1e-9;
        assert.ok(!overlaps, `${track.name}: ${prev.midi} still ringing under ${voice[i].midi}`);
      }
    }
  }
});

check('every example survives .mid export and re-import note for note', () => {
  // The importer's whole claim in one test: onset beat and pitch are exactly
  // what the file said, for real scores rather than fixtures.
  const examplesDir = path.join(__dirname, '../../examples');
  for (const file of ['twinkle', 'bwv846', 'fur-elise', 'drum-lab', 'nocturne-op9-no2']) {
    const song = compileDoc(parseYaml(
      fs.readFileSync(path.join(examplesDir, `${file}.play.yaml`), 'utf8')));
    const parsed = decodeMidi(encodeMidi(song, { bpm: song.bpm, tpqn: 480 }));
    const meter = parsed.timeSignatures[0];

    const want: string[] = [];
    const got: string[] = [];
    const byGroup = new Map<string, { start: number; duration: number; midi: number }[]>();
    for (const n of parsed.notes) {
      want.push(`${n.startBeat.toFixed(4)}:${n.pitch}`);
      const key = `${n.track}:${n.channel}`;
      const bucket = byGroup.get(key) ?? [];
      bucket.push({ start: n.startBeat, duration: n.durBeat, midi: n.pitch });
      byGroup.set(key, bucket);
    }
    for (const notes of byGroup.values()) {
      for (const voice of separateVoices(notes)) {
        const lines = notateMeasures(voice, {
          measureBeats: meter.numerator * (4 / meter.denominator),
          slots: meter.numerator,
          ticks: 10080,
        }).lines;
        for (const e of compileDoc({ measure: `${meter.numerator}/${meter.denominator}`, play: lines })
          .tracks[0].timeline) {
          if (e.midi != null) got.push(`${e.time.toFixed(4)}:${e.midi}`);
        }
      }
    }
    assert.deepStrictEqual(got.sort(), want.sort(), `${file} re-imports note for note`);
  }
});

console.log('\nwritten compile:');
check('written mode drops gate, humanize, rubato and strum; the default compile keeps them', () => {
  const doc = { gate: 0.5, humanize: 1, rubato: 0.8, play: ['[c e g]~ d _ ~', 'c d e f'] };
  const written = compileDoc(doc, { written: true }).tracks[0];
  const chord = written.timeline.filter((e) => e.time === 0);
  assert.deepStrictEqual(chord.map((e) => e.duration), [1, 1, 1], 'a rolled chord is a block chord at full length');
  const d = written.timeline.find((e) => e.pitch === 'D4')!;
  assert.deepStrictEqual([d.time, d.duration], [1, 2], 'holds merge into one written note');
  assert.deepStrictEqual(written.timeline.slice(4).map((e) => e.time), [4, 5, 6, 7], 'no humanize or rubato');
  const played = compileDoc(doc).tracks[0];
  assert.ok(played.timeline.some((e) => e.duration < 1 && e.duration > 0), 'the performance still gates');
  assert.strictEqual(played.bars, undefined, 'only a written compile carries a bar map');
});
check('written mode keeps chance drops and keeps a drum roll as one note', () => {
  const doc = { kit: 'acoustic', chance: 0.5, seed: 7, play: ['hh hh hh hh hh hh hh hh'] };
  const keyOf = (e: TimelineEvent) => `${e.time}:${e.midi}`;
  const played = compileDoc(doc).tracks[0].timeline.map(keyOf);
  assert.ok(played.length > 0 && played.length < 8, 'the seed drops some hats');
  assert.deepStrictEqual(compileDoc(doc, { written: true }).tracks[0].timeline.map(keyOf), played, 'the same notes survive');
  const rolls = compileDoc({ kit: 'acoustic', play: ['sd~ ~ sd~~ ~'] }, { written: true }).tracks[0].timeline;
  assert.deepStrictEqual(rolls.map((e) => [e.time, e.duration, e.roll]), [[0, 1, 1], [2, 1, 2]]);
  assert.ok(compileDoc({ kit: 'acoustic', play: ['sd~ ~ sd~~ ~'] }).tracks[0].timeline.length > 2, 'a performed roll retriggers');
});
check('the bar map follows meter and key changes, not chord-scale tokens', () => {
  const song = compileDoc({
    scale: 'g major',
    play: ['1 2 3 4', { measure: '6/8', scale: 'eb major' }, '1 2 3 4 5 6', '==Dm7== 1 2 3 4 5 6', { 4: '1 2 3 4 5 6' }],
  }, { written: true });
  const bars = song.tracks[0].bars!;
  assert.deepStrictEqual(bars.map((b) => [b.start, b.beats, b.meter, b.scale]), [
    [0, 4, '4/4', 'g major'], [4, 3, '6/8', 'eb major'], [7, 3, '6/8', 'eb major'], [10, 3, '6/8', 'eb major'],
  ]);
  const gap = compileDoc({ play: [{ 3: 'c d e f' }] }, { written: true }).tracks[0].bars!;
  assert.deepStrictEqual(gap.map((b) => b.start), [0, 4, 8], 'bars skipped by a numbered measure are there, silent');
});

console.log('\nnotation (sheet music):');
const firstVoice = (score: Score, measure: number, part = 0) => score.parts[part].measures[measure].voices[0].events;
const shape = (events: NotationEvent[]) =>
  events.map((e) => `${e.kind === 'rest' ? 'r' : e.notes.map((n) => n.midi).join('+')}:${e.type ?? 'measure'}${'.'.repeat(e.dots)}` +
    `${e.tieStop ? '<' : ''}${e.tieStart ? '>' : ''}`);
check('dotted and double-dotted values', () => {
  const score = scoreFromDoc({ play: ['c _ _ d e _ _ _', '{c _ _ _} {_ _ _ d} e f'] });
  assert.deepStrictEqual(shape(firstVoice(score, 0)), ['60:quarter.', '62:eighth', '64:half']);
  assert.deepStrictEqual(shape(firstVoice(score, 1)), ['60:quarter..', '62:16th', '64:quarter', '65:quarter']);
});
check('a note held over the bar line is tied, and beat 3 of 4/4 stays visible', () => {
  const score = scoreFromDoc({ play: ['c d _ _', '_ e f g'] });
  assert.deepStrictEqual(shape(firstVoice(score, 0)), ['60:quarter', '62:quarter>', '62:half<>']);
  assert.deepStrictEqual(shape(firstVoice(score, 1)), ['62:quarter<', '64:quarter', '65:quarter', '67:quarter']);
});
check('a triplet is bracketed 3:2 and fills its beat', () => {
  const events = firstVoice(scoreFromDoc({ play: ['{c d e} f g a'] }), 0);
  assert.deepStrictEqual(events.slice(0, 3).map((e) => [e.type, e.tuplet?.actual, e.tuplet?.normal, !!e.tuplet?.start, !!e.tuplet?.stop]), [
    ['eighth', 3, 2, true, false], ['eighth', 3, 2, false, false], ['eighth', 3, 2, false, true],
  ]);
  assert.strictEqual(events[3].tuplet, undefined);
  const half = firstVoice(scoreFromDoc({ play: ['c d e'] }), 0);
  assert.deepStrictEqual(half.map((e) => [e.type, e.tuplet?.actual, e.tuplet?.normalType]), [
    ['half', 3, 'half'], ['half', 3, 'half'], ['half', 3, 'half'],
  ], 'three notes over a 4/4 bar are a half-note triplet, not tied fragments');
});
check('a quintuplet is 5 sixteenths in the time of 4', () => {
  const events = firstVoice(scoreFromDoc({ play: ['{c d e f g} a b c5'] }), 0);
  assert.deepStrictEqual(events.slice(0, 5).map((e) => `${e.type}:${e.tuplet?.actual}/${e.tuplet?.normal}`), Array(5).fill('16th:5/4'));
});
check('6/8 groups by dotted quarters', () => {
  const score = scoreFromDoc({ measure: '6/8', play: ['c d _ _ e f', 'c _ _ _ _ _', '{c _ d} e _ _ _ _'] });
  assert.deepStrictEqual(shape(firstVoice(score, 0)), ['60:eighth', '62:quarter>', '62:eighth<', '64:eighth', '65:eighth']);
  assert.deepStrictEqual(shape(firstVoice(score, 1)), ['60:half.']);
  assert.deepStrictEqual(score.measures[0].time, { beats: 6, beatType: 8 });
});
check('a meter change starts a new time signature', () => {
  const score = scoreFromDoc({ play: ['c d e f', { measure: '3/4' }, 'c d e', 'c d e'] });
  assert.deepStrictEqual(score.measures.map((m) => [m.time.beats, m.time.beatType, m.timeChanged, m.length / score.divisions]), [
    [4, 4, true, 4], [3, 4, true, 3], [3, 4, false, 3],
  ]);
});
check('keys come from scale:, and pitches are spelled from them', () => {
  assert.deepStrictEqual(keyFromScale('eb major'), { fifths: -3, mode: 'major' });
  assert.deepStrictEqual(keyFromScale('f# minor'), { fifths: 3, mode: 'minor' });
  assert.deepStrictEqual(keyFromScale('gb major'), { fifths: -6, mode: 'major' });
  assert.deepStrictEqual(keyFromScale('d dorian'), { fifths: 0, mode: 'dorian' });
  assert.deepStrictEqual(keyFromScale('c whole tone'), { fifths: 0, mode: 'none' });
  const score = scoreFromDoc({ scale: 'eb major', sample: 'flute', play: ['eb4 e4 eb4 ab4', 'c5 db5 b4 bb4'] });
  assert.deepStrictEqual(score.parts[0].measures[0].key, { fifths: -3, mode: 'major' });
  const written = (m: number) => firstVoice(score, m).map((e) => {
    const p = e.notes[0].pitch!;
    return `${p.step}${p.alter < 0 ? 'b' : p.alter > 0 ? '#' : ''}${p.octave}${p.accidental ? `(${p.accidental})` : ''}`;
  });
  assert.deepStrictEqual(written(0), ['Eb4', 'E4(natural)', 'Eb4(flat)', 'Ab4']);
  assert.deepStrictEqual(written(1), ['C5', 'Db5(flat)', 'B4(natural)', 'Bb4(flat)']);
  assert.strictEqual(score.parts[0].measures[1].key, undefined, 'the key is only restated when it changes');
  const minor = scoreFromDoc({ scale: 'd minor', sample: 'flute', play: ['c#5 d5 bb4 b4'] });
  assert.deepStrictEqual(firstVoice(minor, 0).map((e) => e.notes[0].pitch!.step + e.notes[0].pitch!.alter), ['C1', 'D0', 'B-1', 'B0'],
    'a minor key raises its 6th and 7th as sharpened letters');
});
check('overlapping lines in one track become two voices, each filling the bar', () => {
  const score = scoreFromDoc({ sample: 'flute', play: ['[c5 {e4 f4 g4 a4}]: b4 c5'] });
  const voices = score.parts[0].measures[0].voices;
  assert.strictEqual(voices.length, 2);
  for (const v of voices) assert.strictEqual(v.events.reduce((s, e) => s + e.duration, 0), score.measures[0].length);
  assert.deepStrictEqual(shape(voices[0].events), ['72:half', '71:quarter', '72:quarter']);
  assert.deepStrictEqual(shape(voices[1].events), ['64:eighth', '65:eighth', '67:eighth', '69:eighth', 'r:half']);
  assert.deepStrictEqual(voices.map((v) => v.voice), [1, 2]);
  assert.deepStrictEqual(voices.map((v) => v.events.filter((e) => e.kind === 'rest').map((e) => !!e.hidden)), [[], [true]],
    'a second voice pads with rests that are not printed');
  assert.ok(/<forward>\s*<duration>5040<\/duration>\s*<voice>2<\/voice>/.test(encodeMusicXml(score)), 'written as a forward');
  assert.deepStrictEqual(voices.map((v) => [...new Set(v.events.filter((e) => e.kind === 'note').map((e) => e.stem))]), [['up'], ['down']],
    'with two voices on a staff, the first stems up and the second down');
  assert.strictEqual(firstVoice(scoreFromDoc({ sample: 'flute', play: ['c5 d5 e5 f5'] }), 0)[0].stem, undefined,
    'a single voice leaves stems to the renderer');
  const after = scoreFromDoc({ sample: 'flute', play: ['[c5 {e4 f4 g4 a4}]: b4 c5', 'c4 d4 e4 f4'] });
  assert.deepStrictEqual(after.parts[0].measures[1].voices.map((v) => [v.voice, shape(v.events).length]), [[1, 4]],
    'once the lines stop overlapping, a lower line moves back into voice 1');
});
check('keyboards get a grand staff, chords stay together', () => {
  const score = scoreFromDoc({ play: ['[c3 e3 g3] [e5 g5 c6] [c4 e4 g4] ~'] });
  const part = score.parts[0];
  assert.strictEqual(part.staves, 2);
  assert.deepStrictEqual(part.clefs.map((c) => c.sign), ['G', 'F']);
  const staffOf = (midi: number) => part.measures[0].voices.find((v) => v.events.some((e) => e.notes.some((n) => n.midi === midi)))!.staff;
  assert.deepStrictEqual([48, 52, 55, 76, 79, 84, 60, 64, 67].map(staffOf), [2, 2, 2, 1, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(scoreFromDoc({ sample: 'cello', play: ['c2 g2 c3 e3'] }).parts[0].clefs, [{ sign: 'F', line: 4 }]);
});
check('a drum bar is unpitched on a percussion clef, with x heads for hats', () => {
  const score = scoreFromDoc({ kit: 'acoustic', play: ['[bd hh] hh [sd hh] hh'] });
  const part = score.parts[0];
  assert.ok(part.percussion);
  assert.deepStrictEqual(part.clefs, [{ sign: 'percussion', line: 2 }]);
  const first = firstVoice(score, 0)[0];
  assert.deepStrictEqual(first.notes.map((n) => [n.midi, n.drum!.step, n.drum!.octave, n.drum!.notehead]), [
    [36, 'F', 4, 'normal'], [42, 'G', 5, 'x'],
  ]);
  assert.deepStrictEqual(part.instruments.map((i) => i.key), [36, 38, 42]);
  const xml = encodeMusicXml(score);
  assert.ok(xml.includes('<sign>percussion</sign>') && xml.includes('<unpitched>') && xml.includes('<notehead>x</notehead>'));
  assert.ok(xml.includes('<midi-unpitched>37</midi-unpitched>'), 'MusicXML counts GM keys from 1');
  assert.deepStrictEqual([...new Set(firstVoice(score, 0).map((e) => e.stem))], ['up'], 'a one-voice kit has every stem up');
});
check('an empty measure is one whole-measure rest, whatever the meter', () => {
  const score = scoreFromDoc({ measure: '3/4', play: ['c d e', '~', 'f g a'] });
  const rest = firstVoice(score, 1);
  assert.deepStrictEqual(rest.map((e) => [e.kind, e.measureRest, e.duration]), [['rest', true, 3 * score.divisions]]);
  assert.ok(encodeMusicXml(score).includes('<rest measure="yes"/>'));
});
check('tempo marks: the opening tempo and each change', () => {
  const score = scoreFromDoc({ tempo: 120, measure: '6/8', play: ['c d e f g a', { tempo: 90 }, 'c d e f g a'] });
  assert.deepStrictEqual(score.measures.map((m) => m.tempos.map((t) => [t.beatUnit, t.dotted, t.perMinute, t.bpm])), [
    [['quarter', true, 80, 120]], [['quarter', true, 60, 90]],
  ]);
});
check('MusicXML escapes the title and parts', () => {
  const xml = encodeMusicXml(scoreFromDoc({ title: 'Tom & Jerry <live>', tracks: { 'a"b': { play: 'c d e f' } } }));
  assert.ok(xml.includes('<work-title>Tom &amp; Jerry &lt;live&gt;</work-title>'));
  assert.ok(xml.includes('<part-name>a&quot;b</part-name>'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'no bare ampersand anywhere');
});
check('MusicXML: header, element order and backups', () => {
  const xml = encodeMusicXml(scoreFromDoc({ sample: 'flute', play: ['[c5 {e4 f4 g4 a4}]: {b4 c5 d5} c5', 'c5 _ _ _', '_ d5 e5 f5'] }));
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise'));
  assert.ok(xml.includes('<score-partwise version="4.0">'));
  assert.ok(/<backup>\s*<duration>10080<\/duration>/.test(xml), 'the second voice backs up a whole measure');
  const notes = xml.match(/<note>[\s\S]*?<\/note>/g)!;
  const order = ['chord', 'pitch', 'rest', 'duration', 'tie', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'staff', 'beam', 'notations'];
  for (const note of notes) {
    const tags = [...note.matchAll(/^ {8}<([a-z-]+)/gm)].map((m) => order.indexOf(m[1]));
    assert.ok(tags.length >= 3 && !tags.includes(-1), `unexpected children:\n${note}`);
    assert.deepStrictEqual(tags, [...tags].sort((a, b) => a - b), `out of order:\n${note}`);
  }
  assert.ok(xml.includes('<time-modification>') && xml.includes('<tuplet type="start" bracket="yes"/>'));
  assert.ok(xml.includes('<tie type="start"/>') && xml.includes('<tied type="stop"/>'));
});
const beamsOf = (events: NotationEvent[]) => events.map((e) => (e.beams ?? []).join('+') || '-');
check('beams: four eighths in 2/4 pair by beat; in 4/4 a half bar of eighths is one group', () => {
  assert.deepStrictEqual(beamsOf(firstVoice(scoreFromDoc({ measure: '2/4', play: ['{c d} {e f}'] }), 0)),
    ['begin', 'end', 'begin', 'end']);
  assert.deepStrictEqual(beamsOf(firstVoice(scoreFromDoc({ play: ['{c d} {e f} {g a} b'] }), 0)),
    ['begin', 'continue', 'continue', 'end', 'begin', 'end', '-']);
});
check('beams: 16ths group per beat, with a second beam', () => {
  const events = firstVoice(scoreFromDoc({ play: ['{c d e f} {g a b c5} c5 ~'] }), 0);
  assert.deepStrictEqual(beamsOf(events).slice(0, 8), [
    'begin+begin', 'continue+continue', 'continue+continue', 'end+end',
    'begin+begin', 'continue+continue', 'continue+continue', 'end+end',
  ]);
  assert.deepStrictEqual(beamsOf(events).slice(8), ['-', '-']);
});
check('beams: a dotted eighth and 16th hook back; a 16th and dotted eighth hook forward', () => {
  const events = firstVoice(scoreFromDoc({ play: ['{c _ _ d} {e f _ _} g ~'] }), 0);
  assert.deepStrictEqual(beamsOf(events).slice(0, 4), ['begin', 'end+backward hook', 'begin+forward hook', 'end']);
});
check('beams: a rest breaks the beam, and a lone eighth keeps its flag', () => {
  const events = firstVoice(scoreFromDoc({ play: ['{c d ~ e} {f ~} g a'] }), 0);
  assert.deepStrictEqual(beamsOf(events), ['begin+begin', 'end+end', '-', '-', '-', '-', '-', '-']);
});
check('beams: a triplet is beamed as its own group', () => {
  const events = firstVoice(scoreFromDoc({ play: ['{c d e} {f g} a b'] }), 0);
  assert.deepStrictEqual(beamsOf(events), ['begin', 'continue', 'end', 'begin', 'end', '-', '-']);
});
check('beams: 6/8 groups of three eighths; drums beam the same way', () => {
  const events = firstVoice(scoreFromDoc({ measure: '6/8', play: ['c d e f g a'] }), 0);
  assert.deepStrictEqual(beamsOf(events), ['begin', 'continue', 'end', 'begin', 'continue', 'end']);
  const drums = firstVoice(scoreFromDoc({ kit: 'acoustic', play: ['{hh hh} {hh hh} {hh hh} {hh hh}'] }), 0);
  assert.deepStrictEqual(beamsOf(drums), ['begin', 'continue', 'continue', 'end', 'begin', 'continue', 'continue', 'end']);
  const xml = encodeMusicXml(scoreFromDoc({ measure: '6/8', play: ['[c e] d e f g a'] }));
  assert.ok(/<beam number="1">begin<\/beam>/.test(xml));
  assert.strictEqual((xml.match(/<beam number="1">begin<\/beam>/g) ?? []).length, 2, 'a chord carries its beam once');
});
check('the MusicXML encoder is deterministic', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../examples/drum-lab.play.yaml'), 'utf8');
  const a = encodeMusicXml(scoreFromDoc(parseYaml(text)));
  const b = encodeMusicXml(scoreFromDoc(parseYaml(text)));
  assert.strictEqual(a, b);
});
check('keyboard tracks with the same sample are one part on one grand staff', () => {
  const score = scoreFromDoc({ tracks: { rh: { sample: 'piano', play: 'e5 d5 c5 b4' }, lh: { sample: 'piano', play: 'c3 g3 c3 g3' } } });
  assert.strictEqual(score.parts.length, 1);
  const part = score.parts[0];
  assert.deepStrictEqual([part.name, part.staves, part.tracks], ['Piano', 2, [0, 1]]);
  const staffOf = (midi: number) => part.measures[0].voices.find((v) => v.events.some((e) => e.notes.some((n) => n.midi === midi)))!.staff;
  assert.deepStrictEqual([76, 74, 72, 71, 48, 55].map(staffOf), [1, 1, 1, 1, 2, 2]);
  const nested = scoreFromDoc({ tracks: { organ: { sample: 'organ', tracks: {
    manual1: { play: 'c5 d5 e5 f5' }, manual2: { play: 'e4 f4 g4 a4' }, pedal: { play: 'c2 g2 c2 g2' },
  } } } });
  assert.deepStrictEqual(nested.parts.map((p) => [p.name, p.staves, p.tracks]), [['organ', 2, [0, 1]], ['pedal', 1, [2]]],
    'tracks under one parent take its name, and the pedal keeps a staff to itself');
  assert.deepStrictEqual(['rh', 'RH2', 'right hand', 'Left-Hand', 'upper_1', 'pedal', 'lower 3', 'melody'].map(handOf),
    [0, 0, 0, 1, 0, undefined, 1, undefined]);
  assert.deepStrictEqual(['manual', 'manual1', 'manual2', 'Manual II'].map(handOf), [0, 0, 1, 1],
    'an organ trio plays the second manual with the left hand');
});
check('a left hand above middle C stays on the lower staff, under a treble clef', () => {
  const score = scoreFromDoc({ tracks: { rh: { sample: 'piano', play: 'c6 d6 e6 f6' }, lh: { sample: 'piano', play: 'e4 g4 c5 g4' } } });
  const part = score.parts[0];
  for (const v of part.measures[0].voices) {
    const midis = v.events.flatMap((e) => e.notes.map((n) => n.midi));
    if (midis.includes(64)) assert.strictEqual(v.staff, 2);
  }
  assert.deepStrictEqual(part.clefs, [{ sign: 'G', line: 2 }, { sign: 'G', line: 2 }]);
});
check('a grand staff changes clef where a hand settles in another register', () => {
  const score = scoreFromDoc({ tracks: {
    rh: { sample: 'piano', play: ['c5 d5 e5 f5', 'c5 d5 e5 f5', 'c5 d5 e5 f5', 'c5 d5 e5 f5'] },
    lh: { sample: 'piano', play: ['c3 g3 c3 g3', 'e4 g4 c5 g4', 'e4 g4 c5 g4', 'c3 g3 c3 g3'] },
  } });
  const part = score.parts[0];
  assert.deepStrictEqual(part.clefs.map((c) => c.sign), ['G', 'F']);
  assert.deepStrictEqual(part.measures.map((m) => m.clefs?.map((c) => c?.sign)), [undefined, [undefined, 'G'], undefined, [undefined, 'F']]);
  const xml = encodeMusicXml(score);
  assert.strictEqual((xml.match(/<clef number="2">/g) ?? []).length, 3, 'the opening clef and two changes');
  const blip = scoreFromDoc({ tracks: {
    rh: { sample: 'piano', play: ['c5 d5 e5 f5', 'c5 d5 e5 f5', 'c5 d5 e5 f5'] },
    lh: { sample: 'piano', play: ['c3 g3 c3 g3', 'e4 g4 c5 g4', 'c3 g3 c3 g3'] },
  } });
  assert.ok(blip.parts[0].measures.every((m) => !m.clefs), 'one high measure is not worth two clef changes');
});
check('two keyboard tracks striking together with equal lengths form one chord; a unison is one note', () => {
  const score = scoreFromDoc({ tracks: { rh1: { sample: 'piano', play: 'e5 f5 g5 a5' }, rh2: { sample: 'piano', play: 'c5 d5 g5 f5' } } });
  const events = score.parts[0].measures[0].voices.filter((v) => v.staff === 1);
  assert.strictEqual(events.length, 1, 'one voice on the upper staff');
  assert.deepStrictEqual(events[0].events.map((e) => e.notes.map((n) => n.midi)), [[72, 76], [74, 77], [79], [77, 81]]);
  assert.strictEqual(scoreNotes(score).length, 7, 'the unison g5 is one note');
  const held = scoreFromDoc({ tracks: { lh1: { sample: 'piano', play: '[f3 ab3] ~ ~ ~' }, lh2: { sample: 'piano', play: '[f3 ab3] _ _ ~' } } });
  assert.deepStrictEqual(scoreNotes(held).map((n) => [n.midi, (n.end - n.start) / held.divisions]), [[53, 3], [56, 3]],
    'the same key struck together by two tracks is one note, as long as the longest');
  assert.strictEqual(held.parts[0].measures[0].voices.filter((v) => v.staff === 2).length, 1);
});
check('a piano and a cello stay two parts; so do two different keyboards', () => {
  const mixed = scoreFromDoc({ tracks: { rh: { sample: 'piano', play: 'c5 d5 e5 f5' }, cello: { sample: 'cello', play: 'c3 d3 e3 f3' }, lh: { sample: 'piano', play: 'c3 g3 c3 g3' } } });
  assert.deepStrictEqual(mixed.parts.map((p) => [p.name, p.tracks]), [['Piano', [0, 2]], ['cello', [1]]],
    'the piano sits where its first track does');
  const keyboards = scoreFromDoc({ tracks: { a: { sample: 'piano', play: 'c5 d5 e5 f5' }, b: { sample: 'organ', play: 'c3 d3 e3 f3' } } });
  assert.deepStrictEqual(keyboards.parts.map((p) => p.name), ['a', 'b']);
});
check('every bundled score: the model gives back the written timeline, and every voice fills its bar', () => {
  const root = path.join(__dirname, '../..');
  const files = fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.play.yaml')).map((f) => `examples/${f}`);
  for (const dir of fs.readdirSync(path.join(root, 'songs')).sort()) {
    if (!fs.statSync(path.join(root, 'songs', dir)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, 'songs', dir)).filter((f) => f.endsWith('.play.yaml'))) files.push(`songs/${dir}/${f}`);
  }
  assert.ok(files.length >= 10);
  for (const file of files) {
    const doc = parseYaml(fs.readFileSync(path.join(root, file), 'utf8'));
    const score = scoreFromDoc(doc);
    const T = score.divisions;
    // Per part: the union of its tracks' written notes, where the same
    // pitch struck at the same tick (by one track or several) is one note
    // lasting as long as the longest.
    const tracks = compileDoc(doc, { written: true }).tracks;
    const ends = new Map<string, number>();
    for (const part of score.parts) {
      for (const i of part.tracks) {
        for (const e of tracks[i].timeline) {
          const key = `${part.id} ${Math.round(e.time * T)}`;
          const end = Math.round((e.time + e.duration) * T);
          ends.set(`${key} ${e.midi}`, Math.max(end, ends.get(`${key} ${e.midi}`) ?? 0));
        }
      }
    }
    const want = new Set([...ends].map(([key, end]) => {
      const [part, start, midi] = key.split(' ');
      return `${part} ${start} ${end} ${midi}`;
    }));
    assert.deepStrictEqual(score.parts.flatMap((p) => p.tracks).sort((a, b) => a - b), tracks.map((_, i) => i),
      `${file}: every track is in exactly one part`);
    const got = scoreNotes(score).map((n) => `${n.part} ${n.start} ${n.end} ${n.midi}`);
    assert.strictEqual(new Set(got).size, got.length, `${file}: a note is written twice`);
    assert.deepStrictEqual([...got].sort(), [...want].sort(), `${file}: the score's notes differ from the written timeline`);
    score.parts.forEach((part) => part.measures.forEach((pm, mi) => {
      for (const v of pm.voices) {
        const sum = v.events.reduce((s, e) => s + e.duration, 0);
        assert.strictEqual(sum, score.measures[mi].length, `${file} ${part.name} bar ${mi + 1} voice ${v.voice}`);
        let at = 0;
        for (const e of v.events) {
          assert.strictEqual(e.offset, at, `${file} ${part.name} bar ${mi + 1}: events are contiguous`);
          at += e.duration;
        }
      }
    }));
  }
});

if (failed.length > 0) {
  console.error(`\n${passed} passed, ${failed.length} FAILED:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n${passed} checks passed.`);
