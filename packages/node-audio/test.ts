/**
 * test.ts — the audio the graph actually makes.
 *
 * core's test suite is pure: it compiles scores and inspects events, and never
 * renders a sample. The control bus is DSP, so nothing there can tell whether
 * a reverb send reaches the room or a pan reaches one side, and both are the
 * kind of thing that fails silently. This renders real scores through the same
 * engine the CLI use and measures the result.
 */
import assert from 'assert';
import { OfflineAudioContext } from 'node-web-audio-api';
import { compileDoc, parseYaml, scheduleSong } from '@play.yaml/core';

let passed = 0;
const failed: string[] = [];
function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      failed.push(name);
      console.error(`  ✗ ${name}`);
      console.error(String(error instanceof Error ? error.message : error).replace(/^/gm, '      '));
    });
}

const SR = 22050; // the effects under test are all well below Nyquist here
const SECONDS = 3;

/**
 * Render a one-track score and hand back both channels.
 *
 * The `.slice()` is not tidiness. `getChannelData` returns a view onto memory
 * the native AudioBuffer owns, and once this function returns, nothing holds
 * the buffer — so the view outlives what it points at. It reads fine right up
 * until a GC happens to run in between, at which point it starts returning
 * other people's memory: 1e29 next to a denormal next to zeros. Under load
 * that turned into a test that failed maybe one run in three.
 */
async function render(yaml: string): Promise<{ left: Float32Array; right: Float32Array }> {
  const song = compileDoc(parseYaml(yaml));
  const ctx = new OfflineAudioContext(2, SR * SECONDS, SR);
  scheduleSong(ctx, ctx.destination, song, { originTime: 0 });
  const buffer = await ctx.startRendering();
  return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice() };
}

function rms(data: Float32Array, fromSec = 0, toSec = SECONDS): number {
  const from = Math.floor(fromSec * SR);
  const to = Math.min(data.length, Math.floor(toSec * SR));
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** One short note at the top of the bar, then two beats of silence to ring into. */
const score = (set: string) => `
tempo: 120
preset: piano
play:
  - "c4 ~ ~ ~"
${set ? `set: ${set}\n` : ''}`;

/** Something broadband enough to hear a whole room, rather than one pitch. */
const passage = (set: string) => `
tempo: 120
preset: piano
play:
  - "[c3 e4 g4] ~ [f3 a4 c5] ~"
  - "[g2 b3 d4] ~ [c3 e4 g4] ~"
${set ? `set: ${set}\n` : ''}`;

async function main(): Promise<void> {
  console.log('mix controls (rendered):');

  await check('a score with no mix controls still makes sound', async () => {
    const dry = await render(score(''));
    assert.ok(rms(dry.left) > 0.001, `expected audio, got rms ${rms(dry.left)}`);
  });

  await check('CC91 puts energy in the tail after the note has stopped', async () => {
    const dry = await render(score('dry'));
    const wet = await render(score('cathedral'));
    // Well after the note's own decay — anything here arrived via the room.
    const dryTail = rms(dry.left, 1.6, 3);
    const wetTail = rms(wet.left, 1.6, 3);
    assert.ok(wetTail > dryTail * 2, `tail did not grow: dry ${dryTail}, wet ${wetTail}`);
  });

  await check('the room is the same room every render', async () => {
    // A random impulse response would make every render — and every golden
    // digest and browser/CLI parity check — differ from the last.
    const a = await render(score('hall'));
    const b = await render(score('hall'));
    assert.deepStrictEqual([...a.left.slice(0, 4096)], [...b.left.slice(0, 4096)]);
  });

  await check('the room stays behind the player, not off to one side', async () => {
    // The two IR channels carry different noise so the tail is wide, and that
    // is only right if their *levels* still match — one seed reused, or a
    // normalisation that treats the channels differently, would swing a
    // reverbed track off centre. Measured on chords: a single sustained tone
    // probes one frequency of a noise tail and reads several dB out either
    // way, which says nothing about where the room sits.
    for (const word of ['hall', 'cathedral']) {
      const wet = await render(passage(word));
      const imbalance = 20 * Math.log10(rms(wet.right) / rms(wet.left));
      assert.ok(Math.abs(imbalance) < 3, `"${word}" pulled ${imbalance.toFixed(2)} dB off centre`);
    }
  });

  await check('CC10 moves the track across the stereo field', async () => {
    const left = await render(score('hard left'));
    const right = await render(score('hard right'));
    assert.ok(rms(left.left) > 0.001, 'hard left is silent');
    assert.ok(rms(left.right) < rms(left.left) / 20, 'hard left leaked into the right');
    assert.ok(rms(right.left) < rms(right.right) / 20, 'hard right leaked into the left');
  });

  await check('pan centre is the same as never panning at all', async () => {
    const plain = await render(score(''));
    const centred = await render(score('pan centre'));
    assert.ok(
      Math.abs(rms(plain.left) - rms(centred.left)) < rms(plain.left) * 0.02,
      `centring changed the level: ${rms(plain.left)} → ${rms(centred.left)}`,
    );
  });

  await check('CC7 is a fader, and full is unity', async () => {
    const full = await render(score('volume 127'));
    const half = await render(score('volume 64'));
    const plain = await render(score(''));
    assert.ok(
      Math.abs(rms(full.left) - rms(plain.left)) < rms(plain.left) * 0.02,
      'volume 127 should be the same as no volume at all',
    );
    // Half-way up the fader is well under half the amplitude: the CC is
    // curved so the travel feels even to the ear.
    const ratio = rms(half.left) / rms(full.left);
    assert.ok(ratio > 0 && ratio < 64 / 127, `volume 64 sat at ${ratio.toFixed(3)} of full, expected a curve below linear`);
  });

  await check('a control at bar 1 is the state the score opens in, not a move', async () => {
    // Glided in, the first ~200 ms would sound at the default: full level and
    // centred. Rendering starts exactly at the origin, so it would be the
    // first thing you hear.
    const opening = await render(score('hard left, volume 0'));
    assert.ok(rms(opening.left, 0, 0.3) < 1e-4, 'the fader had not arrived by the first note');
    assert.ok(rms(opening.right, 0, 0.3) < 1e-4, 'the pan had not arrived by the first note');
  });

  await check('CC93 thickens the note without making it much louder', async () => {
    const plain = await render(score('no chorus'));
    const wide = await render(score('wide chorus'));
    const body = (d: Float32Array) => rms(d, 0, 1);
    // The wet path is delayed copies of the same signal: it must change the
    // waveform, but a chorus that doubles the level is a volume control.
    assert.ok(body(wide.left) > body(plain.left) * 1.02, 'chorus added nothing');
    assert.ok(body(wide.left) < body(plain.left) * 2, 'chorus is behaving like a gain');
    let differs = 0;
    for (let i = 0; i < SR; i++) if (Math.abs(wide.left[i] - plain.left[i]) > 1e-4) differs++;
    assert.ok(differs > SR / 10, 'chorus did not change the waveform');
  });

  await check('panning moves the image without changing the loudness', async () => {
    // Constant power across the sweep: what leaves the track is the same
    // amount of sound wherever it is standing.
    const power = (r: { left: Float32Array; right: Float32Array }) =>
      Math.sqrt(rms(r.left) ** 2 + rms(r.right) ** 2);
    const centre = power(await render(score('pan centre')));
    for (const word of ['pan left', 'pan right', 'hard left', 'hard right']) {
      const moved = power(await render(score(word)));
      assert.ok(
        Math.abs(moved - centre) < centre * 0.06,
        `"${word}" changed the level: ${centre.toFixed(5)} → ${moved.toFixed(5)}`,
      );
    }
  });

  await check('pan means the same thing with a chorus in front of it', async () => {
    // The panner's law depends on its input's channel count, and the chorus
    // is what turns a mono track stereo — so this is where a pan that only
    // works on bare tracks shows up.
    const plain = await render(score('hard left'));
    const chorused = await render(score('wide chorus, hard left'));
    const power = (r: { left: Float32Array; right: Float32Array }) =>
      Math.sqrt(rms(r.left) ** 2 + rms(r.right) ** 2);
    assert.ok(
      power(chorused) < power(plain) * 1.5,
      `chorus + pan ran away: ${power(plain).toFixed(5)} → ${power(chorused).toFixed(5)}`,
    );
    assert.ok(rms(chorused.left) > rms(chorused.right) * 2, 'the pan was lost behind the chorus');
  });

  await check('the mix controls stack on one track', async () => {
    const both = await render(score('hall, pan left, chorus, volume 100'));
    assert.ok(rms(both.left) > 0.001 && rms(both.right) > 0.001);
    assert.ok(rms(both.left) > rms(both.right), 'pan left did not survive the other stages');
  });

  console.log(`\n${passed} checks passed.`);
  if (failed.length) {
    console.error(`${failed.length} failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

void main();
