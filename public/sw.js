/*
 * Dollarvault service worker — makes the app installable and resilient offline.
 *
 * Strategy:
 *  - Same-origin only. Cross-origin traffic (Deriv WebSocket / REST) is never
 *    intercepted, so live trading always goes straight to the network.
 *  - Navigations (HTML): network-first with a cached app-shell fallback so a
 *    new deploy is picked up immediately but the shell still loads offline.
 *  - Static assets (JS/CSS/images, content-hashed): cache-first, then network
 *    (hashed URLs are immutable, so this is safe and fast).
 */
const CACHE = 'dollarvault-shell-v1';
const SHELL = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/icon-192.png',
    '/icon-512.png',
    '/favicon.svg',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then(cache => cache.addAll(SHELL).catch(() => undefined))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try {
        url = new URL(req.url);
    } catch {
        return;
    }
    // Only handle same-origin requests; leave API/WebSocket traffic alone.
    if (url.origin !== self.location.origin) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(res => {
                    const copy = res.clone();
                    caches.open(CACHE).then(cache => cache.put('/index.html', copy)).catch(() => undefined);
                    return res;
                })
                .catch(() => caches.match('/index.html').then(r => r || Response.error()))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => undefined);
                }
                return res;
            }).catch(() => cached || Response.error());
        })
    );
});
