/**
 * serverMiddleware.ts — dev-server and production middleware for @play.yaml/web.
 *
 * Provides static asset serving for the Virtual Playing Orchestra (/vpo/*)
 * off local disk and exposes rack metadata (/api/server-rack) for Jukebox
 * discovery. All score playback is handled client-side in the browser.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RackChannels } from '@play.yaml/core';

export function vpoRoot(): string {
  return path.resolve(
    process.env.PLAY_YAML_VPO ?? path.join(os.homedir(), 'samples/VPO/Virtual-Playing-Orchestra3'),
  );
}

export function resolveVpoFile(root: string, relative: string): string | null {
  const parts = relative.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  let current = root;
  for (const part of parts) {
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return null;
    }
    const folded = part.toLowerCase();
    const match = entries.find((e) => e.toLowerCase() === folded);
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
}

// ────────────────────────────── the rack's caches ──────────────────────────────

function cacheFile(name: string): string {
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cache, 'jukebox', name);
}

const cacheReads = new Map<string, { mtime: number; value: unknown }>();

function readCache<T>(name: string): { value: T | null; error: string } {
  const file = cacheFile(name);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const held = cacheReads.get(file);
    if (held && held.mtime === mtime) return { value: held.value as T, error: '' };
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    cacheReads.set(file, { mtime, value });
    return { value, error: '' };
  } catch (err: any) {
    cacheReads.delete(file);
    return {
      value: null,
      error: err?.code === 'ENOENT'
        ? `no rack has published to ${file} — start jukebox to see its instruments`
        : String(err?.message ?? err),
    };
  }
}

export function readRackChannels(): { rack: RackChannels | null; error: string } {
  const { value, error } = readCache<RackChannels>('channels.json');
  return { rack: value, error };
}

export function readSurfaceCatalogue(): { catalogue: unknown; error: string } {
  const { value, error } = readCache<unknown>('surfaces.json');
  return { catalogue: value, error };
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const VPO_MIME: Record<string, string> = {
  '.sfz': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

/**
 * The VPO library, served to the browser one file at a time.
 *
 * The studio's sampler reads the same `.sfz` programs the rack does and
 * fetches each `.wav` the score turns out to need.
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

/**
 * API middleware for VPO static assets and rack discovery.
 */
export async function playYamlApiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = (req.url || '').split('?')[0];
  if (url.startsWith('/vpo/')) return serveVpo(url, req, res);

  // Everything the studio needs to know about the rack: the channel map, the
  // surfaces, and whether the VPO library is here for in-browser samples.
  if ((url === '/api/server-rack' || url === '/api/rack') && req.method === 'GET') {
    const channels = readRackChannels();
    const surfaces = readSurfaceCatalogue();
    return json(res, {
      available: Boolean(channels.rack),
      error: channels.error || surfaces.error,
      rack: channels.rack,
      catalogue: surfaces.catalogue,
      vpo: { available: fs.existsSync(vpoRoot()), root: vpoRoot() },
    });
  }

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
