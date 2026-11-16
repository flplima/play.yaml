/**
 * vite.lib.ts — the one library build the Node-side packages share: CommonJS
 * and ES output side by side, unminified, Node as the target, declarations
 * from `src/`.
 */
import { chmodSync } from 'fs';
import { join, resolve } from 'path';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import dts from 'vite-plugin-dts';

export interface LibOptions {
  /** The package directory (pass `__dirname`). */
  root: string;
  /** Entry name → path under the package, e.g. `{ index: 'src/index.ts' }`. */
  entries: Record<string, string>;
  /** Modules left to Node to resolve at runtime. */
  external: string[];
  /** Emit `.d.ts` files (library packages; CLI binaries need none). */
  declarations?: boolean;
  /** Prepend a shebang to these entries, so they run as programs. */
  executables?: string[];
}

export function libConfig(opts: LibOptions): UserConfig {
  const entry = Object.fromEntries(
    Object.entries(opts.entries).map(([name, file]) => [name, resolve(opts.root, file)]),
  );
  return defineConfig({
    build: {
      lib: {
        entry,
        formats: ['cjs', 'es'],
        fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      },
      rollupOptions: {
        external: opts.external,
        output: {
          banner: (chunk) => (opts.executables?.includes(chunk.name) ? '#!/usr/bin/env node\n' : ''),
        },
      },
      target: 'node18',
      minify: false,
    },
    plugins: [
      ...(opts.declarations ? [dts({ rollupTypes: false, entryRoot: 'src', include: ['src'] })] : []),
      executable(opts.executables ?? []),
    ],
  });
}

/** vite empties `dist/` on every build, so the new files lose the execute bit. */
function executable(names: string[]): Plugin {
  return {
    name: 'play-yaml-executable',
    writeBundle(options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && names.includes(chunk.name)) {
          chmodSync(join(options.dir!, chunk.fileName), 0o755);
        }
      }
    },
  };
}
