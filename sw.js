// Gestión funciona con internet (los datos están en Supabase). El service worker solo
// guarda la propia app para que abra al instante y se pueda instalar; siempre intenta
// primero la versión más nueva y usa la guardada si no hay red.
const CACHE = 'gestion-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase: siempre a la red
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw new Error('sin conexión');
    }
  })());
});
