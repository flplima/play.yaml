/**
 * shared.ts — what the four CLI entry points have in common: reading a score
 * off disk and reading flags off argv.
 */
import * as fs from 'fs';
import * as path from 'path';
import { compileDoc, parseYaml, type CompiledSong } from '@play.yaml/core';

/** Read and compile a `.play.yaml` (or `.json`) score; compileDoc rejects a document with nothing to play. */
export function loadScore(file: string): CompiledSong {
  const resolved = path.resolve(process.cwd(), file);
  const text = fs.readFileSync(resolved, 'utf8');
  return compileDoc(/\.ya?ml$/i.test(file) ? parseYaml(text) : JSON.parse(text));
}

/** One flag: its spellings and what it stores. */
interface FlagSpec {
  names: string[];
  /** The flag takes the next argument as its value. */
  value?: boolean;
  /** Store the spelling that matched, so alternatives share one key and the last one wins (`--flats` / `--sharps`). */
  spelling?: boolean;
}

interface ParsedArgs {
  /** Flag name (the spec key) → its value, or `true` for a switch; absent when not given. */
  flags: Record<string, string | true | undefined>;
  positional: string[];
}

/**
 * Read argv against a spec. Unknown flags are reported and skipped; anything
 * not starting with `-` is positional.
 */
export function parseFlags(argv: string[], spec: Record<string, FlagSpec>): ParsedArgs {
  const byName = new Map<string, [string, FlagSpec]>();
  for (const [key, flag] of Object.entries(spec)) for (const name of flag.names) byName.set(name, [key, flag]);
  const out: ParsedArgs = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const hit = byName.get(a);
    if (hit) {
      const [key, flag] = hit;
      out.flags[key] = flag.value ? argv[++i] : flag.spelling ? a : true;
    } else if (!a.startsWith('-') || a === '-') {
      // A bare `-` is a positional too: the conventional spelling of stdout.
      out.positional.push(a);
    } else {
      console.error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

/** Print help and exit: 0 when the user asked for it, 1 when the command line was unusable. */
export function usage(help: string, asked: unknown): never {
  console.log(help);
  process.exit(asked ? 0 : 1);
}

/** Run a command, reporting a thrown error as one line and a failing exit. */
export function run(main: () => void | Promise<void>): void {
  Promise.resolve()
    .then(main)
    .catch((err: unknown) => {
      console.error(`✗ ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
