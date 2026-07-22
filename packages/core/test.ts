import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  compileDoc, parsePlay, parsePlayFull, parseSet, noteToMidi, measureToBeats, TimelineEvent,
  DEFAULT_TEMPO, DEFAULT_SAMPLE,
} from './src/parser';
import { encodeMidi } from './src/exporter';
import { parseYaml } from './src/yaml';
import { tempoSegments, beatsToSeconds } from './src/time';

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

console.log('\nchords as scales:');
check('a chord symbol implies its chord-scale', () => {
  assert.deepStrictEqual(midis(parsePlay('1 3 5 7', { scale: 'A7', octave: 3 })), [57, 61, 64, 67]);
  // Dm7 is dorian: the 6th is B natural, not Bb
  assert.deepStrictEqual(midis(parsePlay('6 ~ ~ ~', { scale: 'Dm7', octave: 3 })), [59]);
  assert.deepStrictEqual(midis(parsePlay('6 ~ ~ ~', { scale: 'Dm', octave: 3 })), [58]);
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
check('a lone _ is still the hold token', () => {
  const tl = parsePlay('c _ _ _');
  assert.strictEqual(tl.length, 1);
  assert.strictEqual(tl[0].duration, 3.6);
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
check('bow position words map onto the bow control', () => {
  const { controls } = parsePlayFull(['c', { set: 'sul tasto' }, 'c', { set: 'ordinario' }, 'c',
    { set: 'sul ponticello' }, 'c']);
  assert.deepStrictEqual(controls.map((c) => [c.cc, c.value]), [[74, 0], [74, 64], [74, 114]]);
});
check('vibrato words, from senza to molto', () => {
  const { controls } = parsePlayFull(['c', { set: 'senza vibrato' }, 'c', { set: 'poco vibrato' }, 'c',
    { set: 'molto vibrato' }, 'c']);
  assert.deepStrictEqual(controls.map((c) => c.value), [0, 32, 127]);
});
check('bow pressure words', () => {
  const { controls } = parsePlayFull(['c', { set: 'light bow' }, 'c', { set: 'heavy bow' }, 'c']);
  assert.deepStrictEqual(controls.map((c) => [c.cc, c.value]), [[71, 25], [71, 108]]);
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
  const song = compileDoc({ set: 'sul tasto, molto vibrato, mf', play: 'c d e f' });
  assert.deepStrictEqual(song.tracks[0].controls, [
    { time: 0, cc: 74, value: 0 },
    { time: 0, cc: 1, value: 127 },
  ]);
  assert.strictEqual(song.tracks[0].timeline[0].velocity, 80); // the mf applied too
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
check('dynamic marks set velocity (pp, mf, ff)', () => {
  const tl = parsePlay(['c ~ ~ ~', { set: 'pp' }, 'c ~ ~ ~', { set: 'ff' }, 'c ~ ~ ~']);
  assert.deepStrictEqual(tl.map((n) => n.velocity), [90, 32, 112]);
});
check('spelled-out and plain-english dynamics', () => {
  assert.strictEqual(parsePlay(['c', { set: 'forte' }, 'c'])[1].velocity, 96);
  assert.strictEqual(parsePlay(['c', { set: 'quiet' }, 'c'])[1].velocity, 48);
});
check('louder / softer step relative to the current dynamic', () => {
  const tl = parsePlay(['c ~ ~ ~', { set: 'mp' }, 'c ~ ~ ~', { set: 'louder' }, 'c ~ ~ ~',
    { set: 'softer, softer' }, 'c ~ ~ ~']);
  assert.deepStrictEqual(tl.map((n) => n.velocity), [90, 64, 80, 48]);
});
check('a bare "f" is forte, not F major', () => {
  assert.strictEqual(parseSet('f').velocity, 96);
  assert.strictEqual(parseSet('f major').scale, 'f major');
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
  assert.deepStrictEqual(song.tempoMap, [{ time: 4, bpm: 66, rampBeats: 12 }]);
  assert.strictEqual(parseSet('rit to 60 over 2').tempo?.bpm, 60);
});
check('"a tempo" returns to the tempo the track started at', () => {
  const song = compileDoc({
    tempo: 77,
    play: ['c ~ ~ ~', { set: 'allegro' }, 'c ~ ~ ~', { set: 'a tempo' }, 'c ~ ~ ~'],
  });
  assert.deepStrictEqual(song.tempoMap.map((t) => t.bpm), [132, 77]);
});
check('crescendo interpolates velocity across its span', () => {
  const tl = parsePlay(['c c c c', { set: 'p, crescendo to f over 1' }, 'c c c c', 'c ~ ~ ~']);
  const during = tl.slice(4, 8).map((n) => n.velocity);
  assert.strictEqual(during[0], 48); // starts at piano
  assert.ok(during[1] > during[0] && during[2] > during[1], `rising: ${during}`);
  assert.strictEqual(tl[8].velocity, 96); // lands on forte and stays
});
check('dynamic: and articulation: props are the worded velocity/gate', () => {
  const song = compileDoc({ dynamic: 'pp', articulation: 'staccato', play: 'c ~ ~ ~' });
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
    play: ['c ~ ~ ~', 'ff, sul ponticello, allargando to adagio over 2', 'c ~ ~ ~'],
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
check('meno mosso and piu mosso parse without the accent', () => {
  assert.strictEqual(parseSet('meno mosso').tempo!.scale, 0.8);
  assert.strictEqual(parseSet('piu mosso').tempo!.scale, 1.25);
});

console.log('\nSWAM-style techniques:');
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
  assert.strictEqual(parseSet('spiccato').gate, 0.3);
  const m = parseSet('martelé');
  assert.strictEqual(m.velocity, 112);
  assert.strictEqual(m.gate, 0.55);
});
check('declared expression control mirrors dynamics as CCs', () => {
  const { controls } = parsePlayFull(
    ['1 2 3 4', { set: 'ff' }, '1 2 3 4'],
    { velocity: 64, controls: { expression: 11 } },
  );
  assert.deepStrictEqual(controls[0], { time: 0, cc: 11, value: 64 }); // opening
  assert.deepStrictEqual(controls[1], { time: 4, cc: 11, value: 112 });
});
check('a crescendo becomes an expression ramp at eighth-note steps', () => {
  const { controls } = parsePlayFull(
    ['1 2 3 4', { set: 'crescendo to ff over 1' }, '1 2 3 4'],
    { velocity: 64, controls: { expression: 11 } },
  );
  const ramp = controls.filter((c) => c.time > 4 && c.time <= 8);
  assert.strictEqual(ramp.length, 8); // 4 beats × 2 per beat
  assert.strictEqual(ramp[ramp.length - 1].value, 112);
  assert.ok(ramp[0].value > 64 && ramp[0].value < 112);
});
check('without a declared expression control no CCs are emitted', () => {
  const { controls } = parsePlayFull(['1 2 3 4', { set: 'ff' }, '1 2 3 4'], { velocity: 64 });
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
check('an unmarked chord stays simultaneous; bare `~` is still a rest', () => {
  assert.deepStrictEqual(times(parsePlay('[c e g] ~ ~ ~')), [0, 0, 0]);
  assert.strictEqual(parsePlay('c ~ ~ ~').length, 1);
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
  const tl = parsePlay(['c c c c', { set: 'p, crescendo to f over 2' }, 'c c c c',
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
  const song = compileDoc({ kit: 'acoustic', play: ['cy _ _ _', 'pp', 'bd ~ ~ ~'] });
  const tl = song.tracks[0].timeline;
  assert.strictEqual(tl[0].duration, 3.6); // crash rings through the holds
  assert.strictEqual(tl[1].velocity, 32); // the pp mark took no time
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
check('unweighted measures are untouched (equal division)', () => {
  assert.deepStrictEqual(times(parsePlay('c d e d')), [0, 1, 2, 3]);
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

console.log('\nexamples (golden):');
check('bundled example compiles', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../examples/my-score.play.yaml'), 'utf8');
  const song = compileDoc(parseYaml(text));
  assert.strictEqual(song.tracks.length, 2);
  assert.ok(song.tracks[0].timeline.length > 0);
});
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
      sha256: crypto.createHash('sha256').update(JSON.stringify(song)).digest('hex'),
    };
  }
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(goldenPath)) {
    fs.writeFileSync(goldenPath, JSON.stringify(digests, null, 2) + '\n');
    console.log(`    (golden file ${fs.existsSync(goldenPath) ? 'written' : 'created'}: ${Object.keys(digests).length} examples)`);
    return;
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  assert.deepStrictEqual(
    digests,
    golden,
    'compiled examples drifted from examples.golden.json — if intentional, rerun with UPDATE_GOLDEN=1',
  );
});

if (failed.length > 0) {
  console.error(`\n${passed} passed, ${failed.length} FAILED:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n${passed} checks passed.`);
