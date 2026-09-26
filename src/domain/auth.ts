export const DEMO_SESSION_KEY = 'panel36.demo-session.v1'

export type WorkspaceSession = {
  kind: 'guest' | 'demo'
  name: string
  email?: string
  createdAt: string
}

export const normalizeEmail = (value: string) => value.trim().toLowerCase()

export const isValidEmail = (value: string) => {
  const email = normalizeEmail(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const isValidPassword = (value: string) => value.length >= 6

export const safeInternalPath = (value: unknown, fallback = '/app/projects') => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback
  }

  try {
    const parsed = new URL(value, 'https://panel36.local')
    if (parsed.origin !== 'https://panel36.local') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
