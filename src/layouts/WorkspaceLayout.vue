<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { useProjectStore } from '../stores/project'

const store = useProjectStore()
const { toast } = storeToRefs(store)
const route = useRoute()

/** The editor has two routes (current and project-scoped); the nav marks either as «here». */
const isHere = (name: string) =>
  name === 'editor'
    ? route.path.startsWith('/app/projects') || route.path === '/app/editor'
    : route.name === name
</script>

<template>
  <nav class="workspace-nav" aria-label="Разделы кабинета">
    <RouterLink :to="{ name: 'projects' }" :aria-current="isHere('projects') ? 'page' : undefined">Проекты</RouterLink>
    <RouterLink :to="{ name: 'current-editor' }" :aria-current="isHere('editor') ? 'page' : undefined">Редактор</RouterLink>
    <RouterLink :to="{ name: 'settings' }" :aria-current="isHere('settings') ? 'page' : undefined">Настройки</RouterLink>
  </nav>
  <RouterView />
  <Transition name="toast">
    <div
      v-if="toast"
      class="toast"
      :class="`toast-${toast.tone}`"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
    >
      <span>{{ toast.tone === 'error' ? '×' : '✓' }}</span>{{ toast.text }}
    </div>
  </Transition>
</template>
