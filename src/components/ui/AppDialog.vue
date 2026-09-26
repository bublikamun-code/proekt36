<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  closeLabel?: string
}>(), {
  description: '',
  closeLabel: 'Закрыть диалог',
})

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = `dialog-title-${useId()}`
const descriptionId = `dialog-description-${useId()}`
let previousFocus: HTMLElement | null = null

const focusFirstControl = async () => {
  await nextTick()
  const target = dialog.value?.querySelector<HTMLElement>('[autofocus], input:not([type="hidden"]), textarea, select, button:not(.app-dialog-close), [tabindex]:not([tabindex="-1"])')
  target?.focus()
}

const show = async () => {
  await nextTick()
  if (!dialog.value || dialog.value.open) return
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value.showModal()
  await focusFirstControl()
}

const requestClose = () => dialog.value?.close()

const onClose = () => {
  emit('close')
  void nextTick(() => previousFocus?.focus())
}

const onBackdrop = (event: MouseEvent) => {
  if (event.target === dialog.value) requestClose()
}

onMounted(() => { if (props.open) void show() })
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close() })
watch(() => props.open, (open) => { if (open) void show(); else requestClose() })
</script>

<template>
  <dialog
    ref="dialog"
    class="app-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
    @cancel.prevent="requestClose"
    @close="onClose"
    @click="onBackdrop"
  >
    <section class="app-dialog-shell">
      <header class="app-dialog-head">
        <div>
          <h2 :id="titleId">{{ title }}</h2>
          <p v-if="description" :id="descriptionId">{{ description }}</p>
        </div>
        <button class="icon-button app-dialog-close" type="button" :aria-label="closeLabel" @click="requestClose">×</button>
      </header>
      <div class="app-dialog-body"><slot /></div>
    </section>
  </dialog>
</template>
