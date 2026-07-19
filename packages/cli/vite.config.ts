import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
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
        'webaudio-node',
        '@play.yaml/core',
        'easymidi',
      ],
      output: {
        banner: (chunk) => {
          if (chunk.name === 'cli') {
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
