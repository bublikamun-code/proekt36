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
 * The worker's cache version lives in `public/sw.js`, a static file that cannot import a module,
 * and it is checked against `APP_VERSION` from the file itself by `tests/service-worker.test.ts`.
 * Duplicating the string here as well would have been a third copy with nothing enforcing it.
 */
