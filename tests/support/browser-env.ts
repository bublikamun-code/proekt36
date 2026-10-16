/**
 * Browser doubles for the node test environment.
 *
 * The application only reaches for `localStorage`, `indexedDB` and `document` through a handful
 * of narrow surfaces, so the whole test suite runs without jsdom or fake-indexeddb: these
 * objects implement exactly the parts the app and the domain code use, and nothing else.
 */

export class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  clear() {
    this.values.clear()
  }

  get size() {
    return this.values.size
  }
}

/** A storage that fails the way a private-mode browser does, for the blocked-storage paths. */
export class ThrowingStorage {
  constructor(private readonly error: Error) {}

  getItem(): string | null {
    throw this.error
  }

  setItem(): void {
    throw this.error
  }

  removeItem(): void {
    throw this.error
  }
}

// --- IndexedDB ------------------------------------------------------------------------------

const tick = (run: () => void) => setTimeout(run, 0)

class FakeRequest<T = unknown> {
  result!: T
  error: unknown = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onupgradeneeded: (() => void) | null = null
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly transaction: FakeTransaction,
  ) {}

  put(value: unknown, key: string) {
    this.data.set(key, value)
    this.transaction.finish()
    return undefined
  }

  get(key: string) {
    const request = new FakeRequest<unknown>()
    tick(() => {
      request.result = this.data.get(key)
      request.onsuccess?.()
    })
    return request
  }

  getAllKeys() {
    const request = new FakeRequest<string[]>()
    tick(() => {
      request.result = [...this.data.keys()]
      request.onsuccess?.()
    })
    return request
  }

  delete(key: string) {
    this.data.delete(key)
    this.transaction.finish()
    return undefined
  }

  clear() {
    this.data.clear()
    this.transaction.finish()
    return undefined
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  error: unknown = null

  constructor(private readonly data: Map<string, unknown>) {}

  objectStore() {
    return new FakeObjectStore(this.data, this)
  }

  finish() {
    tick(() => this.oncomplete?.())
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) }
  close = () => {}

  constructor(readonly stores: Map<string, Map<string, unknown>>) {}

  createObjectStore(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map<string, unknown>())
    return this.storeOf(name)
  }

  transaction(name: string) {
    return new FakeTransaction(this.storeOf(name))
  }

  private storeOf(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map<string, unknown>())
    return this.stores.get(name)!
  }
}

const databases = new Map<string, Map<string, Map<string, unknown>>>()

/** An `indexedDB` good enough for the one object store the model library uses. */
export const createFakeIndexedDB = () => ({
  open(name: string, _version?: number) {
    const request = new FakeRequest<FakeDatabase>()
    tick(() => {
      let stores = databases.get(name)
      if (!stores) {
        stores = new Map<string, Map<string, unknown>>()
        databases.set(name, stores)
      }
      request.result = new FakeDatabase(stores)
      // The real API upgrades the schema before handing the connection over, and the app
      // creates its object store in `onupgradeneeded` — so that callback has to run first.
      if (!stores.size) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  },
})

export const resetFakeIndexedDB = () => databases.clear()

// --- document -------------------------------------------------------------------------------

const kebab = (value: string) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

const parseSelector = (selector: string) => {
  const match = selector.trim().match(/^([a-z0-9-]+)(?:\[([a-z0-9-]+)(?:="([^"]*)")?\])?$/i)
  if (!match) throw new Error(`Не поддерживается селектор заглушки: ${selector}`)
  return { tag: match[1]!.toLowerCase(), attribute: match[2]?.toLowerCase(), value: match[3] }
}

export class FakeElement {
  readonly tagName: string
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  parent: FakeElement | null = null
  content = ''
  href = ''
  type = ''
  textContent = ''
  download = ''
  clicks = 0

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase()
  }

  /** `link.rel = 'canonical'` reflects into the attribute, which is how the code finds it again. */
  get rel(): string {
    return this.getAttribute('rel') ?? ''
  }

  set rel(value: string) {
    this.setAttribute('rel', value)
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  get dataset(): Record<string, string | undefined> {
    return new Proxy({}, {
      get: (_target, key: string) => this.getAttribute(`data-${kebab(key)}`),
      set: (_target, key: string, value: string) => {
        this.setAttribute(`data-${kebab(key)}`, value)
        return true
      },
    })
  }

  click() {
    this.clicks += 1
  }

  append(...elements: FakeElement[]) {
    for (const element of elements) {
      element.parent = this
      this.children.push(element)
    }
  }

  remove() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((item) => item !== this)
    this.parent = null
  }

  matches(selector: string) {
    const { tag, attribute, value } = parseSelector(selector)
    if (tag !== this.tagName) return false
    if (!attribute) return true
    const actual = this.getAttribute(attribute)
    return value === undefined ? actual !== null : actual === value
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child
      const nested = child.querySelector(selector)
      if (nested) return nested
    }
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = []
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child)
      found.push(...child.querySelectorAll(selector))
    }
    return found
  }
}

export interface FakeDocument extends FakeElement {
  title: string
  /** The same node as the stub itself, the way `documentElement` mirrors the root element. */
  documentElement: FakeElement
  head: FakeElement
  body: FakeElement
  createElement: (tagName: string) => FakeElement
  /** Elements `createElement` handed out that were never attached to the tree. */
  detached: FakeElement[]
}

export interface FakeWindow {
  location: { origin: string; pathname: string }
  addEventListener: (type: string, handler: (event: Event) => void) => void
  removeEventListener: (type: string, handler: (event: Event) => void) => void
  /** Fires an event the way a browser does, so a registered handler runs. */
  dispatch: (type: string) => void
  /** How many handlers are still registered, to catch a listener that is never removed. */
  listenerCount: (type: string) => number
}

export interface BrowserEnv {
  document: FakeDocument
  window: FakeWindow
  storage: MemoryStorage
  /** The href passed to the last created download anchor. */
  lastDownload: () => { href: string; download: string; clicks: number } | null
  restore: () => void
}

/**
 * Installs `document`, `window` and `localStorage` for one test. Everything is restored by
 * `restore()`, so a leaking global cannot make the next test depend on it.
 */
export const installBrowserEnv = (options: { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; origin?: string; pathname?: string } = {}): BrowserEnv => {
  const storage = options.storage ?? new MemoryStorage()
  const head = new FakeElement('head')
  const body = new FakeElement('body')
  const html = new FakeElement('html')
  // Elements made by `createElement` but never appended — a download anchor, typically — still
  // exist, so they are kept here rather than lost with the temporary that made them.
  const detached: FakeElement[] = []
  const documentStub = Object.assign(html, {
    title: '',
    documentElement: html,
    head,
    body,
    detached,
    createElement: (tagName: string) => {
      const element = new FakeElement(tagName)
      detached.push(element)
      return element
    },
  }) as FakeDocument
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const windowStub: FakeWindow = {
    location: { origin: options.origin ?? 'https://panel36.test', pathname: options.pathname ?? '/app/editor' },
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    removeEventListener: (type, handler) => { listeners.get(type)?.delete(handler) },
    dispatch: (type) => {
      for (const handler of [...(listeners.get(type) ?? [])]) handler({ type } as Event)
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  }
  const previous = new Map<string, PropertyDescriptor | undefined>()
  const define = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  define('localStorage', storage)
  define('document', documentStub)
  define('window', windowStub)

  return {
    document: documentStub,
    window: windowStub,
    storage,
    lastDownload: () => {
      const anchor = documentStub.querySelectorAll('a').at(-1) ?? detached.filter((item) => item.tagName === 'a').at(-1)
      return anchor ? { href: anchor.href, download: anchor.download, clicks: anchor.clicks } : null
    },
    restore: () => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}
