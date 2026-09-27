<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '../stores/auth'
import { usePreferencesStore } from '../stores/preferences'
import BrandMark from '../components/ui/BrandMark.vue'
import { APPLICATION_REVISION } from '../domain/projectSchema'

const auth = useAuthStore()
const preferences = usePreferencesStore()
const { session } = storeToRefs(auth)
const { theme } = storeToRefs(preferences)
const menuOpen = ref(false)
const header = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)

const closeMenu = (restoreFocus = false) => {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (restoreFocus) menuButton.value?.focus()
}
const onDocumentPointerDown = (event: MouseEvent) => {
  if (menuOpen.value && !header.value?.contains(event.target as Node)) closeMenu()
}
const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu(true) }

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointerDown)
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="public-shell">
    <header ref="header" class="public-header">
      <RouterLink to="/" class="public-brand" aria-label="Панель 36 — главная" @click="menuOpen = false">
        <BrandMark />
      </RouterLink>

      <nav class="public-nav" aria-label="Основная навигация">
        <RouterLink to="/features">Возможности</RouterLink>
        <RouterLink to="/pricing">Тарифы</RouterLink>
      </nav>

      <div class="public-actions">
        <button
          class="public-theme"
          :aria-label="theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'"
          @click="preferences.toggleTheme"
        >
          {{ theme === 'light' ? '◐' : '○' }}
        </button>
        <RouterLink v-if="session" class="public-login" to="/app/projects">Рабочая область</RouterLink>
        <RouterLink v-else class="public-login" to="/login">Войти</RouterLink>
        <RouterLink class="public-cta" to="/demo/project">Открыть конфигуратор</RouterLink>
      </div>

      <button
        ref="menuButton"
        class="public-menu-button"
        :aria-expanded="menuOpen"
        aria-controls="public-mobile-menu"
        :aria-label="menuOpen ? 'Закрыть меню' : 'Открыть меню'"
        @click="menuOpen = !menuOpen"
      >
        {{ menuOpen ? '×' : '≡' }}
      </button>

      <div v-if="menuOpen" id="public-mobile-menu" class="public-mobile-menu">
        <RouterLink to="/features" @click="menuOpen = false">Возможности</RouterLink>
        <RouterLink to="/pricing" @click="menuOpen = false">Тарифы</RouterLink>
        <RouterLink :to="session ? '/app/projects' : '/login'" @click="menuOpen = false">
          {{ session ? 'Рабочая область' : 'Войти' }}
        </RouterLink>
        <RouterLink class="public-cta" to="/demo/project" @click="menuOpen = false">
          Открыть конфигуратор
        </RouterLink>
      </div>
    </header>

    <main class="public-main">
      <RouterView />
    </main>

    <footer class="public-footer">
      <div class="public-footer-brand">
        <BrandMark />
        <p>Проектируйте щит в браузере. Данные остаются на этом устройстве.</p>
      </div>
      <nav aria-label="Документы">
        <RouterLink to="/features">Возможности</RouterLink>
        <RouterLink to="/pricing">Тарифы</RouterLink>
        <RouterLink to="/privacy">Конфиденциальность</RouterLink>
        <RouterLink to="/terms">Условия</RouterLink>
      </nav>
      <span class="public-demo-note">Предварительная версия {{ APPLICATION_REVISION }} · серверная синхронизация не подключена</span>
    </footer>
  </div>
</template>

<style scoped>
.public-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--canvas); }
.public-header { position: sticky; top: 0; z-index: 40; min-height: 66px; display: flex; align-items: center; gap: 28px; padding: 0 clamp(16px, 4vw, 64px); background: color-mix(in srgb, var(--surface) 94%, transparent); border-bottom: 1px solid var(--line); backdrop-filter: blur(12px); }
.public-brand { display: inline-flex; min-height: 44px; align-items: center; color: inherit; text-decoration: none; }
.public-nav { display: flex; align-items: center; gap: 22px; }
.public-nav a, .public-login { min-height: 44px; display: inline-flex; align-items: center; color: var(--text-muted); font-size: var(--text-xs); font-weight: 700; text-decoration: none; }
.public-nav a:hover, .public-login:hover, .public-nav a.router-link-active { color: var(--heading); }
.public-nav a.router-link-active { box-shadow: inset 0 -2px var(--accent); }
.public-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.public-theme, .public-menu-button { width: 44px; min-width: 44px; min-height: 44px; display: inline-grid; place-items: center; background: transparent; font-size: var(--text-lg); }
.public-cta, .public-login { border: 1px solid var(--service); text-decoration: none; justify-content: center; padding: 0 15px; }
.public-cta { min-height: 44px; display: inline-flex; align-items: center; background: var(--service); color: var(--on-service); font-size: var(--text-xs); font-weight: 800; }
.public-cta:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.public-login { border-color: transparent; }
.public-main { flex: 1; }
.public-footer { display: grid; grid-template-columns: minmax(240px, 1fr) auto; gap: 26px 60px; align-items: start; padding: 34px clamp(16px, 4vw, 64px); background: var(--service); color: var(--on-service); }
.public-footer-brand p { max-width: 360px; margin-top: 12px; color: color-mix(in srgb, var(--on-service) 68%, transparent); font-size: var(--text-xs); line-height: 1.55; }
.public-footer nav { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 8px 28px; }
.public-footer nav a { min-height: 34px; display: flex; align-items: center; color: color-mix(in srgb, var(--on-service) 76%, transparent); font-size: var(--text-xs); text-decoration: none; }
.public-footer nav a:hover { color: var(--accent); }
.public-demo-note { grid-column: 1 / -1; padding-top: 18px; border-top: 1px solid color-mix(in srgb, var(--on-service) 18%, transparent); color: color-mix(in srgb, var(--on-service) 52%, transparent); font:var(--text-micro) var(--mono); }
.public-mobile-menu { position: absolute; top: 100%; left: 0; right: 0; display: none; padding: 10px 16px 16px; background: var(--surface); border-bottom: 1px solid var(--service); box-shadow: var(--shadow); }
.public-menu-button { display: none; }

@media (max-width: 900px) {
  .public-header { gap: 12px; }
  .public-nav { display: none; }
  .public-actions { margin-left: auto; }
  .public-menu-button { display: inline-grid; }
  .public-mobile-menu { position: absolute; z-index: 39; top: 100%; left: 0; right: 0; display: grid; padding: 10px 16px 16px; background: var(--surface); border-bottom: 1px solid var(--service); box-shadow: var(--shadow); }
  .public-mobile-menu a { min-height: 46px; display: flex; align-items: center; padding: 0 10px; border-bottom: 1px solid var(--line-soft); color: var(--text); font-size: var(--text-sm); font-weight: 700; text-decoration: none; }
  .public-mobile-menu .public-cta { margin-top: 8px; justify-content: center; border: 1px solid var(--service); color: var(--on-service); background: var(--service); }
}

@media (max-width: 620px) {
  .public-header { min-height: 58px; padding: 0 8px 0 14px; }
  .public-mobile-menu { top: 100%; }
  .public-actions .public-login, .public-actions .public-cta { display: none; }
  .public-theme { width: 40px; min-width: 40px; }
  .public-menu-button { width: 40px; min-width: 40px; }
  .public-footer { grid-template-columns: 1fr; padding: 30px 18px; }
  .public-footer nav { grid-template-columns: 1fr 1fr; }
}
</style>
