import { describe, expect, it } from 'vitest'
import { isValidEmail, isValidPassword, normalizeEmail, safeInternalPath } from '../src/domain/auth'

describe('local demo auth validation', () => {
  it('normalizes email and validates basic shape', () => {
    expect(normalizeEmail('  Demo@Example.COM ')).toBe('demo@example.com')
    expect(isValidEmail('demo@example.com')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
  })

  it('requires a six character password', () => {
    expect(isValidPassword('12345')).toBe(false)
    expect(isValidPassword('123456')).toBe(true)
  })

  it('keeps only internal redirect paths', () => {
    expect(safeInternalPath('/app/projects/abc/editor?mode=2d')).toBe('/app/projects/abc/editor?mode=2d')
    expect(safeInternalPath('https://example.com')).toBe('/app/projects')
    expect(safeInternalPath('//example.com')).toBe('/app/projects')
    expect(safeInternalPath('/\\example.com')).toBe('/app/projects')
  })
})
