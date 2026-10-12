// Aplikacja działa bez internetu (np. na stadionie bez zasięgu).
// Po zmianie plików podbij numer wersji, żeby telefony pobrały nowe.
const CACHE = 'zegar-meczu-v1';
const FILES = ['./', 'index.html', 'clock.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Najpierw z pamięci podręcznej, w tle pobranie świeżej wersji.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const network = fetch(event.request)
        .then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
