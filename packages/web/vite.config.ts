import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  // Self-signed HTTPS: WebMIDI and the File System Access API require a
  // secure context, which plain http on a LAN IP is not.
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    host: true, // listen on all interfaces so the LAN can reach the dev server
  },
});
