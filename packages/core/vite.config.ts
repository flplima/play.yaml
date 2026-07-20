import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
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
      external: ['fs', 'path', 'assert', 'url'],
    },
    target: 'node16',
    minify: false,
  },
  plugins: [
    dts({
      rollupTypes: false,
      entryRoot: 'src',
      include: ['src'],
    }),
  ],
});
