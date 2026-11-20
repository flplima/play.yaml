/*
 * sw.js — makes the studio open offline.
 *
 * Paths are relative to the worker's own folder, so the same file works at a
 * domain root and under a subpath (GitHub Pages serves it at /play.yaml/).
 *
 * - navigations: network first, the cached shell (the scope's root) when the
 *   network fails.
 *   A redirect (an expired login on the auth proxy) goes through untouched.
 * - assets/*: fingerprinted by Vite, so cache first, filled as they load and
 *   precached at install from the shell's own <script>/<link> tags.
 * - never touched: vpo/* (big samples, range requests), non-GET, the API.
 *
 * Bump VERSION to drop every old cache on the next activate. A new worker
 * waits for the next load: no skipWaiting, so a score being edited is never
 * pulled out from under the user.
 */
const VERSION = 'v1';
const CACHE = `play-yaml-${VERSION}`;
// '/' at a domain root, '/play.yaml/' on GitHub Pages.
const SHELL = new URL('./', self.location).pathname;
const ASSETS = `${SHELL}assets/`;

// Only a plain 200 from our own origin is worth keeping: never a redirect
// (the login page in disguise), an opaque response or an error.
const cacheable = (res) =>
  res && res.status === 200 && res.type === 'basic' && !res.redirected;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(SHELL, { cache: 'reload', credentials: 'same-origin' });
        if (!cacheable(res)) return;
        await cache.put(SHELL, res.clone());
        const html = await res.text();
        const urls = new Set();
        // '/assets/…' from an absolute base, './assets/…' from a relative one.
        for (const m of html.matchAll(/(?:src|href)="((?:\.?\/)?assets\/[^"]+)"/g)) {
          urls.add(new URL(m[1], new URL(SHELL, self.location)).pathname);
        }
        await Promise.all(
          [...urls].map(async (url) => {
            try {
              const r = await fetch(url, { credentials: 'same-origin' });
              if (cacheable(r)) await cache.put(url, r);
            } catch {
              /* filled on first use instead */
            }
          }),
        );
      } catch {
        /* offline or behind a login: the worker still installs, the cache fills as the app loads */
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('play-yaml-') && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (url.pathname === SHELL && cacheable(res)) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put(SHELL, copy)));
          }
          return res; // includes opaqueredirect: passed through as is
        } catch (err) {
          const cached = await caches.match(SHELL);
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith(ASSETS)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (cacheable(res)) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      })(),
    );
  }
});
