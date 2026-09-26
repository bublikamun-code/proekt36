import {
  DEMO_SESSION_KEY,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  type WorkspaceSession,
} from '../domain/auth'

const read = (): WorkspaceSession | null => {
  try {
    const value = sessionStorage.getItem(DEMO_SESSION_KEY)
    if (!value) return null
    const session = JSON.parse(value) as WorkspaceSession
    if (session.kind !== 'guest' && session.kind !== 'demo') return null
    if (typeof session.name !== 'string' || typeof session.createdAt !== 'string') return null
    if (session.email && !isValidEmail(session.email)) return null
    return session
  } catch {
    return null
  }
}

const write = (session: WorkspaceSession) => {
  try {
    sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session))
  } catch {
    // A blocked sessionStorage should not prevent local-only mode from opening.
  }
  return session
}

export const demoAuth = {
  restore: read,
  async signIn(email: string, _password: string) {
    const normalized = normalizeEmail(email)
    if (!isValidEmail(normalized)) throw new Error('Введите корректный email')
    if (!isValidPassword(_password)) throw new Error('Пароль должен содержать не менее 6 символов')

    return write({
      kind: 'demo',
      name: normalized.split('@')[0] || 'Пользователь',
      email: normalized,
      createdAt: new Date().toISOString(),
    })
  },
  async register(name: string, email: string, _password: string) {
    const cleanName = name.trim()
    const normalized = normalizeEmail(email)
    if (cleanName.length < 2) throw new Error('Введите имя')
    if (!isValidEmail(normalized)) throw new Error('Введите корректный email')
    if (!isValidPassword(_password)) throw new Error('Пароль должен содержать не менее 6 символов')

    return write({
      kind: 'demo',
      name: cleanName,
      email: normalized,
      createdAt: new Date().toISOString(),
    })
  },
  async continueLocally() {
    return write({
      kind: 'guest',
      name: 'Локальный пользователь',
      createdAt: new Date().toISOString(),
    })
  },
  async signOut() {
    try {
      sessionStorage.removeItem(DEMO_SESSION_KEY)
    } catch {
      // The in-memory auth store is still cleared by the caller.
    }
  },
}
