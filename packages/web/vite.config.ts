import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { parseYaml } from '../core/src/index';
import { playYamlServerPlugin } from './serverMiddleware';

/**
 * `virtual:score-titles`: file name → the score's `title:`, read at build time
 * from the repo-root examples/ and songs/. The picker needs every title up
 * front, but not the scores' text (≈440 KB), which loads when a score is picked.
 */
function scoreTitlesPlugin(): Plugin {
  const id = 'virtual:score-titles';
  const root = resolve(__dirname, '../..');
  const files = (): string[] => [
    ...readdirSync(resolve(root, 'examples')).map((f) => resolve(root, 'examples', f)),
    ...readdirSync(resolve(root, 'songs'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(resolve(root, 'songs', d.name)).map((f) => resolve(root, 'songs', d.name, f))),
  ].filter((f) => f.endsWith('.play.yaml'));
  return {
    name: 'play-yaml-score-titles',
    resolveId: (source: string) => (source === id ? '\0' + id : null),
    load(resolved: string) {
      if (resolved !== '\0' + id) return null;
      const titles: Record<string, string> = {};
      for (const f of files()) {
        this.addWatchFile(f);
        try {
          const title = parseYaml(readFileSync(f, 'utf8'))?.title;
          if (typeof title === 'string' && title) titles[f.split('/').pop()!.replace(/\.play\.yaml$/, '')] = title;
        } catch { /* a score that does not parse has no title */ }
      }
      return `export default ${JSON.stringify(titles)};`;
    },
  };
}

export default defineConfig(({ mode }) => {
  // `loadEnv` rather than import.meta.env: the port is needed here, in the
  // config itself, before any client code exists. '' loads every key, not just
  // the VITE_-prefixed ones.
  const env = loadEnv(mode, __dirname, '');
  const port = Number(env.PORT) || 5173;

  return {
    root: resolve(__dirname),
    // Self-signed HTTPS: WebMIDI and the File System Access API require a
    // secure context, which plain http on a LAN IP is not.
    plugins: [react(), tailwindcss(), basicSsl(), playYamlServerPlugin(), scoreTitlesPlugin()],
    resolve: {
      // Use the core package's source directly (mirrored in tsconfig `paths`),
      // so core edits hot-reload here without a `npm run build -w core`.
      alias: {
        '@play.yaml/core': resolve(__dirname, '../core/src/index.ts'),
        // shadcn's convention, mirrored in tsconfig `paths`.
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port,
      // Fail loudly instead of silently sliding to the next port: a moved port
      // is exactly the confusion this setting exists to avoid.
      strictPort: true,
      host: true, // listen on all interfaces so the LAN can reach the dev server
    },
  };
});
