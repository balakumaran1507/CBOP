const CACHE_NAME = 'cbop-v2'
const STATIC_ASSETS = ['/', '/login', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    return
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone))
        return res
      })
      .catch(() =>
        caches.match(e.request).then(cached =>
          cached || new Response(
            '<html><body style="font-family:Inter,sans-serif;background:#16191F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center"><h2>You\'re offline</h2><p style="color:#888">CBOP needs a connection to load live data.</p></div></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          )
        )
      )
  )
})
