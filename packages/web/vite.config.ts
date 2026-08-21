import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { playYamlServerPlugin } from './serverMiddleware';

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
    plugins: [react(), tailwindcss(), basicSsl(), playYamlServerPlugin()],
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
