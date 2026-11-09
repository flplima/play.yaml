/**
 * serverMiddleware.ts — dev-server and production middleware for @play.yaml/web:
 * the Virtual Playing Orchestra served off local disk, one file at a time
 * (/vpo/*). All score playback happens client-side in the browser.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { resolveVpoFile, vpoRoot } from '../node-audio/src/vpoDisk';

const VPO_MIME: Record<string, string> = {
  '.sfz': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

/**
 * The VPO library, served to the browser one file at a time. The studio's
 * sampler parses the `.sfz` program a track needs and fetches each `.wav`
 * the score turns out to reach.
 */
function serveVpo(url: string, req: IncomingMessage, res: ServerResponse): void {
  const root = vpoRoot();
  const relative = decodeURIComponent(url.slice('/vpo/'.length));
  const ext = path.extname(relative).toLowerCase();
  if (!VPO_MIME[ext]) {
    res.statusCode = 403;
    return void res.end('forbidden');
  }
  const file = resolveVpoFile(root, relative);
  let stat: fs.Stats | null = null;
  try {
    stat = file ? fs.statSync(file) : null;
  } catch {
    stat = null;
  }
  if (!file || !stat?.isFile()) {
    res.statusCode = 404;
    return void res.end(`not in the VPO library at ${root}`);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', VPO_MIME[ext]);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(file).pipe(res);
}

export function playYamlApiMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = (req.url || '').split('?')[0];
  if (url.startsWith('/vpo/')) return serveVpo(url, req, res);
  return next();
}

export function playYamlServerPlugin(): Plugin {
  return {
    name: 'play-yaml-server-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(playYamlApiMiddleware);
    },
  };
}
