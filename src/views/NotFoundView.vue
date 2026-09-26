<script setup lang="ts">
import BrandMark from '../components/ui/BrandMark.vue'
</script>

<template>
  <main class="not-found-page">
    <BrandMark />
    <span class="eyebrow">Ошибка маршрута</span>
    <h1>Такой страницы нет.</h1>
    <p>Возможно, адрес изменился или проект был удалён.</p>
    <div><RouterLink class="not-found-primary" to="/">На главную</RouterLink><RouterLink class="not-found-secondary" to="/app/projects">Рабочая область</RouterLink></div>
  </main>
</template>

<style scoped>
.not-found-page { min-height: 100vh; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; width: min(100% - 32px, 700px); margin: 0 auto; }.not-found-page .brand { margin-bottom: 70px; }.not-found-page h1 { margin-top: 12px; font-size: clamp(40px, 7vw, 72px); letter-spacing: -.05em; }.not-found-page p { margin-top: 16px; color: var(--text-muted); font-size: 14px; }.not-found-page > div { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }.not-found-page a { min-height: 44px; display: inline-flex; align-items: center; padding: 0 15px; font-size: 12px; font-weight: 800; text-decoration: none; }.not-found-primary { background: var(--service); color: var(--on-service); }.not-found-secondary { border: 1px solid var(--line); color: var(--text); }
</style>
