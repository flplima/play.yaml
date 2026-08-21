/**
 * server.ts — the production server for @play.yaml/web.
 *
 * `vite build` emits only the client bundle. The studio's server side — the
 * `/api/server-*` routes, the SSE snapshot stream, offline rendering and MIDI
 * output — lived solely in a Vite *dev-server* plugin, so a built bundle served
 * as static files had a UI with no engine behind it and `vite preview` did not
 * help (it does not run `configureServer`).
 *
 * This mounts the very same handler the dev plugin uses
 * (`playYamlApiMiddleware`, extracted in serverMiddleware.ts) in front of the
 * built assets, so dev and production run one implementation.
 *
 * TLS and the public hostname are Caddy's job; this binds to loopback.
 *
 *   PORT=4851 HOST=127.0.0.1 npm run serve -w @play.yaml/web
 */
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playYamlApiMiddleware, shutdownServerPlayback } from './serverMiddleware';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.PLAY_YAML_DIST ?? path.join(HERE, 'dist');
const PORT = Number(process.env.PORT ?? 4851);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`play.yaml: no build at ${DIST} — run \`npm run build\` first.`);
  process.exit(1);
}

function sendFile(res: import('node:http').ServerResponse, file: string, status = 200): void {
  const ext = path.extname(file).toLowerCase();
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  // Vite fingerprints everything under /assets, so those are immutable;
  // index.html must not be cached or a deploy never reaches the browser.
  res.setHeader(
    'Cache-Control',
    file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  fs.createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  // The API handler calls next() for anything it does not own.
  void playYamlApiMiddleware(req, res, () => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    // Resolve inside DIST and verify, so `..` cannot escape the build dir.
    const candidate = path.resolve(DIST, '.' + path.posix.normalize(urlPath));
    if (candidate !== DIST && !candidate.startsWith(DIST + path.sep)) {
      res.statusCode = 403;
      return res.end('forbidden');
    }

    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return sendFile(res, candidate);
    }

    // Single-page app: unknown paths are client routes, not 404s. Asset
    // requests are excluded so a missing bundle fails loudly instead of
    // silently returning HTML.
    if (!urlPath.startsWith('/assets/') && !path.extname(urlPath)) {
      return sendFile(res, path.join(DIST, 'index.html'));
    }

    res.statusCode = 404;
    res.end('not found');
  });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shutdownServerPlayback();
    server.close(() => process.exit(0));
    // Don't let an open SSE stream hold the process open forever.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`play.yaml web serving ${DIST} on http://${HOST}:${PORT}`);
});
