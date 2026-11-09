'use strict';
// Bump this version whenever shipped assets change. Never touch localStorage.
const CACHE_PREFIX = 'dungeons-daiquiris-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v8`;
const ASSETS = [
  './', './index.html', './presentation.html', './styles.css', './presentation.css?v=7',
  './config.js', './session-ui.js', './presentation.js?v=7', './services/supabase.js', './services/session.js', './services/connection.js', './services/qr.js', './services/presentation-view.js?v=7',
  './assets/presentation/tavern-backdrop.png', './assets/presentation/three-d20.svg', './assets/presentation/cocktail-placeholder.svg',
  './app.js', './pwa.js', './manifest.webmanifest', './presentation.webmanifest',
  './services/storage.js', './services/ingredients.js', './services/drink-generator.js',
  './services/gameplay.js', './services/serving-settings.js', './services/drink-history.js', './services/ai-service.js',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  // A new version waits until existing windows close, avoiding mid-game updates.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.hash = '';
  if (event.request.method !== 'GET' || !ASSET_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Serve one consistent release. The worker update check installs newer assets.
    return await cache.match(url.href) || fetch(event.request);
  })());
});
