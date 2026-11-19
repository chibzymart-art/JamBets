/* Oddsbanta app service worker (scope /).
 *
 * What it does, and nothing more:
 *  1. Keeps a tiny offline screen (/offline.html, about 10 KB) on the phone.
 *  2. When a PAGE fails to load because there is no connection, shows that offline screen.
 *
 * What it never does:
 *  - It never caches or answers /api/* (feeds, predictions, auth, payments), Supabase, or any other
 *    site. Those requests are not touched at all, so predictions are always fresh from the network.
 *  - It never stores pages or JavaScript. A page is always loaded from the network first; the
 *    offline screen is used only when that load fails.
 *
 * It also loads the Banter Hub push handlers (banter-sw.js) so Banter notifications keep working if
 * the browser picks this worker for /play pages. Bump CACHE_VERSION when offline.html changes.
 */
importScripts('/banter-sw.js');

const CACHE_VERSION = 'oddsbanta-offline-v1';
const OFFLINE_URL = '/offline.html';
const OFFLINE_ASSETS = [OFFLINE_URL]; // the icon is inlined in offline.html, so one file is enough

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(OFFLINE_ASSETS.map((u) => new Request(u, { cache: 'reload' })))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('oddsbanta-offline-') && k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only full page loads. Everything else (API, feeds, scripts, images, Supabase) is left alone.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req).catch(() =>
      caches.match(OFFLINE_URL).then((res) => res || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } })),
    ),
  );
});
