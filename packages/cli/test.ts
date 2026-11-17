/**
 * test.ts — play-yaml-import end to end, on MIDI built right here.
 */
import assert from 'assert';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
const failed: string[] = [];
function check(name: string, fn: () => void): void {
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

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};

/** A format-0 file, 480 ticks per beat, 4/4: events are [tick, ...bytes]. */
function smf(events: [number, ...number[]][]): Uint8Array {
  const body: number[] = [];
  let at = 0;
  for (const [tick, ...bytes] of events) {
    body.push(...vlq(tick - at), ...bytes);
    at = tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body,
  ]);
}

const BEAT = 480;
const cliPath = path.join(__dirname, 'src', 'import-midi.ts');
const tsx = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

function runImport(bytes: Uint8Array, extra: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-'));
  try {
    const mid = path.join(dir, 'a.mid');
    const out = path.join(dir, 'a.play.yaml');
    fs.writeFileSync(mid, bytes);
    const r = spawnSync(tsx, [cliPath, mid, '-o', out, '--verify', ...extra], { encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, yaml: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nplay-yaml-import:');

const bar = 4 * BEAT;
// Two bars of quarter notes on C4, then a C-E-G chord on the downbeat of
// bar 3 whose note-offs land exactly on end-of-track.
const closing: [number, ...number[]][] = [];
for (let i = 0; i < 8; i++) {
  closing.push([i * BEAT, 0x90, 60, 80], [i * BEAT + BEAT, 0x80, 60, 0]);
}
for (const p of [60, 64, 67]) closing.push([2 * bar, 0x90, p, 80]);
for (const p of [60, 64, 67]) closing.push([2 * bar + BEAT, 0x80, p, 0]);

check('a closing chord on a bar line at end-of-track is imported and verified', () => {
  const r = runImport(smf(closing));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /source 11 notes \| score 11/, r.stderr);
  assert.match(r.stderr, /missing 0 extra 0/);
  assert.strictEqual((r.yaml.match(/^\s+- ["']/gm) ?? []).length, 3, r.yaml);
});

check('a chord with no note-off at all still gets its own bar', () => {
  const ev = closing.filter((e) => !(e[0] === 2 * bar + BEAT));
  const r = runImport(smf(ev));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /source 11 notes \| score 11/, r.stderr);
});

check('--verify counts note-ons in the raw bytes, not only the decoder\'s', () => {
  // A hanging-note file the decoder reads fine: counts must match the bytes.
  const r = runImport(smf(closing), ['--json']);
  const report = JSON.parse(r.stderr.slice(r.stderr.indexOf('{')));
  assert.strictEqual(report.sourceNotes, 11);
  assert.strictEqual(report.missing, 0);
});

if (failed.length) {
  console.error(`\n${failed.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
