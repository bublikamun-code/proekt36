import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const THEME_KEY = 'panel36.theme.v1'
const BOARD_ZOOM_KEY = 'panel36.boardZoom.v1'
/** The board's manual zoom, as a multiple of its natural size. `null` means "fit the working area". */
export const BOARD_ZOOM_MIN = 0.4
export const BOARD_ZOOM_MAX = 3
type Theme = 'light' | 'dark'

/** Anything in localStorage is user-editable, so a stored value is only accepted if it can still be a zoom. */
const readStoredZoom = (): number | null => {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(BOARD_ZOOM_KEY)
  } catch {
    return null
  }
  if (raw === null || raw === 'fit') return null
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return null
  return Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, value))
}

export const usePreferencesStore = defineStore('preferences', () => {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
  } catch {
    stored = null
  }
  const theme = ref<Theme>(stored === 'dark' ? 'dark' : 'light')
  const boardZoom = ref<number | null>(readStoredZoom())

  const setTheme = (value: Theme) => {
    theme.value = value
  }

  const toggleTheme = () => setTheme(theme.value === 'light' ? 'dark' : 'light')

  /** `null` hands the scaling back to the automatic fit; a number is an independent manual zoom. */
  const setBoardZoom = (value: number | null) => {
    boardZoom.value = value === null ? null : Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, Math.round(value * 100) / 100))
  }

  watch(boardZoom, (value) => {
    try {
      localStorage.setItem(BOARD_ZOOM_KEY, value === null ? 'fit' : String(value))
    } catch {
      // The zoom still applies to the current document when storage is blocked.
    }
  })

  watch(theme, (value) => {
    try {
      localStorage.setItem(THEME_KEY, value)
    } catch {
      // The preference still applies to the current document when storage is blocked.
    }
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = value
  }, { immediate: true })

  return { theme, setTheme, toggleTheme, boardZoom, setBoardZoom }
})
