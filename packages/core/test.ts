import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  compileDoc, parsePlay, parsePlayFull, parseSet, noteToMidi, measureToBeats, TimelineEvent,
  DEFAULT_TEMPO, DEFAULT_SAMPLE,
} from './src/parser';
import { encodeMidi } from './src/exporter';
import { parseYaml } from './src/yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
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
check('unknown names still throw', () => {
  assert.throws(() => parseSet('bow 30'), /Unknown set clause/);
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
  const countTempo = (b: Buffer) => {
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

console.log('\nexample:');
check('bundled example compiles', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../examples/my-score.play.yaml'), 'utf8');
  const song = compileDoc(parseYaml(text));
  assert.strictEqual(song.tracks.length, 2);
  assert.ok(song.tracks[0].timeline.length > 0);
});

console.log(`\n${passed} checks passed.`);
