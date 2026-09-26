import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

const THEME_KEY = 'panel36.theme.v1'
type Theme = 'light' | 'dark'

export const usePreferencesStore = defineStore('preferences', () => {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
  } catch {
    stored = null
  }
  const theme = ref<Theme>(stored === 'dark' ? 'dark' : 'light')

  const setTheme = (value: Theme) => {
    theme.value = value
  }

  const toggleTheme = () => setTheme(theme.value === 'light' ? 'dark' : 'light')

  watch(theme, (value) => {
    try {
      localStorage.setItem(THEME_KEY, value)
    } catch {
      // The preference still applies to the current document when storage is blocked.
    }
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = value
  }, { immediate: true })

  return { theme, setTheme, toggleTheme }
})
