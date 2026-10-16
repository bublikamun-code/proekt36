import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, usePreferencesStore } from '../src/stores/preferences'
import { MemoryStorage, ThrowingStorage, installBrowserEnv } from './support/browser-env'
import type { BrowserEnv } from './support/browser-env'

let env: BrowserEnv

const open = (seed: Record<string, string> = {}) => {
  env = installBrowserEnv()
  for (const [key, value] of Object.entries(seed)) env.storage.setItem(key, value)
  setActivePinia(createPinia())
  return usePreferencesStore()
}

/** The watchers that mirror state into storage fire on the microtask queue, not synchronously. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  env = null as unknown as BrowserEnv
})

afterEach(() => {
  env?.restore()
})

describe('тема оформления', () => {
  it('читает сохранённую тему и по умолчанию остаётся на светлой', () => {
    expect(open().theme).toBe('light')
  })

  it('поднимает тёмную тему из хранилища', () => {
    expect(open({ 'panel36.theme.v1': 'dark' }).theme).toBe('dark')
  })

  it('не верит значению, которого не могло быть в списке тем', () => {
    expect(open({ 'panel36.theme.v1': 'неоновая' }).theme).toBe('light')
  })

  it('переключает тему, перенося её в документ и в хранилище', async () => {
    const store = open()

    store.toggleTheme()
    expect(store.theme).toBe('dark')
    await settle()

    expect(env.storage.getItem('panel36.theme.v1')).toBe('dark')
    // The document is what actually repaints, so the theme has to land on its root element.
    expect(env.document.documentElement.dataset.theme).toBe('dark')
  })

  it('ставит тему сразу при открытии, до первого переключения', () => {
    open({ 'panel36.theme.v1': 'dark' })
    expect(env.storage.getItem('panel36.theme.v1')).toBe('dark')
  })
})

describe('масштаб доски', () => {
  it('понимает сохранённый множитель и обрезает его в допустимые пределы', () => {
    expect(open({ 'panel36.boardZoom.v1': '1.5' }).boardZoom).toBe(1.5)
    expect(open({ 'panel36.boardZoom.v1': '0.01' }).boardZoom).toBe(BOARD_ZOOM_MIN)
    expect(open({ 'panel36.boardZoom.v1': '99' }).boardZoom).toBe(BOARD_ZOOM_MAX)
  })

  it('не доверяет значению, которое не может быть масштабом', () => {
    // localStorage is user-editable, so a stored value only counts if it can still be a zoom.
    for (const stored of ['средне', '', 'NaN', 'бесконечность']) {
      expect(open({ 'panel36.boardZoom.v1': stored }).boardZoom).toBeNull()
    }
  })

  it('возвращает авто-масштаб, когда в хранилище стоит «fit» или ничего', () => {
    expect(open({ 'panel36.boardZoom.v1': 'fit' }).boardZoom).toBeNull()
    expect(open().boardZoom).toBeNull()
  })

  it('зажимает ручной масштаб и округляет его до сотых', () => {
    const store = open()

    store.setBoardZoom(0.001)
    expect(store.boardZoom).toBe(BOARD_ZOOM_MIN)
    store.setBoardZoom(50)
    expect(store.boardZoom).toBe(BOARD_ZOOM_MAX)
    store.setBoardZoom(1.23456)
    expect(store.boardZoom).toBe(1.23)
  })

  it('возвращает авто-масштаб по явному null, а не по falsy-значению', () => {
    const store = open()
    store.setBoardZoom(2)

    store.setBoardZoom(null)

    expect(store.boardZoom).toBeNull()
  })

  it('хранит авто-масштаб словом, а ручной — числом', async () => {
    const store = open()

    store.setBoardZoom(1.25)
    await settle()
    expect(env.storage.getItem('panel36.boardZoom.v1')).toBe('1.25')

    store.setBoardZoom(null)
    await settle()
    expect(env.storage.getItem('panel36.boardZoom.v1')).toBe('fit')
  })
})

describe('боковые панели редактора', () => {
  it('показывает панели при первом визите и помнит явное закрытие', () => {
    // The setting exists so a refresh does not undo the layout the user chose. Reading it as
    // "open only when stored as open" would drop a first-time visitor straight into focus
    // mode, which is the opposite of what the editor asks for.
    expect(open().panelsOpen).toBe(true)
    expect(open({ 'panel36.editorPanels.v1': 'open' }).panelsOpen).toBe(true)
    expect(open({ 'panel36.editorPanels.v1': 'closed' }).panelsOpen).toBe(false)
  })

  it('записывает состояние панелей при переключении', async () => {
    const store = open()

    store.setPanelsOpen(false)
    await settle()
    expect(env.storage.getItem('panel36.editorPanels.v1')).toBe('closed')

    store.setPanelsOpen(true)
    await settle()
    expect(env.storage.getItem('panel36.editorPanels.v1')).toBe('open')
  })
})

describe('заблокированное хранилище', () => {
  it('открывается с настройками по умолчанию, когда localStorage бросает исключение', () => {
    env = installBrowserEnv({ storage: new ThrowingStorage(new Error('доступ запрещён')) as unknown as MemoryStorage })
    setActivePinia(createPinia())

    const store = usePreferencesStore()
    expect(store.theme).toBe('light')
    expect(store.boardZoom).toBeNull()
  })

  it('продолжает применять настройки в текущем документе, даже если записать их нельзя', async () => {
    env = installBrowserEnv({ storage: new ThrowingStorage(new Error('диск заполнен')) as unknown as MemoryStorage })
    setActivePinia(createPinia())
    const store = usePreferencesStore()

    expect(() => store.setTheme('dark')).not.toThrow()
    expect(() => store.setPanelsOpen(false)).not.toThrow()
    expect(() => store.setBoardZoom(2)).not.toThrow()
    await settle()

    expect(store.theme).toBe('dark')
    expect(store.panelsOpen).toBe(false)
    expect(store.boardZoom).toBe(2)
  })
})
