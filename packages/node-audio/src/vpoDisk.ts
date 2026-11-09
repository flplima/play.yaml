/**
 * vpoDisk.ts — where the Virtual Playing Orchestra lives on this machine, and
 * how its files are read off disk. The CLI renders from here; the studio's
 * dev server serves `/vpo/` from here.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SfzAssets } from '@play.yaml/core';

/** The library root: `PLAY_YAML_VPO`, else the documented default under $HOME. */
export function vpoRoot(): string {
  return path.resolve(
    process.env.PLAY_YAML_VPO ?? path.join(os.homedir(), 'samples/VPO/Virtual-Playing-Orchestra3'),
  );
}

/** Is the library installed where `vpoRoot()` points? */
export function vpoInstalled(): boolean {
  return fs.existsSync(vpoRoot());
}

/**
 * A library path → the file on disk, or null if there is none.
 *
 * Case-insensitive on purpose: two dozen of VPO's programs spell a directory
 * `samples/` that the library ships as `Samples/`, which a Windows sampler
 * never notices and a Linux one turns into silence. Each segment is matched
 * exactly first and by case-folded name second, so the exact library never
 * pays for the fix. Anything that escapes the root resolves to null.
 */
export function resolveVpoFile(root: string, relative: string): string | null {
  const parts = relative.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  let current = root;
  for (const part of parts) {
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return null;
    }
    const folded = part.toLowerCase();
    const match = entries.find((e) => e.toLowerCase() === folded);
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
}

/** The library as the sampler reads it: text and bytes by library path. */
export function diskAssets(root: string): SfzAssets {
  const file = (relative: string) => {
    const resolved = resolveVpoFile(root, relative);
    if (!resolved) throw new Error(`${relative} is not in the VPO library at ${root}`);
    return resolved;
  };
  return {
    text: (relative) => fs.promises.readFile(file(relative), 'utf8'),
    audio: async (relative) => {
      const buf = await fs.promises.readFile(file(relative));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
}
