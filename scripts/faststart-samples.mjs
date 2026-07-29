/**
 * faststart-samples.mjs — move the MP4 `moov` atom to the front of sample files.
 *
 * Browsers buffer a whole .m4a before decoding, so they do not care where the
 * index sits. Node's decoder (Symphonia, via node-web-audio-api) reads as a
 * stream and fails with "missing moov atom" on any file whose index trails the
 * audio — which is why the violin library rendered silent on the server while
 * every other library was fine.
 *
 * This is a lossless container remux: `-c copy` never touches the AAC frames,
 * so the audio is bit-identical and only the atom order changes.
 *
 *   node scripts/faststart-samples.mjs            # report what needs fixing
 *   node scripts/faststart-samples.mjs --write    # remux in place
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve('packages/web/public/samples');
const WRITE = process.argv.includes('--write');

/** True when the file's `moov` atom comes after `mdat`. */
function needsFaststart(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    let offset = 0;
    const size = fs.statSync(file).size;
    while (offset < size - 8) {
      fs.readSync(fd, head, 0, 8, offset);
      const atomSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (type === 'moov') return false; // index first — already streamable
      if (type === 'mdat') return true; // audio first — decoder will choke
      if (atomSize < 8) return false;
      offset += atomSize;
    }
  } finally {
    fs.closeSync(fd);
  }
  return false;
}

if (!fs.existsSync(ROOT)) {
  console.error(`No sample directory at ${ROOT}`);
  process.exit(1);
}

const offenders = [];
for (const library of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, library);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.m4a')) continue;
    const file = path.join(dir, name);
    if (needsFaststart(file)) offenders.push(file);
  }
}

if (!offenders.length) {
  console.log('All samples already have moov first — nothing to do.');
  process.exit(0);
}

const byLibrary = new Map();
for (const f of offenders) {
  const lib = path.basename(path.dirname(f));
  byLibrary.set(lib, (byLibrary.get(lib) ?? 0) + 1);
}
console.log(`${offenders.length} file(s) need faststart:`);
for (const [lib, n] of byLibrary) console.log(`  ${lib}: ${n}`);

if (!WRITE) {
  console.log('\nRe-run with --write to remux them in place (lossless, -c copy).');
  process.exit(0);
}

if (spawnSync('which', ['ffmpeg']).status !== 0) {
  console.error('ffmpeg is required to remux; install it and re-run.');
  process.exit(1);
}

let done = 0;
for (const file of offenders) {
  const tmp = `${file}.faststart.m4a`;
  const result = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-i', file, '-c', 'copy', '-movflags', '+faststart', tmp,
  ]);
  if (result.status !== 0 || !fs.existsSync(tmp)) {
    console.error(`  failed: ${file}`);
    fs.rmSync(tmp, { force: true });
    continue;
  }
  fs.renameSync(tmp, file);
  done++;
}
console.log(`Remuxed ${done}/${offenders.length} file(s).`);
