const CACHE_NAME = "assetflow-app-shell-v2"
const APP_SHELL = ["/", "/index.html"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache API responses; attendance synchronization must always reach the API
  // when connectivity is available.
  if (url.pathname.startsWith("/api/")) return

  const isNavigation = request.mode === "navigate"

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {})
        }
        return response
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached
          // Substituting the cached HTML shell only makes sense for a page
          // navigation. Doing it for a JS/CSS asset request that was never
          // cached (e.g. a lazy route chunk nobody has opened on this
          // device yet) hands back an HTML document where a script was
          // expected — the browser then fails trying to parse it as a
          // module, which is worse than just letting the fetch fail.
          if (isNavigation) return caches.match("/index.html")
          return Response.error()
        })
      )
  )
})
