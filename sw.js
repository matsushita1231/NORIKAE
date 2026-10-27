// アプリ本体だけキャッシュして、オフラインでも開けるようにする（ODPTの応答はキャッシュしない）
const CACHE = 'densha-map-v3';
const ASSETS = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest',
  'js/network.js', 'js/timetable.js', 'js/odpt.js', 'js/bus.js', 'js/zoom.js', 'js/app.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
