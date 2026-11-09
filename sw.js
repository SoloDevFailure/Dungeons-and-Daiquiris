'use strict';
// Immutable release URLs keep each page's scripts consistent, even under an older worker.
const RELEASE='11';
const CACHE_PREFIX='dungeons-daiquiris-shell-';
const CACHE_NAME=`${CACHE_PREFIX}v${RELEASE}`;
const ASSETS=[
  './','./index.html','./presentation.html',
  ...['styles.css','presentation.css','config.js','session-ui.js','presentation.js',
    'services/supabase.js','services/session.js','services/connection.js','services/qr.js',
    'services/presentation-view.js','app.js','pwa.js','services/storage.js','services/display-pairing.js','services/ingredients.js',
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
  if(event.request.url===INSTALL_URL){event.respondWith(caches.open(INSTALL_CACHE).then(async cache=>await cache.match(INSTALL_URL)||fetch(new URL('./presentation.webmanifest',self.registration.scope))));return;}
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
// Personalised install metadata stays in a same-origin worker cache. The start URL
// contains only the read capability, never a host identity or privileged credential.
const INSTALL_CACHE='dungeons-daiquiris-display-install-v1';
const INSTALL_URL=new URL('./presentation-install.webmanifest',self.registration.scope).href;
self.addEventListener('message',event=>{
  if(event.data?.type!=='D20_DISPLAY_INSTALL')return;
  event.waitUntil((async()=>{
    try{
      const expected=new URL('./presentation.html',self.registration.scope),source=new URL(event.source.url),start=new URL(event.data.startUrl);
      const params=new URLSearchParams(start.hash.slice(1));
      if(source.origin!==expected.origin||source.pathname!==expected.pathname||start.origin!==expected.origin||start.pathname!==expected.pathname||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(params.get('session')||'')||!/^[0-9a-f]{64}$/.test(params.get('view')||'')||[...params.keys()].some(k=>!['session','view'].includes(k)))throw Error('Invalid pairing');
      // Rebuild the URL explicitly, stripping any unrecognised query/fragment data.
      expected.searchParams.set('release',RELEASE);expected.hash=new URLSearchParams({session:params.get('session'),view:params.get('view')}).toString();
      const shell=await caches.open(CACHE_NAME),templateURL=new URL('./presentation.webmanifest',self.registration.scope).href;
      const template=await shell.match(templateURL)||await fetch(templateURL),manifest=await template.json();
      manifest.start_url=expected.href;
      const cache=await caches.open(INSTALL_CACHE);
      await cache.put(INSTALL_URL,new Response(JSON.stringify(manifest),{headers:{'Content-Type':'application/manifest+json','Cache-Control':'no-store'}}));
      event.ports?.[0]?.postMessage({url:INSTALL_URL});
    }catch{event.ports?.[0]?.postMessage({error:'Pairing manifest unavailable'});}
  })());
});
