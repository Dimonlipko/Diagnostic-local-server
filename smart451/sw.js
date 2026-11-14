// Застосунок має працювати в машині без інтернету. Мережа першою: оновлення приходять
// одразу, а кеш потрібен лише тоді, коли мережі нема.
const CACHE = 'smart451-v1';

self.addEventListener('install', () => self.skipWaiting());

// Кеші спільні для всього домену: на diag.electricengines.com.ua поруч живе інший
// застосунок зі своїм кешем, тож прибираємо лише власні старі версії.
self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith('smart451-') && k !== CACHE) await caches.delete(k);
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const r = await fetch(e.request);
            if (r.ok) cache.put(e.request, r.clone());
            return r;
        } catch {
            return (await cache.match(e.request)) ?? (await cache.match('./index.html')) ?? Response.error();
        }
    })());
});
