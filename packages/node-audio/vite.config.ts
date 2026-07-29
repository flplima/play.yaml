import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['cjs', 'es'],
      fileName: (format, entryName) => (format === 'es' ? `${entryName}.js` : `${entryName}.cjs`),
    },
    rollupOptions: {
      external: ['fs', 'path', 'child_process', 'node-web-audio-api', '@play.yaml/core'],
    },
    target: 'node18',
    minify: false,
  },
  plugins: [dts({ rollupTypes: false, entryRoot: 'src', include: ['src'] })],
});
