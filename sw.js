/* IronTrack service worker.
   - Serves the app from the device cache, so it opens instantly and works offline.
   - The page sends 'check' on launch and whenever it returns to the foreground;
     the worker then downloads index.html and, if it changed, stores it and
     replies 'update-ready' so the page can offer a reload. */
const CACHE = 'aurum-pilot-v2';
const INDEX = './index.html';
const ASSETS = ['./', INDEX, './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './aurum-mark.svg', './club.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Returns true when a new version of the page was downloaded. */
async function refreshIndex(){
  const cache = await caches.open(CACHE);
  const res = await fetch(INDEX, { cache:'no-cache' }).catch(() => null);
  if(!res || !res.ok) return false;
  const cached = await cache.match(INDEX);
  const changed = !cached || (await cached.text()) !== (await res.clone().text());
  if(changed) await cache.put(INDEX, res);
  return changed && !!cached;
}

self.addEventListener('message', e => {
  if(e.data !== 'check') return;
  e.waitUntil(refreshIndex().then(updated => { if(updated && e.source) e.source.postMessage('update-ready'); }));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // Club news and classes: always try the network first so coaches' updates show up.
  if(url.pathname.endsWith('/club.json')){
    e.respondWith(fetch(req).then(res => { if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put('./club.json', copy)); } return res; })
      .catch(() => caches.match('./club.json').then(r => r || new Response('{}', { headers:{ 'Content-Type':'application/json' } }))));
    return;
  }
  // The coach console and the signing key are never cached or served offline.
  if(/\/(admin\.html|pilot-signing-key\.json)$/.test(url.pathname)) return;
  // Only the app's own pages open from the cache; any other file (e.g. demo.mp4) goes to the network.
  const appPage = url.pathname === new URL('./', self.registration.scope).pathname || url.pathname.endsWith('/index.html');
  if(req.mode === 'navigate' && !appPage) return;
  if(req.mode === 'navigate'){
    e.respondWith(caches.match(INDEX).then(cached => cached || fetch(req).catch(() =>
      new Response('You’re offline and Aurum Training hasn’t been saved to this device yet.', { status:503, headers:{ 'Content-Type':'text/plain; charset=utf-8' } }))));
    return;
  }
  // Other files (icons, manifest): cache first, refresh in the background.
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(url.pathname === '/' ? './' : req, { ignoreSearch:true });
    const refresh = fetch(req).then(res => { if(res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if(cached){ e.waitUntil(refresh); return cached; }
    return (await refresh) || new Response('', { status:504 });
  }));
});
