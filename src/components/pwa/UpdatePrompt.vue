<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { shouldOfferUpdatePrompt, wireUpdateFlow, type UpdateContainerLike } from '../../services/serviceWorker'

/**
 * «Доступна новая версия» — the only place the app ever reloads itself. The worker installs
 * updates in the background and waits; nothing changes for the running page until the user
 * presses «Применить», so unsaved work cannot be lost to a deploy.
 */
const visible = ref(false)
let flow: { apply: () => void } | null = null
const applyUpdate = () => flow?.apply()

onMounted(() => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (!shouldOfferUpdatePrompt({
    production: import.meta.env.PROD,
    webdriver: Boolean((navigator as Navigator & { webdriver?: boolean }).webdriver),
    flag: import.meta.env.VITE_UPDATE_PROMPT,
  })) return
  flow = wireUpdateFlow(navigator.serviceWorker as unknown as UpdateContainerLike, {
    onReady: () => { visible.value = true },
    // The new worker only takes control after «Применить», so reaching this hook means the
    // user asked for it; the reload is what swaps the old document for the new one.
    onControllerChange: () => window.location.reload(),
  })
})
onBeforeUnmount(() => { flow = null })
</script>

<template>
  <transition name="update-prompt">
    <div v-if="visible" class="update-prompt" role="status">
      <span class="update-prompt-text">Доступна новая версия приложения. Применить обновление сейчас?</span>
      <span class="update-prompt-actions">
        <button type="button" class="update-prompt-later" @click="visible = false">Позже</button>
        <button type="button" class="primary-button" @click="applyUpdate">Применить</button>
      </span>
    </div>
  </transition>
</template>
