const CACHE = 'civic-v1'

// Cache the app shell on install
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.add('/')))
  self.skipWaiting()
})

// Remove old caches when a new SW activates
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Network-first: always try to fetch fresh, fall back to cache when offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(cache => cache.put(e.request, copy))
        return res
      })
      .catch(() =>
        caches.match(e.request).then(cached => cached ?? new Response('Offline', { status: 503 }))
      )
  )
})
