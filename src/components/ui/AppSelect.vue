<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface AppSelectOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: AppSelectOption[]
  /** Visible text of the associated <label>; becomes the trigger's accessible name. */
  label?: string
  placeholder?: string
  disabled?: boolean
  /** Renders the trigger full width, the default for form rows. */
  block?: boolean
}>(), {
  label: undefined,
  placeholder: 'Выберите',
  disabled: false,
  block: true,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const placement = ref<'below' | 'above'>('below')
const activeIndex = ref(-1)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const listbox = ref<HTMLElement | null>(null)
const popupStyle = ref<Record<string, string>>({})

const listboxId = `app-select-${Math.random().toString(36).slice(2, 9)}`
const triggerId = `${listboxId}-trigger`

const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue))
const selected = computed(() => props.options[selectedIndex.value])
const triggerText = computed(() => selected.value?.label || props.placeholder)

const enabledIndexes = computed(() => props.options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0))

const optionId = (index: number) => `${listboxId}-option-${index}`

const openMenu = async () => {
  if (props.disabled || open.value) return
  placement.value = 'below'
  open.value = true
  const focusIndex = selectedIndex.value >= 0 && !props.options[selectedIndex.value]?.disabled
    ? selectedIndex.value
    : enabledIndexes.value[0] ?? -1
  activeIndex.value = focusIndex
  await nextTick()
  positionPopup()
  scrollActiveIntoView()
  if (listbox.value) listbox.value.focus()
}

const closeMenu = (restoreFocus = false) => {
  if (!open.value) return
  open.value = false
  activeIndex.value = -1
  if (restoreFocus) trigger.value?.focus()
}

const choose = (index: number) => {
  const option = props.options[index]
  if (!option || option.disabled) return
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
  closeMenu(true)
}

const moveActive = (delta: number) => {
  const pool = enabledIndexes.value
  if (!pool.length) return
  const current = pool.indexOf(activeIndex.value)
  const next = current < 0
    ? (delta > 0 ? pool[0] : pool[pool.length - 1])
    : pool[(current + delta + pool.length) % pool.length]
  activeIndex.value = next
  scrollActiveIntoView()
}

const scrollActiveIntoView = () => {
  const list = listbox.value
  if (!list || activeIndex.value < 0) return
  const node = list.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex.value))}`)
  node?.scrollIntoView({ block: 'nearest' })
}

/** Places the popup above the trigger when there is not enough room below. */
const positionPopup = () => {
  const host = root.value
  const list = listbox.value
  if (!host || !list) return
  const rect = host.getBoundingClientRect()
  const margin = 8
  const height = list.offsetHeight
  const below = window.innerHeight - rect.bottom
  const above = rect.top
  placement.value = below >= height + margin || below >= above ? 'below' : 'above'
  const viewportWidth = window.innerWidth
  const width = rect.width
  const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))
  popupStyle.value = { width: `${width}px`, left: `${left - rect.left}px` }
  if (placement.value === 'above') list.style.bottom = `${host.offsetHeight}px`
  else list.style.top = `${host.offsetHeight}px`
}

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (props.disabled) return
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closeMenu(true)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    void openMenu()
  }
}

const onListKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown': event.preventDefault(); moveActive(1); break
    case 'ArrowUp': event.preventDefault(); moveActive(-1); break
    case 'Home': event.preventDefault(); activeIndex.value = enabledIndexes.value[0] ?? -1; scrollActiveIntoView(); break
    case 'End': event.preventDefault(); activeIndex.value = enabledIndexes.value.at(-1) ?? -1; scrollActiveIntoView(); break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (activeIndex.value >= 0) choose(activeIndex.value)
      else closeMenu(true)
      break
    case 'Escape': event.preventDefault(); closeMenu(true); break
    case 'Tab': closeMenu(); break
    default: break
  }
}

const onDocumentPointerDown = (event: MouseEvent) => {
  if (!open.value) return
  if (root.value && !root.value.contains(event.target as Node)) closeMenu()
}

const onReposition = () => { if (open.value) positionPopup() }

watch(() => props.modelValue, () => { if (open.value) closeMenu() })
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', onDocumentPointerDown)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
  } else {
    document.removeEventListener('mousedown', onDocumentPointerDown)
    window.removeEventListener('resize', onReposition)
    window.removeEventListener('scroll', onReposition, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown)
  window.removeEventListener('resize', onReposition)
  window.removeEventListener('scroll', onReposition, true)
})
</script>

<template>
  <div ref="root" class="app-select" :class="{ 'is-block': block, 'is-open': open, 'is-disabled': disabled, 'is-empty': !selected }">
    <button
      :id="triggerId"
      ref="trigger"
      type="button"
      class="app-select-trigger"
      :disabled="disabled"
      :aria-label="label"
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      @click="open ? closeMenu(true) : openMenu()"
      @keydown="onTriggerKeydown"
    >
      <span class="app-select-value">{{ triggerText }}</span>
      <svg class="app-select-caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>

    <div
      v-if="open"
      :id="listboxId"
      ref="listbox"
      class="app-select-listbox"
      :class="`is-${placement}`"
      :style="popupStyle"
      role="listbox"
      :aria-label="`${label}: варианты`"
      :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
      tabindex="-1"
      @keydown="onListKeydown"
    >
      <div
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.value"
        class="app-select-option"
        :class="{ 'is-selected': option.value === modelValue, 'is-active': index === activeIndex, 'is-disabled': option.disabled }"
        role="option"
        :aria-selected="option.value === modelValue"
        :aria-disabled="option.disabled || undefined"
        @mousemove="option.disabled ? undefined : (activeIndex = index)"
        @click.prevent.stop="choose(index)"
      >{{ option.label }}</div>
      <p v-if="!options.length" class="app-select-empty">Нет вариантов</p>
    </div>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.app-select.is-block {
  display: flex;
  width: 100%;
}
.app-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 1px;
  background: var(--surface-raised);
  color: var(--text);
  font-size: var(--text-xs);
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.app-select.is-empty .app-select-value {
  color: var(--text-faint);
}
.app-select-trigger:hover:not(:disabled) {
  border-color: var(--text-faint);
}
.app-select-trigger:disabled {
  color: var(--text-muted);
  background: var(--canvas);
  cursor: not-allowed;
}
.app-select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-select-caret {
  width: 9px;
  height: 6px;
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform .14s ease;
}
.app-select.is-open .app-select-caret {
  transform: rotate(180deg);
}
.app-select-listbox {
  position: absolute;
  z-index: 60;
  left: 0;
  max-height: 264px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--surface-raised);
  box-shadow: 0 12px 30px -12px rgba(20, 30, 25, .45), 0 2px 6px -2px rgba(20, 30, 25, .22);
  scrollbar-width: thin;
}
.app-select-listbox:focus {
  outline: none;
}
.app-select-option {
  display: block;
  padding: 6px 8px;
  border-radius: 1px;
  color: var(--text);
  font-size: var(--text-xs);
  line-height: 1.35;
  cursor: pointer;
}
.app-select-option.is-active {
  background: var(--line-soft);
}
.app-select-option.is-selected {
  color: var(--accent);
  font-weight: 700;
}
.app-select-option.is-selected::after {
  content: ' ✓';
  color: var(--accent);
}
.app-select-option.is-disabled {
  color: var(--text-faint);
  cursor: not-allowed;
}
.app-select-empty {
  margin: 0;
  padding: 8px;
  color: var(--text-faint);
  font-size: var(--text-xs);
}
</style>
