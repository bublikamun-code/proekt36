/**
 * Whether this browser run may install the offline worker.
 *
 * The conditions are a function rather than a chain of `if`s in `main.ts` so they can be tested
 * without a browser: the two that are easy to get wrong are development (a worker would serve a
 * stale shell over Vite's dev server) and an automated browser (a cached shell from a previous
 * test run would make the next one read a document that no longer exists).
 */
export type ServiceWorkerResult = 'registered' | 'skipped' | 'failed' | 'unsupported'

export interface ServiceWorkerEnvironment {
  production: boolean
  controlled: boolean
  webdriver: boolean
  supported: boolean
  secureContext: boolean
}

export const shouldRegisterServiceWorker = (environment: ServiceWorkerEnvironment) => ({
  // `vite dev` serves modules the worker would happily cache and then keep serving.
  production: environment.production,
  // Not supported at all: nothing to register.
  supported: environment.supported,
  // A worker only runs on a secure origin, which includes localhost.
  secureContext: environment.secureContext,
  // Playwright drives a real browser with a real cache, and a stale shell would be attributed to
  // the application rather than to the cache that caused it.
  webdriver: !environment.webdriver,
  controlled: !environment.controlled,
})

export const registerServiceWorker = async (): Promise<ServiceWorkerResult> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported'
  const decision = shouldRegisterServiceWorker({
    production: import.meta.env.PROD,
    controlled: Boolean(navigator.serviceWorker.controller),
    webdriver: Boolean((navigator as Navigator & { webdriver?: boolean }).webdriver),
    supported: 'serviceWorker' in navigator,
    secureContext: window.isSecureContext,
  })
  if (Object.values(decision).some((value) => !value)) return 'skipped'
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    return 'registered'
  } catch (error) {
    // A failed registration must never keep the application from starting: everything here is a
    // convenience on top of an app that already works from the network.
    console.warn('Service worker не зарегистрирован:', error)
    return 'failed'
  }
}

/**
 * Structural surface of the Service Worker API the update flow touches, so the flow can be
 * exercised with plain objects instead of a live worker.
 */
export interface UpdateWorkerLike {
  state: string
  addEventListener: (type: 'statechange', listener: () => void) => void
  postMessage: (data: unknown) => void
}

export interface UpdateRegistrationLike {
  installing: UpdateWorkerLike | null
  waiting: UpdateWorkerLike | null
  addEventListener: (type: 'updatefound', listener: () => void) => void
}

export interface UpdateContainerLike {
  controller: unknown
  getRegistration: () => Promise<UpdateRegistrationLike | undefined>
  addEventListener: (type: 'controllerchange', listener: () => void) => void
}

/**
 * The update story in two events: «a new version is installed and waiting» (`onReady`, the
 * moment the app may ask) and «the new version took control» (`onControllerChange`, the moment
 * the page should reload — only after the user agreed, which is what `apply` marks). The worker
 * never skips waiting on its own, so a hard reload mid-edit is always a choice, never a surprise.
 */
export const wireUpdateFlow = (
  container: UpdateContainerLike,
  hooks: { onReady: () => void; onControllerChange: () => void },
): { apply: () => void } => {
  let applied = false
  container.addEventListener('controllerchange', () => {
    if (applied) hooks.onControllerChange()
  })
  const announce = (worker: UpdateWorkerLike | null) => {
    // `installed` while a controller exists is «an update is waiting»; the same state on the
    // very first install is just «the app went offline-capable», nothing to ask about.
    if (!worker || worker.state !== 'installed' || !container.controller) return
    hooks.onReady()
  }
  void container.getRegistration().then((registration) => {
    if (!registration) return
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => announce(worker))
    })
    // The page can open after the waiting worker arrived — the updatefound above will not fire.
    announce(registration.waiting)
  })
  return {
    apply: () => {
      applied = true
      void container.getRegistration().then((registration) => {
        const worker = registration?.waiting ?? registration?.installing
        worker?.postMessage('SKIP_WAITING')
      })
    },
  }
}

/** Whether this page may ask about updates at all: production browser, feature not switched off. */
export const shouldOfferUpdatePrompt = (environment: { production: boolean; webdriver: boolean; flag: string | undefined }) =>
  environment.production && !environment.webdriver && environment.flag !== 'off'

/**
 * The worker's cache version lives in `public/sw.js`, a static file that cannot import a module,
 * and it is checked against `APP_VERSION` from the file itself by `tests/service-worker.test.ts`.
 * Duplicating the string here as well would have been a third copy with nothing enforcing it.
 */
