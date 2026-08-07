/* ThirdHub Service Worker */
const VERSION = '2.1';
const CACHE_NAME = 'thirdhub-v' + VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css?v=' + VERSION,
  './css/layout.css?v=' + VERSION,
  './css/theme.css?v=' + VERSION,
  './js/app.js?v=' + VERSION,
  './js/store.js?v=' + VERSION,
  './js/ui.js?v=' + VERSION,
  './js/changelog.js?v=' + VERSION
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((cached) => {
        const fetching = fetch(e.request).then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => cached);
        return cached || fetching;
      })
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION') e.ports[0].postMessage({ version: VERSION });
});
