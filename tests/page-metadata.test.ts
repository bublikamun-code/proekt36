import { afterEach, describe, expect, it } from 'vitest'
import { applyPageMetadata, pageMetadata } from '../src/router/metadata'
import { installBrowserEnv } from './support/browser-env'
import type { BrowserEnv } from './support/browser-env'

let env: BrowserEnv | null = null

const withBrowser = (options: Parameters<typeof installBrowserEnv>[0] = {}) => {
  env = installBrowserEnv(options)
  return env
}

afterEach(() => {
  env?.restore()
  env = null
})

const meta = (browser: BrowserEnv, selector: string) => browser.document.head.querySelector(selector)

describe('применение метаданных страницы', () => {
  it('ставит заголовок, описание и правила индексации из описания страницы', () => {
    const browser = withBrowser()
    applyPageMetadata(pageMetadata.features)

    expect(browser.document.title).toBe(pageMetadata.features.title)
    expect(meta(browser, 'meta[name="description"]')!.content).toBe(pageMetadata.features.description)
    expect(meta(browser, 'meta[name="robots"]')!.content).toBe('index,follow')
  })

  it('расставляет теги Open Graph и Twitter по тому же содержимому', () => {
    const browser = withBrowser()
    applyPageMetadata(pageMetadata.pricing)

    expect(meta(browser, 'meta[property="og:title"]')!.content).toBe(pageMetadata.pricing.title)
    expect(meta(browser, 'meta[property="og:description"]')!.content).toBe(pageMetadata.pricing.description)
    expect(meta(browser, 'meta[property="og:type"]')!.content).toBe('website')
    expect(meta(browser, 'meta[name="twitter:card"]')!.content).toBe('summary')
    expect(meta(browser, 'meta[name="twitter:title"]')!.content).toBe(pageMetadata.pricing.title)
    expect(meta(browser, 'meta[name="twitter:description"]')!.content).toBe(pageMetadata.pricing.description)
  })

  it('переиспользует уже созданные теги, а не плодит их при каждом переходе', () => {
    const browser = withBrowser()
    applyPageMetadata(pageMetadata.home)
    const after = browser.document.head.children.length

    applyPageMetadata(pageMetadata.terms)
    applyPageMetadata(pageMetadata.privacy)

    // Each route change rewrites the same head elements; a router that re-created them would
    // leave a growing pile of stale tags for a crawler to read.
    expect(browser.document.head.children.length).toBe(after)
    expect(meta(browser, 'meta[name="description"]')!.content).toBe(pageMetadata.privacy.description)
  })

  it('собирает канонический адрес из текущего пути', () => {
    const browser = withBrowser({ origin: 'https://panel36.example', pathname: '/pricing' })
    applyPageMetadata(pageMetadata.pricing)

    expect(meta(browser, 'link[rel="canonical"]')!.href).toBe('https://panel36.example/pricing')
  })

  it('создаёт канонический адрес только один раз и обновляет его при переходе', () => {
    const browser = withBrowser({ origin: 'https://panel36.example', pathname: '/app/projects' })
    applyPageMetadata(pageMetadata.projects)
    const created = browser.document.head.querySelectorAll('link[rel="canonical"]')
    expect(created).toHaveLength(1)
    expect(created[0]!.href).toBe('https://panel36.example/app/projects')

    browser.window.location.pathname = '/app/editor'
    applyPageMetadata(pageMetadata.editor)

    expect(browser.document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(meta(browser, 'link[rel="canonical"]')!.href).toBe('https://panel36.example/app/editor')
  })

  it('добавляет разметку schema.org на публичную страницу', () => {
    const browser = withBrowser()
    applyPageMetadata(pageMetadata.home)
    const script = meta(browser, 'script[data-panel36-schema]')!

    expect(script.type).toBe('application/ld+json')
    expect(JSON.parse(script.textContent)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Панель 36',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: pageMetadata.home.description,
    })
  })

  it('убирает разметку, когда публичная страница сменяется закрытой', () => {
    const browser = withBrowser()
    applyPageMetadata(pageMetadata.demo)
    expect(meta(browser, 'script[data-panel36-schema]')).not.toBeNull()

    applyPageMetadata(pageMetadata.editor)

    // Leaving a SoftwareApplication block on a private editor page tells a crawler the whole
    // working area is an application it should index.
    expect(meta(browser, 'script[data-panel36-schema]')).toBeNull()
    expect(browser.document.title).toBe(pageMetadata.editor.title)
  })

  it('переписывает разметку на месте, а не добавляет вторую', () => {
    const browser = withBrowser()
    applyPageMetadata(pageMetadata.home)
    applyPageMetadata(pageMetadata.features)

    const scripts = browser.document.head.querySelectorAll('script[data-panel36-schema]')
    expect(scripts).toHaveLength(1)
    expect(JSON.parse(scripts[0]!.textContent).description).toBe(pageMetadata.features.description)
  })

  it('не падает на закрытой странице, если разметки на неё никто не клал', () => {
    const browser = withBrowser()
    expect(() => applyPageMetadata(pageMetadata.login)).not.toThrow()
    expect(meta(browser, 'script[data-panel36-schema]')).toBeNull()
  })
})
