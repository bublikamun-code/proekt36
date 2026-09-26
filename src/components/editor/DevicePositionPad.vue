<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getRowCapacity } from '../../domain/layout'
import { useProjectStore } from '../../stores/project'
import AppSelect, { type AppSelectOption } from '../ui/AppSelect.vue'

const store = useProjectStore()
const { currentProject, selectedDevice, selectedProduct } = storeToRefs(store)
const selectedRow = computed(() => selectedDevice.value?.row ?? 0)
const selectedSlot = computed(() => selectedDevice.value?.slot ?? 0)
const capacity = computed(() => getRowCapacity(currentProject.value))
const slotIndexes = computed(() => Array.from({ length: capacity.value }, (_, index) => index))
const rowIndexes = computed(() => Array.from({ length: currentProject.value.settings.rows }, (_, index) => index))
const rowOptions = computed<AppSelectOption[]>(() => rowIndexes.value.map((row) => ({ value: String(row), label: String(row + 1) })))
const slotOptions = computed<AppSelectOption[]>(() => slotIndexes.value.map((slot) => ({ value: String(slot), label: String(slot + 1) })))
const rowInput = ref(String(selectedRow.value))
const slotInput = ref(String(selectedSlot.value))
watch([selectedRow, selectedSlot], ([row, slot]) => { rowInput.value = String(row); slotInput.value = String(slot) })
</script>

<template>
  <div v-if="selectedDevice && selectedProduct" class="position-pad" aria-label="Позиционирование устройства">
    <div class="pad-head"><span>Позиция <b class="mono">{{ selectedRow + 1 }}.{{ selectedSlot + 1 }}</b></span><small>по DIN</small></div>
    <form class="pad-keyboard-controls" aria-label="Перемещение по клавиатуре" @submit.prevent="store.moveSelected(Number(rowInput), Number(slotInput))">
      <label>Ряд<AppSelect label="Ряд" :model-value="String(rowInput)" :options="rowOptions" @update:model-value="rowInput = $event" /></label>
      <label>Модуль<AppSelect label="Модуль" :model-value="String(slotInput)" :options="slotOptions" @update:model-value="slotInput = $event" /></label>
      <button type="submit">Переместить с клавиатуры</button>
    </form>
    <div class="pad-grid" :style="{ gridTemplateColumns: `16px repeat(${capacity}, minmax(12px, 1fr))` }">
      <span v-for="row in rowIndexes" :key="`r-${row}`" class="pad-row-label" :aria-hidden="true">{{ row + 1 }}</span>
      <template v-for="row in rowIndexes" :key="row">
        <button v-for="slot in slotIndexes" :key="`${row}-${slot}`" class="pad-slot" :class="{ selected: row === selectedRow && slot === selectedSlot }" :aria-label="`Переместить в ряд ${row + 1}, модуль ${slot + 1}`" @click="store.moveSelected(row, slot)"></button>
      </template>
    </div>
  </div>
</template>
