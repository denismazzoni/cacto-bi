/* Service worker do app de Expedição & Separação.
   Cache-first no shell para o app abrir e operar sem rede no galpão.
   Requisições ao Apps Script nunca são cacheadas. */
const CACHE = 'cacto-exp-v2';
const SHELL = [
  './expedicao.html',
  './vendor/jsQR.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  if(req.url.includes('script.google.com') || req.url.includes('docs.google.com')) return;

  e.respondWith(
    caches.match(req).then(hit => {
      const rede = fetch(req).then(res => {
        if(res && res.ok && (res.type === 'basic' || res.type === 'cors')){
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return res;
      }).catch(() => hit);
      return hit || rede;
    })
  );
});
