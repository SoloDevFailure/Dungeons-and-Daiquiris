'use strict';
// Immutable release URLs keep each page's scripts consistent, even under an older worker.
const RELEASE='10';
const CACHE_PREFIX='dungeons-daiquiris-shell-';
const CACHE_NAME=`${CACHE_PREFIX}v${RELEASE}`;
const ASSETS=[
  './','./index.html','./presentation.html',
  ...['styles.css','presentation.css','config.js','session-ui.js','presentation.js',
    'services/supabase.js','services/session.js','services/connection.js','services/qr.js',
    'services/presentation-view.js','app.js','pwa.js','services/storage.js','services/ingredients.js',
    'services/drink-generator.js','services/gameplay.js','services/analytics.js','services/serving-settings.js',
    'services/drink-history.js','services/ai-service.js'].map(path=>`./${path}?v=${RELEASE}`),
  './assets/presentation/tavern-backdrop.png','./assets/presentation/three-d20.svg','./assets/presentation/cocktail-placeholder.svg',
  './manifest.webmanifest','./presentation.webmanifest','./icons/apple-touch-icon.png',
  './icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png',
];
const ASSET_URLS=new Set(ASSETS.map(path=>new URL(path,self.registration.scope).href));
const DOCUMENT_URLS=new Set(['./','./index.html','./presentation.html'].map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
  // No mid-round forced activation or changes to localStorage.
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);url.hash='';
  const documentURL=new URL(url);documentURL.search='';
  if(DOCUMENT_URLS.has(documentURL.href)){
    event.respondWith((async()=>{
      // A reload gets current HTML; versioned dependencies bypass stale workers/caches.
      try{const response=await fetch(event.request,{cache:'no-store'});if(response.ok)return response;}catch{/* Offline fallback below. */}
      const cache=await caches.open(CACHE_NAME);const saved=await cache.match(documentURL.href);
      if(saved)return saved;
      throw new Error('Presentation is not cached yet. Open once while online.');
    })());return;
  }
  if(!ASSET_URLS.has(url.href))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>await cache.match(url.href)||fetch(event.request)));
});
