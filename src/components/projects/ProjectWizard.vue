<script setup lang="ts">
import { computed, ref } from 'vue'
import AppDialog from '../ui/AppDialog.vue'

type WizardPayload = { name: string; preset: string }

const emit = defineEmits<{ close: []; create: [payload: WizardPayload] }>()
const name = ref('Новая панель')
const preset = ref('apartment')
const presets = [
  { id: 'apartment', title: 'Квартира', note: '1 фаза · 40 А', modules: 'Освещение, розетки, УЗО' },
  { id: 'house', title: 'Дом', note: '3 фазы · 63 А', modules: 'Полный набор, счётчик' },
  { id: 'workshop', title: 'Мастерская', note: '3 фазы · 100 А', modules: 'Силовые линии, контакторы' },
  { id: 'lighting', title: 'Освещение', note: '1 фаза · 25 А', modules: 'Группы и реле' },
  { id: 'demo', title: 'Demo board', note: 'Обзор щита', modules: 'Все категории' },
]
const activePreset = computed(() => presets.find((item) => item.id === preset.value) ?? presets[0])

const close = () => emit('close')
const submit = () => emit('create', { name: name.value.trim() || 'Новая панель', preset: preset.value })
</script>

<template>
  <AppDialog :open="true" title="Мастер панели" description="Создайте локальную заготовку и выберите стартовый пресет." @close="close">
    <div class="master-body">
        <fieldset>
          <legend>Назначение</legend>
          <label>Название проекта<input v-model="name" required maxlength="160" autofocus /></label>
          <div class="preset-grid" role="group" aria-label="Пресет панели">
            <button v-for="item in presets" :key="item.id" type="button" :class="{ active: preset === item.id }" :aria-pressed="preset === item.id" @click="preset = item.id">
              <strong>{{ item.title }}</strong><small>{{ item.note }}</small><span>{{ item.modules }}</span>
            </button>
          </div>
        </fieldset>
        <aside class="master-summary">
          <span class="eyebrow">Параметры</span>
          <dl>
            <div><dt>Сеть</dt><dd>{{ activePreset.note.split('·')[0] }}</dd></div>
            <div><dt>Вводной</dt><dd>{{ activePreset.note.split('·')[1] }}</dd></div>
            <div><dt>Стартовый состав</dt><dd>{{ activePreset.modules }}</dd></div>
          </dl>
          <p>Пресет создаёт заготовку. Все значения и состав можно изменить в инспекторе и каталоге.</p>
        </aside>
      </div>
      <div class="master-footer"><button type="button" @click="close">Отмена</button><button class="primary-button" type="button" @click="submit">Создать проект</button></div>
  </AppDialog>
</template>
