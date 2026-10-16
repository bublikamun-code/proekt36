import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shouldRegisterServiceWorker } from '../src/services/serviceWorker'
import { APP_VERSION } from '../src/version'

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const environment = (patch: Partial<Parameters<typeof shouldRegisterServiceWorker>[0]> = {}) => ({
  production: true, controlled: false, webdriver: false, supported: true, secureContext: true, ...patch,
})

const allowed = (patch: Partial<Parameters<typeof shouldRegisterServiceWorker>[0]> = {}) =>
  Object.entries(shouldRegisterServiceWorker(environment(patch))).filter(([, value]) => !value).map(([name]) => name)

describe('оффлайн-оболочка', () => {
  it('ставится в production и не ставится больше нигде', () => {
    expect(allowed()).toEqual([])
    // A worker over `vite dev` would serve a cached shell over the dev server, and a worker in an
    // automated browser would make one test run read the document of the previous one.
    expect(allowed({ production: false })).toEqual(['production'])
    expect(allowed({ webdriver: true })).toEqual(['webdriver'])
    // An insecure origin has no service worker at all; localhost counts as secure.
    expect(allowed({ secureContext: false })).toEqual(['secureContext'])
    expect(allowed({ supported: false })).toEqual(['supported'])
    // Re-registering a worker that is already in control would only repeat work.
    expect(allowed({ controlled: true })).toEqual(['controlled'])
  })

  it('версия кэша совпадает с версией приложения', () => {
    // The worker is a static file in `public/` and cannot import the version module, so the string
    // is written out there and pinned here. A new release that forgets the worker would otherwise
    // keep serving the previous build's chunks, and the mismatch is invisible until a user sees
    // a page that references a chunk which no longer exists.
    expect(worker).toContain(`const VERSION = '${APP_VERSION}'`)
  })

  it('имя кэша несёт версию, а активация чистит старые', () => {
    expect(worker).toContain('panel36-shell-${VERSION}')
    expect(worker).toContain('panel36-assets-${VERSION}')
    expect(worker).toContain("name.startsWith('panel36-') && !name.endsWith(VERSION)")
  })

  it('навигация идёт в сеть первой, а неизменяемые файлы — из кэша', () => {
    // A cached answer to a navigation would hide a newly deployed build indefinitely, because
    // every route of the SPA is the same document.
    expect(worker.indexOf("request.mode === 'navigate'")).toBeLessThan(worker.indexOf('isAsset(url)'))
    expect(worker).toContain('return await fetch(request)')
    expect(worker).toContain('const hit = await cache.match(request)')
    expect(worker).toContain("if (hit) return hit")
  })

  it('не кэширует то, что нельзя повторно использовать', () => {
    expect(worker).toContain("if (response.ok && response.type === 'basic')")
    expect(worker).toContain("if (request.method !== 'GET') return")
    expect(worker).toContain("if (url.origin !== self.location.origin) return")
  })

  it('манифест и иконки объявлены, и оболочка их знает', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')) as {
      name: string, start_url: string, display: string, icons: { purpose: string }[]
    }
    expect(manifest.start_url).toBe('/app/projects')
    expect(manifest.display).toBe('standalone')
    // A maskable icon is what lets a launcher crop the mark without cutting into it.
    expect(manifest.icons.map((icon) => icon.purpose)).toContain('maskable')
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    for (const entry of ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg']) {
      expect(worker, `оболочка не знает ${entry}`).toContain(`'${entry}'`)
    }
  })

  it('CSP разрешает worker и не разрешает чужие', () => {
    // Without `worker-src` a registration is blocked outright in a production build, and the
    // failure is silent: the application works and simply is never offline.
    // Read the directive rather than searching the file for it: the comment next to it explains
    // why the directive exists and mentions the blob: form this test must never allow.
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
    const directives = [...config.matchAll(/"(worker-src[^"]*)"/g)].map((match) => match[1])
    expect(directives).toEqual(["worker-src 'self'"])
  })
})
