// sw.js
const CACHE = 'calories-pwa-v2'; // <- новое имя кэша
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=3',
  './app.js?v=3',
  './manifest.json?v=3',
];

self.addEventListener('install', e => {
  self.skipWaiting(); // сразу активировать новый SW
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // взять управление сразу
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
