import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
        export: resolve(__dirname, 'src/export.ts'),
        fidelity: resolve(__dirname, 'src/fidelity.ts'),
        'import-midi': resolve(__dirname, 'src/import-midi.ts'),
      },
      formats: ['cjs', 'es'],
      fileName: (format, entryName) => {
        if (format === 'es') {
          return `${entryName}.js`;
        }
        return `${entryName}.cjs`;
      },
    },
    rollupOptions: {
      external: [
        'fs',
        'path',
        'assert',
        'url',
        '@play.yaml/node-audio',
        '@play.yaml/core',
        'easymidi',
      ],
      output: {
        banner: (chunk) => {
          if (['cli', 'export', 'fidelity', 'import-midi'].includes(chunk.name)) {
            return '#!/usr/bin/env node\n';
          }
          return '';
        },
      },
    },
    target: 'node16',
    minify: false,
  },
});
