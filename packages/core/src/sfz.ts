/**
 * sfz.ts — reading an SFZ instrument definition.
 *
 * SFZ is the plain-text format the free orchestral libraries are shipped in:
 * a list of `<region>` headers, each naming a sample file and the keys,
 * velocities, controllers and switches that select it, with `<group>` /
 * `<master>` / `<global>` headers above it whose opcodes the region inherits.
 * A file may `#include` others (the "all strings" programs are built that way)
 * and `#define` macros for the paths they share.
 *
 * This is the parser only. It knows nothing about audio: it turns text into a
 * flat list of regions with every opcode resolved, and the sampler decides
 * which of those opcodes it can honour. Environment-free on purpose — the
 * file reader is injected, so the browser fetches over HTTP and the server
 * reads the same library off disk.
 */

/** The opcodes of one region, fully inherited, as the file spelled them. */
export type SfzOpcodes = Record<string, string>;

export interface SfzRegion {
  /** The sample path, relative to the library root, forward slashes. */
  sample: string;
  opcodes: SfzOpcodes;
}

export interface SfzInstrument {
  regions: SfzRegion[];
  /** `<control>` opcodes — `set_ccN` defaults and the like; not inherited. */
  control: SfzOpcodes;
  /** Files this instrument was assembled from — the entry point first. */
  sources: string[];
}

/** How the parser gets at files, by path relative to the library root. */
export type SfzReader = (path: string) => Promise<string>;

const HEADER = /<(\w+)>/g;
/** `opcode=` — an identifier followed by `=`, which is where a value starts. */
const OPCODE_START = /(?:^|\s)([A-Za-z_][\w$]*)=/g;

/** Normalize a path the way SFZ expects: backslashes, `./` and `..` folded. */
export function normalizeSfzPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Resolve `relative` against the directory of `from`. */
export function resolveSfzPath(from: string, relative: string): string {
  const clean = relative.replace(/\\/g, '/');
  return normalizeSfzPath(clean.startsWith('/') ? clean : `${dirname(from)}/${clean}`);
}

/** Strip `//` and `/* *\/` comments, keeping newlines so nothing runs together. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

/**
 * Split a header's body into opcodes.
 *
 * Values are not quoted and may contain spaces — `sample=Solo Cello/C3.wav`
 * is ordinary — so a value runs from its `=` to the start of the next
 * `opcode=`, and only whitespace before an identifier ends one.
 */
function parseOpcodes(body: string, defines: Map<string, string>): SfzOpcodes {
  const opcodes: SfzOpcodes = {};
  const starts: { name: string; valueAt: number; at: number }[] = [];
  OPCODE_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPCODE_START.exec(body))) {
    starts.push({ name: m[1], valueAt: m.index + m[0].length, at: m.index });
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : body.length;
    let value = body.slice(starts[i].valueAt, end).trim();
    if (value.includes('$')) {
      for (const [name, replacement] of defines) value = value.split(name).join(replacement);
    }
    opcodes[starts[i].name.toLowerCase()] = value;
  }
  return opcodes;
}

/**
 * Parse an instrument, following includes.
 *
 * The header hierarchy is the standard one: `<global>` applies to everything
 * after it, `<master>` to the groups after it, `<group>` to the regions after
 * it, and a region's own opcodes win. `<control>` holds `default_path` and
 * the `#define`s. Anything else (`<curve>`, `<effect>`, `<sample>`) is
 * skipped — it describes engine features a sampler here has no use for.
 */
export async function parseSfz(entry: string, read: SfzReader): Promise<SfzInstrument> {
  const regions: SfzRegion[] = [];
  const sources: string[] = [];
  const defines = new Map<string, string>();
  const control: SfzOpcodes = {};

  // The scopes persist across includes: an included file's groups inherit
  // the including file's global, which is how the combined programs work.
  let global: SfzOpcodes = {};
  let master: SfzOpcodes = {};
  let group: SfzOpcodes = {};
  let defaultPath = '';
  let defaultPathFrom = entry;

  const walk = async (file: string): Promise<void> => {
    if (sources.includes(file)) return; // a cycle, or the same part twice
    sources.push(file);
    const text = stripComments(await read(file));

    // Directives first: they are line-based, unlike the free-form headers.
    const lines = text.split('\n');
    const kept: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      const define = /^#define\s+(\$\w+)\s+(.+)$/.exec(line);
      if (define) {
        defines.set(define[1], define[2].trim());
        continue;
      }
      const include = /^#include\s+"([^"]+)"/.exec(line);
      if (include) {
        // Includes are resolved in place: everything before this line is
        // parsed first so the include sees the right group scope.
        await parseBlock(kept.join('\n'), file);
        kept.length = 0;
        await walk(resolveSfzPath(file, include[1]));
        continue;
      }
      kept.push(raw);
    }
    await parseBlock(kept.join('\n'), file);
  };

  const parseBlock = async (text: string, file: string): Promise<void> => {
    HEADER.lastIndex = 0;
    const headers: { name: string; bodyAt: number; at: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = HEADER.exec(text))) headers.push({ name: m[1].toLowerCase(), bodyAt: m.index + m[0].length, at: m.index });
    for (let i = 0; i < headers.length; i++) {
      const end = i + 1 < headers.length ? headers[i + 1].at : text.length;
      const opcodes = parseOpcodes(text.slice(headers[i].bodyAt, end), defines);
      switch (headers[i].name) {
        case 'control':
          Object.assign(control, opcodes);
          if (opcodes.default_path !== undefined) {
            defaultPath = opcodes.default_path;
            defaultPathFrom = file;
          }
          break;
        case 'global':
          global = opcodes;
          master = {};
          group = {};
          break;
        case 'master':
          master = opcodes;
          group = {};
          break;
        case 'group':
          group = opcodes;
          break;
        case 'region': {
          const merged = { ...global, ...master, ...group, ...opcodes };
          if (!merged.sample) break; // a region with nothing to play
          const base = defaultPath ? resolveSfzPath(defaultPathFrom, defaultPath) + '/' : '';
          const sample = defaultPath
            ? normalizeSfzPath(base + merged.sample)
            : resolveSfzPath(file, merged.sample);
          regions.push({ sample, opcodes: merged });
          break;
        }
        default:
          break;
      }
    }
  };

  await walk(normalizeSfzPath(entry));
  return { regions, control, sources };
}

// ---------------------------------------------------------------------------
// Reading opcode values
// ---------------------------------------------------------------------------

const NOTE_NAMES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * A key opcode: a MIDI number, or a note name where C4 is 60 (the SFZ
 * convention; the files here spell `c2`, `f#3`, `bb1`).
 */
export function sfzKey(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  const m = /^([a-gA-G])(#|b)?(-?\d+)$/.exec(v);
  if (!m) return undefined;
  const pc = NOTE_NAMES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

export function sfzNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
