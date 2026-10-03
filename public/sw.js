/* eslint-env serviceworker */
/**
 * Offline shell for Panel36.
 *
 * The application has no server behind it: projects live in this browser and the whole point of
 * the release is that it keeps working without a network. A service worker is what makes that true
 * for the *shell* as well — without one, an installed app still fails to open on a train.
 *
 * Two rules shape everything here:
 *
 * 1. A navigation is always tried from the network first, because the app is an SPA whose routes
 *    are indistinguishable from each other: answering from the cache would hand back a stale
 *    document and hide a newly deployed build indefinitely.
 * 2. Hashed build assets are immutable, so they are cached forever and served cache-first. They
 *    are the only thing that makes the second load fast.
 *
 * The cache name carries the application revision. A new build changes the name, the old caches
 * are deleted on `activate`, and a stale chunk can never be served against a new document.
 * `APP_VERSION` is the only thing that has to be bumped, and the app already bumps it for release.
 */
const VERSION = '0.3.0'
const SHELL_CACHE = `panel36-shell-${VERSION}`
const ASSET_CACHE = `panel36-assets-${VERSION}`

const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // One missing file must not fail the whole install: the shell is a convenience, and an
    // offline app that refuses to activate because of a 404 is worse than a slightly slower one.
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('panel36-') && !name.endsWith(VERSION)).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

const isAsset = (url) => url.pathname.startsWith('/assets/') || url.pathname.startsWith('/models/')

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request)
      } catch {
        const cache = await caches.open(SHELL_CACHE)
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
      }
    })())
    return
  }

  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE)
      const hit = await cache.match(request)
      if (hit) return hit
      const response = await fetch(request)
      // Only full responses are worth keeping: a 206 or an opaque reply would poison the cache.
      if (response.ok && response.type === 'basic') void cache.put(request, response.clone())
      return response
    })())
  }
})
