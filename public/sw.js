const CACHE_NAME = 'cbop-v8'
const STATIC_ASSETS = ['/icons/icon-192.png', '/icons/icon-512.png', '/manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      ),
      self.clients.claim(),
    ])
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // API requests — network-first, offline returns JSON error
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    return
  }

  // Next.js static assets — network-first so the webpack runtime never goes stale.
  // (webpack.js is not content-hashed; a cached stale version causes "z is not a function".)
  // On LAN this adds negligible latency; fall back to cache only when offline.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
        }
        return res
      }).catch(() => caches.match(e.request))
    )
    return
  }

  // Static assets (icons, manifest)
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
          }
          return res
        })
      })
    )
    return
  }

  // HTML page routes — always network, never cache (prevents stale build issues)
  e.respondWith(
    fetch(e.request).catch(() =>
      new Response(
        '<html><body style="font-family:Inter,sans-serif;background:#16191F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center"><h2>You\'re offline</h2><p style="color:#888">CBOP needs a connection to load.</p></div></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      )
    )
  )
})
