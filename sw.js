// Guarda la app (no los datos) para que funcione sin conexión.
// Al publicar una versión nueva, cambiá el número de CACHE.
const CACHE = 'finanzas-v13';
const ASSETS = ['./', './index.html', './app.js', './chart.umd.js', './pdf.min.mjs', './pdf.worker.min.mjs', './styles.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const network = fetch(req).then(async (res) => {
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached || network));
  e.waitUntil(network.then(() => {}, () => {}));
});
