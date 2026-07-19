import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseSong, compileDoc, TimelineEvent } from './src/parser';
import { encodeMidi } from './src/exporter';
import { parseYaml, stringifySong } from './src/yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// The spec's canonical single-track score (inline, no file dependency).
const songConfig = { root: 'C', scale: 'major', octave: 4 };
const trackData = [
  'f :: 1 1 5 5',
  '     6 6 5- ~',
  'p :: {4,4,3,3}. {2,2,1,1}. [1,3,5] .',
  '     5>! ~ ~ 1<<',
];

const tl = parseSong(trackData, songConfig);
const at = (t: number) => tl.filter((e: TimelineEvent) => Math.abs(e.time - t) < 1e-6);

console.log('parseSong — canonical score:');

check('Bar 1 "1 1 5 5" → C4 C4 G4 G4, forte (vel 90), gate 0.8', () => {
  assert.deepStrictEqual(at(0).map((e) => e.pitch), ['C4']);
  assert.strictEqual(at(0)[0].velocity, 90);
  assert.strictEqual(at(0)[0].duration, 0.8);
  assert.strictEqual(at(2)[0].pitch, 'G4');
});

check('Bar 2 inherits forte; legato 5th holds 0.95; beat 4 is a rest', () => {
  assert.strictEqual(at(4)[0].pitch, 'A4');
  assert.strictEqual(at(4)[0].velocity, 90);
  assert.strictEqual(at(6)[0].duration, 0.95);
  assert.strictEqual(at(7).length, 0);
});

check('Bar 3 staccato 16ths (gate 0.075), piano vel 45, held [1,3,5] chord', () => {
  const beat = at(8).concat(at(8.25), at(8.5), at(8.75));
  assert.deepStrictEqual(beat.map((e) => e.pitch), ['F4', 'F4', 'E4', 'E4']);
  assert.ok(Math.abs(beat[0].duration - 0.075) < 1e-6);
  assert.strictEqual(at(8)[0].velocity, 45);
  assert.deepStrictEqual(at(10).map((e) => e.pitch).sort(), ['C4', 'E4', 'G4']);
});

check('Bar 4 "5>!" → accented G5 (vel 65); "1<<" → C2', () => {
  assert.strictEqual(at(12)[0].pitch, 'G5');
  assert.strictEqual(at(12)[0].velocity, 65);
  assert.strictEqual(at(15)[0].pitch, 'C2');
});

check('strict grid: wrong beat count throws', () => {
  assert.throws(() => parseSong(['1 2 3'], songConfig), /expected 4 beats/);
});

console.log('\nyaml loader — round-trip:');

check('parse ↔ stringify a nested doc, preserving F#4 and quoted colons', () => {
  const doc = {
    meta: { title: 'x', bpm: 100, note: 'a: b' },
    options: { beatsPerMeasure: 3 },
    tracks: [{ name: 'L', channel: 1, config: { root: 'C' }, measures: ['{~,F#4} ~ ~'] }],
  };
  const back = parseYaml(stringifySong(doc));
  assert.deepStrictEqual(back, doc);
});

console.log('\ncompileDoc + exporter — example YAML (multitrack):');

const exampleYaml = fs.readFileSync(path.join(__dirname, 'examples/my-score.play.yaml'), 'utf8');
const compiled = compileDoc(parseYaml(exampleYaml));

check('example compiles to 2 tracks on channels 1 and 2', () => {
  assert.strictEqual(compiled.tracks.length, 2);
  assert.strictEqual(compiled.tracks[0].channel, 1);
  assert.strictEqual(compiled.tracks[1].channel, 2);
  assert.strictEqual(compiled.bpm, 120);
});

check('lead track matches the inline canonical score', () => {
  assert.strictEqual(compiled.tracks[0].timeline[0].pitch, 'C4');
});

check('bass track (octave 2) plays low root C2', () => {
  assert.strictEqual(compiled.tracks[1].timeline[0].pitch, 'C2');
});

check('multitrack export → format 1 SMF with conductor + 2 tracks', () => {
  const buf = encodeMidi(compiled, { bpm: compiled.bpm });
  assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'MThd');
  assert.strictEqual(buf.readUInt16BE(8), 1); // format 1
  assert.strictEqual(buf.readUInt16BE(10), 3); // conductor + 2 tracks
  assert.strictEqual(buf.slice(14, 18).toString('ascii'), 'MTrk');
});

check('single flat timeline still exports → format 0', () => {
  const buf = encodeMidi(tl, { bpm: 120 });
  assert.strictEqual(buf.readUInt16BE(8), 0);
  assert.strictEqual(buf.readUInt16BE(10), 1);
});

console.log(`\n${passed} checks passed.`);
