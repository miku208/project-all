'use strict';
const CACHE_NAME = 'miku-music-v1';
const SHELL_FILES = ['./', './index.html', './style.css', './app.js', './manifest.json', './assets/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Cache-first for the app shell only; everything else (API calls, audio) goes to the network untouched.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '')));
  if (event.request.method !== 'GET' || !isShellFile) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
