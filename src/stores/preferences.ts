import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const THEME_KEY = 'panel36.theme.v1'
const BOARD_ZOOM_KEY = 'panel36.boardZoom.v1'
const PANELS_KEY = 'panel36.editorPanels.v1'
/** The board's manual zoom, as a multiple of its natural size. `null` means "fit the working area". */
export const BOARD_ZOOM_MIN = 0.4
export const BOARD_ZOOM_MAX = 3
type Theme = 'light' | 'dark'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The preference still applies to the current document when storage is blocked.
  }
}

/** Anything in localStorage is user-editable, so a stored value is only accepted if it can still be a zoom. */
const readStoredZoom = (): number | null => {
  const raw = read(BOARD_ZOOM_KEY)
  if (raw === null || raw === 'fit') return null
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return null
  return Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, value))
}

export const usePreferencesStore = defineStore('preferences', () => {
  const theme = ref<Theme>(read(THEME_KEY) === 'dark' ? 'dark' : 'light')
  const boardZoom = ref<number | null>(readStoredZoom())
  /** Whether the editor's side panels are showing, as opposed to the board alone. */
  const panelsOpen = ref(read(PANELS_KEY) === 'open')

  const setTheme = (value: Theme) => {
    theme.value = value
  }

  const toggleTheme = () => setTheme(theme.value === 'light' ? 'dark' : 'light')

  /** `null` hands the scaling back to the automatic fit; a number is an independent manual zoom. */
  const setBoardZoom = (value: number | null) => {
    boardZoom.value = value === null ? null : Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, Math.round(value * 100) / 100))
  }

  const setPanelsOpen = (value: boolean) => {
    panelsOpen.value = value
  }

  watch(boardZoom, (value) => {
    write(BOARD_ZOOM_KEY, value === null ? 'fit' : String(value))
  })

  watch(panelsOpen, (value) => {
    write(PANELS_KEY, value ? 'open' : 'closed')
  })

  watch(theme, (value) => {
    write(THEME_KEY, value)
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = value
  }, { immediate: true })

  return { theme, setTheme, toggleTheme, boardZoom, setBoardZoom, panelsOpen, setPanelsOpen }
})
