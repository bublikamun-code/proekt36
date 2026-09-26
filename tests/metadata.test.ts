import { describe, expect, it } from 'vitest'
import { pageMetadata } from '../src/router/metadata'

describe('route metadata', () => {
  it('defines unique indexable titles for public pages', () => {
    const publicRoutes = ['home', 'features', 'pricing', 'demo', 'privacy', 'terms']
    const titles = publicRoutes.map((name) => pageMetadata[name].title)
    expect(new Set(titles).size).toBe(titles.length)
    expect(publicRoutes.every((name) => pageMetadata[name].robots === 'index,follow')).toBe(true)
  })

  it('marks private routes as noindex', () => {
    for (const name of ['login', 'register', 'projects', 'editor', 'current-editor', 'notFound']) {
      expect(pageMetadata[name].robots).toBe('noindex,nofollow')
    }
  })
})
