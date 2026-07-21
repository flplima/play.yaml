import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  // Self-signed HTTPS: WebMIDI and the File System Access API require a
  // secure context, which plain http on a LAN IP is not.
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    // Use the core package's source directly (mirrored in tsconfig `paths`),
    // so core edits hot-reload here without a `npm run build -w core`.
    alias: { '@play.yaml/core': resolve(__dirname, '../core/src/index.ts') },
  },
  server: {
    host: true, // listen on all interfaces so the LAN can reach the dev server
  },
});
