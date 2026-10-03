<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { categoryLabels } from '../../data/catalog'
import { beginBoardDrag } from '../../composables/useBoardDrag'
import { getProductFootprintModules } from '../../domain/layout'
import { uid } from '../../domain/project'
import { VERIFICATION_LABELS } from '../../domain/provenance'
import type { BusType, Category, DeviceDefinition, ModelMetadata } from '../../domain/types'
import { detectImportKind, validateGltfZip, validateModelFile, type PreparedImport } from '../../storage/modelImportFlow'
import { useProjectStore } from '../../stores/project'
import AppDialog from '../ui/AppDialog.vue'
import AppSelect, { type AppSelectOption } from '../ui/AppSelect.vue'

const BUS_OPTIONS: AppSelectOption[] = [
  { value: 'L', label: 'L' },
  { value: 'N', label: 'N' },
  { value: 'PE', label: 'PE' },
]

const categoryOptions = computed<AppSelectOption[]>(() => (Object.keys(categoryLabels) as Category[]).map((key) => ({ value: key, label: categoryLabels[key] })))
import DeviceVisual from './DeviceVisual.vue'

const props = defineProps<{ focusCategory?: Category | null }>()

const store = useProjectStore()
const { definitions, importedModels } = storeToRefs(store)
const search = ref('')
const category = ref<Category | 'all'>('all')
const verifiedOnly = ref(false)

// The assistant can point the catalogue at a category without touching the store, so the
// filter stays local view state and never becomes part of the saved project.
watch(() => props.focusCategory, (value) => { if (value) category.value = value })
const adding = ref(false)
const importError = ref('')
const prepared = ref<PreparedImport | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const importForm = ref<ModelMetadata | null>(null)
const deleteModelId = ref<string | null>(null)

const products = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('ru')
  return [...definitions.value.values()].filter((product) => {
    const matchesCategory = category.value === 'all' || product.category === category.value
    const matchesSearch = !term || `${product.name} ${product.brand} ${product.sku}`.toLocaleLowerCase('ru').includes(term)
    // Most of the catalogue is generated from a series template, so "verified" is the exception
    // rather than the rule. Positions whose parameters nobody checked are `unverified`.
    const matchesVerification = !verifiedOnly.value || product.verificationStatus === 'verified'
    return matchesCategory && matchesSearch && matchesVerification
  })
})

/**
 * The badge is empty for a confirmed position — the flag marks what is *not* confirmed. A
 * locally imported model is named as an import, because "parameters not confirmed" alone would
 * hide the more useful fact that the row came from the user's own file.
 */
const verificationLabel = (product: DeviceDefinition) => {
  if (product.verificationStatus === 'verified') return ''
  if (product.imported) return 'Импорт, не проверено'
  return VERIFICATION_LABELS[product.verificationStatus]
}

const browse = () => fileInput.value?.click()
const onFile = async (event: Event) => {
  importError.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  adding.value = true
  try {
    const kind = detectImportKind(file)
    const data = await file.arrayBuffer()
    prepared.value = kind === 'zip' ? validateGltfZip(data, file) : await validateModelFile(file)
    importForm.value = { id: uid(), ...prepared.value.metadata, createdAt: new Date().toISOString() }
  } catch (error) {
    prepared.value = null
    importError.value = error instanceof Error ? error.message : 'Не удалось проверить файл'
  } finally {
    adding.value = false
    input.value = ''
  }
}

const confirmImport = async () => {
  if (!prepared.value || !importForm.value) return
  adding.value = true
  try {
    await store.addImportedModel(importForm.value, prepared.value.data)
    prepared.value = null
    importForm.value = null
  } catch (error) {
    importError.value = error instanceof Error ? error.message : 'Не удалось сохранить модель'
  } finally { adding.value = false }
}

const startCatalogDrag = (event: PointerEvent, productId: string) => {
  const product = definitions.value.get(productId)
  if (!product) return
  beginBoardDrag({ kind: 'catalog', id: productId, width: getProductFootprintModules(product) }, event)
}

const askRemoveModel = async (id: string) => {
  deleteModelId.value = id
  await nextTick()
}
const removeModel = async () => {
  if (!deleteModelId.value) return
  await store.deleteImportedModel(deleteModelId.value)
  deleteModelId.value = null
}
</script>

<template>
  <aside class="catalog-panel" aria-label="Каталог устройств">
    <div class="panel-heading">
      <div><span class="eyebrow">Библиотека</span><h2>Каталог</h2></div>
      <span class="mono count">{{ products.length }}</span>
    </div>

    <div class="search-wrap">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 4 4"/></svg>
      <input v-model="search" type="search" aria-label="Поиск по каталогу" placeholder="Артикул, серия, ток" />
      <kbd>⌘K</kbd>
    </div>

    <div class="category-tabs" role="group" aria-label="Категории">
      <button type="button" :class="{ active: category === 'all' }" :aria-pressed="category === 'all'" @click="category = 'all'">Все</button>
      <button v-for="key in (Object.keys(categoryLabels) as Category[])" :key="key" type="button" :class="{ active: category === key }" :aria-pressed="category === key" @click="category = key" :title="categoryLabels[key]">
        {{ key === 'relay' ? 'Реле' : key === 'terminals' ? 'Клеммы' : key === 'meter' ? 'Счётчики' : key === 'PSU' ? 'Питание' : key }}
      </button>
    </div>

    <button type="button" class="filter-toggle" :class="{ active: verifiedOnly }" :aria-pressed="verifiedOnly" @click="verifiedOnly = !verifiedOnly">Только проверенные</button>

    <div class="catalog-list">
      <button v-for="product in products" :key="product.id" class="catalog-item" @click="store.addDevice(product.id)" @pointerdown="startCatalogDrag($event, product.id)">
        <DeviceVisual :product="product" :width="Math.min(44, 20 + product.moduleWidth * 5)" />
        <span class="item-copy">
          <strong>{{ product.name }}</strong>
          <small>{{ product.brand }} · {{ product.sku }}</small>
          <span class="specs"><b>{{ product.moduleWidth }} мод.</b><b>{{ product.ratedCurrent }} A</b><b>{{ product.price > 0 ? `${product.price.toLocaleString('ru-RU')} ₽` : '«уточняется»' }}</b><b v-if="verificationLabel(product)" class="verify-flag">{{ verificationLabel(product) }}</b></span>
        </span>
        <span v-if="product.modelPreviewUrl" class="import-badge cad-badge">CAD</span>
        <span v-else-if="product.imported" class="import-badge cad-badge">CAD</span>
        <svg class="add-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>
      </button>
      <div v-if="!products.length" class="empty-list">Ничего не найдено. Измените запрос.</div>
    </div>

    <section class="model-import" aria-labelledby="model-import-title">
      <div class="panel-heading compact-heading">
        <div><span class="eyebrow">IndexedDB</span><h3 id="model-import-title">CAD-модели</h3></div>
        <span class="mono count">{{ importedModels.length }}</span>
      </div>
      <input ref="fileInput" class="sr-only" tabindex="-1" aria-label="Файл CAD-модели" type="file" accept=".glb,.gltf,.zip,model/gltf-binary,model/gltf+json,application/zip" @change="onFile" />
      <button class="upload-button" :disabled="adding" @click="browse"><span>＋</span>{{ adding ? 'Проверка файла…' : 'Импорт .glb / .gltf / .zip' }}</button>
      <p class="file-help">GLB напрямую; glTF с ресурсами в ZIP. До 50 МБ.</p>
      <div v-if="importError" class="error-text" role="alert"><b>Ошибка импорта</b>{{ importError }}</div>
      <div v-for="model in importedModels" :key="model.id" class="model-row">
        <span><b>{{ model.name }}</b><small>{{ model.brand || model.fileName }} · {{ model.moduleWidth }} мод.</small></span>
        <button class="icon-button danger" :aria-label="`Удалить модель ${model.name}`" @click="askRemoveModel(model.id)">×</button>
      </div>
    </section>

    <AppDialog :open="Boolean(prepared && importForm)" title="Параметры импорта" description="Проверьте метаданные модели перед добавлением в локальную библиотеку." @close="prepared = null; importForm = null">
      <div v-if="importForm" class="form-grid">
        <label class="wide">Название<input v-model="importForm.name" required autofocus /></label>
        <label>Бренд<input v-model="importForm.brand" /></label>
        <label>Артикул<input v-model="importForm.sku" /></label>
        <label>Категория<AppSelect label="Категория" :model-value="importForm.category" :options="categoryOptions" @update:model-value="importForm.category = $event as Category" /></label>
        <label>Модулей<input v-model.number="importForm.moduleWidth" type="number" min="0.5" max="24" step="0.5" /></label>
        <label>Рядов<input v-model.number="importForm.rows" type="number" min="1" max="6" /></label>
        <label>Высота, мм<input v-model.number="importForm.height" type="number" min="10" /></label>
        <label>Глубина, мм<input v-model.number="importForm.depth" type="number" min="10" /></label>
        <label>Полюсов<input v-model.number="importForm.poles" type="number" min="1" max="12" /></label>
        <label>Ток, А<input v-model.number="importForm.ratedCurrent" type="number" min="0.1" /></label>
        <label>Шина<AppSelect label="Шина" :model-value="importForm.bus" :options="BUS_OPTIONS" @update:model-value="importForm.bus = $event as BusType" /></label>
        <label>Цена, ₽<input v-model.number="importForm.price" type="number" min="0" /></label>
        <label>Вес, кг<input v-model.number="importForm.weight" type="number" min="0" step="0.01" /></label>
      </div>
      <div class="app-dialog-actions"><button type="button" @click="prepared = null; importForm = null">Отмена</button><button class="primary-button" type="button" @click="confirmImport">Добавить в библиотеку</button></div>
    </AppDialog>
    <AppDialog :open="Boolean(deleteModelId)" title="Удалить модель?" description="Локальный CAD-файл будет удалён. Это действие нельзя отменить." @close="deleteModelId = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="deleteModelId = null">Отмена</button><button class="danger-button" type="button" @click="removeModel">Удалить</button></div>
    </AppDialog>
  </aside>
</template>
