// Reggy Sosa — Service Worker
// Caches core assets for fast load and offline fallback

const CACHE = 'reggysosa-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/tournaments.html',
  '/merch.html',
  '/rules.html',
  '/profile.html',
  '/style.css',
  '/script.js',
  '/logo.png'
];

// Install: cache core files
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network first, cache fallback
self.addEventListener('fetch', e => {
  // Only handle GET, skip cross-origin API calls
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname !== location.hostname) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
