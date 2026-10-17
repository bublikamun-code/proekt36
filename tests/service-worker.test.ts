import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { shouldRegisterServiceWorker, shouldOfferUpdatePrompt, wireUpdateFlow } from '../src/services/serviceWorker'
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

describe('обновление оболочки', () => {
  // Fake worker/registration/container speaking just enough of the real API for wireUpdateFlow.
  const makeHarness = () => {
    const controllerListeners: (() => void)[] = []
    const waiting = {
      state: 'installed',
      posted: [] as unknown[],
      listeners: new Map<string, (() => void)[]>(),
      addEventListener(type: string, listener: () => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]) },
      emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener() },
      postMessage(data: unknown) { this.posted.push(data) },
    }
    const registration = { installing: null, waiting, addEventListener: () => {} }
    const container = {
      controller: {} as unknown,
      getRegistration: async () => registration,
      addEventListener: (_type: 'controllerchange', listener: () => void) => controllerListeners.push(listener),
      controllerChange: () => { for (const listener of controllerListeners) listener() },
    }
    return { waiting, registration, container, controllerListeners }
  }

  it('воркер больше не активирует обновление сам — только по сообщению SKIP_WAITING', () => {
    // Auto-skip would reload work out from under a user mid-edit; the prompt exists precisely
    // to make that a choice, so the install handler must not contain the call at all.
    expect(worker).not.toContain('await self.skipWaiting()')
    expect(worker).toContain("event.data === 'SKIP_WAITING'")
    expect(worker).toContain('self.skipWaiting()')
  })

  it('промпт предлагается только в production-браузере и без явного выключения', () => {
    expect(shouldOfferUpdatePrompt({ production: true, webdriver: false, flag: undefined })).toBe(true)
    expect(shouldOfferUpdatePrompt({ production: true, webdriver: true, flag: undefined })).toBe(false)
    expect(shouldOfferUpdatePrompt({ production: false, webdriver: false, flag: undefined })).toBe(false)
    expect(shouldOfferUpdatePrompt({ production: true, webdriver: false, flag: 'off' })).toBe(false)
  })

  it('сообщает о готовом обновлении и применяет его по согласию', async () => {
    const { waiting, container } = makeHarness()
    const onReady = vi.fn()
    const onControllerChange = vi.fn()
    const flow = wireUpdateFlow(container, { onReady, onControllerChange })
    // getRegistration resolves in a microtask; let the wiring land before asserting.
    await Promise.resolve()
    await Promise.resolve()

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onControllerChange).not.toHaveBeenCalled()
    flow.apply()
    await Promise.resolve()
    expect(waiting.posted).toEqual(['SKIP_WAITING'])
  })

  it('первая установка без контроллера не считается обновлением', () => {
    const { container } = makeHarness()
    container.controller = null
    const onReady = vi.fn()
    wireUpdateFlow(container, { onReady, onControllerChange: () => {} })
    expect(onReady).not.toHaveBeenCalled()
  })

  it('controllerchange до apply не перезагружает страницу, после apply — перезагружает', () => {
    const { container } = makeHarness()
    const onControllerChange = vi.fn()
    const flow = wireUpdateFlow(container, { onReady: () => {}, onControllerChange })

    container.controllerChange()
    expect(onControllerChange).not.toHaveBeenCalled()

    flow.apply()
    container.controllerChange()
    expect(onControllerChange).toHaveBeenCalledTimes(1)
  })
})
