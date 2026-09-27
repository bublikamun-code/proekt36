<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { categoryLabels } from '../../data/catalog'
import { beginBoardDrag } from '../../composables/useBoardDrag'
import { getProductFootprintModules } from '../../domain/layout'
import type { BusType, Category, DeviceDefinition, ModelAsset, StoredModelAsset } from '../../domain/types'
import { detectImportKind, validateGltfZip, validateModelFile, type PreparedImport } from '../../storage/modelImportFlow'
import { getModelAsset } from '../../storage/modelDb'
import { getThumbnail, measureModelBytes } from '../../services/modelRender'
import { verificationLabel as verificationLabelBase } from '../../domain/verification'
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
const { definitions, modelLibrary } = storeToRefs(store)
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
const deleteModelId = ref<string | null>(null)

interface ImportFormState {
  asset: StoredModelAsset
  product: DeviceDefinition | null
  createProduct: boolean
  /** An existing asset with the same file name and size, offered for an in-place refresh. */
  replacing: StoredModelAsset | null
  /** Raw model size in millimetres before the transform scale is applied. */
  rawMm: { width: number; height: number; depth: number }
  rotationDeg: number
}
const importForm = ref<ImportFormState | null>(null)

const productModel = (product: DeviceDefinition): ModelAsset | undefined => store.resolveProductModel(product)
const stubProduct = (assetId: string) => modelLibrary.value.products.find((item) => item.id === assetId)

const roundMm = (value: number) => Math.round(value)
/** After-scale size in millimetres, so the operator can check it against the expected footprint. */
const scaledMm = (form: ImportFormState) => ({
  width: roundMm(form.rawMm.width * form.asset.transform.scale),
  height: roundMm(form.rawMm.height * form.asset.transform.scale),
  depth: roundMm(form.rawMm.depth * form.asset.transform.scale),
})
const widthMismatch = computed(() => {
  const form = importForm.value
  if (!form?.product) return false
  const expected = Math.max(1, form.product.moduleWidth) * 18
  return Math.abs(scaledMm(form).width - expected) / expected > 0.3
})

const products = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('ru')
  return [...definitions.value.values()].filter((product) => {
    const matchesCategory = category.value === 'all' || product.category === category.value
    const matchesSearch = !term || `${product.name} ${product.brand} ${product.sku}`.toLocaleLowerCase('ru').includes(term)
    // Most of the catalogue is generated from a series template, so "verified" is the exception
    // rather than the rule. Imported models carry no status at all and count as unverified.
    const matchesVerification = !verifiedOnly.value || product.verificationStatus === 'verified'
    return matchesCategory && matchesSearch && matchesVerification
  })
})

// The shared provenance ladder; the catalogue hides the flag on verified entries.
const verificationLabel = (product: DeviceDefinition) =>
  product.verificationStatus === 'verified' ? '' : verificationLabelBase(product)

const browse = () => fileInput.value?.click()
/**
 * glTF is metres; modellers export DIN devices in millimetres about as often. A raw width
 * thousands of times wider than a rail is a millimetre model, and the operator confirms the
 * suggested ÷1000 once instead of wondering why the preview is a dot.
 */
const suggestScale = (rawMm: { width: number }) => {
  if (rawMm.width >= 10_000 && rawMm.width <= 600_000) return 0.001
  return 1
}

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
    const draft = prepared.value.draft
    let rawMm = { width: 0, height: 0, depth: 0 }
    try {
      const measured = await measureModelBytes(data)
      rawMm = { width: measured.width * 1000, height: measured.height * 1000, depth: measured.depth * 1000 }
    } catch {
      // Measurement failing must not block the import; the transform stays editable by hand.
    }
    // Same name and byte length means the file is back, most likely after a browser wipe or on
    // another machine. Refreshing that asset keeps its id, so old placed devices revive. A
    // missing asset has no bytes left to compare, so its name alone claims the file.
    let replacing: StoredModelAsset | null = null
    for (const asset of modelLibrary.value.assets) {
      if (asset.fileName !== file.name) continue
      const record = asset.missing ? undefined : await getModelAsset(asset.id).catch(() => null)
      if (record === null) continue
      if (!record || record.data.byteLength === data.byteLength) { replacing = asset; break }
    }
    if (replacing) {
      const stub = stubProduct(replacing.id)
      importForm.value = {
        asset: { ...replacing, missing: false, format: draft.format, transform: { ...replacing.transform } },
        product: stub ? { ...stub } : null,
        createProduct: Boolean(stub),
        replacing,
        rawMm,
        rotationDeg: Math.round((replacing.transform.rotationY * 180) / Math.PI),
      }
    } else {
      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      importForm.value = {
        asset: {
          id, name: draft.name, source: 'local', format: draft.format,
          transform: { scale: suggestScale(rawMm), rotationY: 0 }, fileName: draft.fileName, createdAt,
        },
        product: {
          id, name: draft.name, brand: draft.brand, sku: draft.sku, category: draft.category,
          moduleWidth: draft.moduleWidth, poles: draft.poles, ratedCurrent: draft.ratedCurrent,
          voltage: draft.voltage, bus: draft.bus, price: draft.price, weight: draft.weight,
          height: draft.height, depth: draft.depth, imported: true, modelId: id,
        },
        createProduct: true,
        replacing: null,
        rawMm,
        rotationDeg: 0,
      }
    }
  } catch (error) {
    prepared.value = null
    importForm.value = null
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
    const form = importForm.value
    form.asset.name = form.product?.name?.trim() || form.asset.name
    form.asset.transform.rotationY = (form.rotationDeg * Math.PI) / 180
    const savedAsset = { ...form.asset }
    await store.addImportedModel(form.createProduct && form.product ? { ...form.product, modelId: savedAsset.id } : null, savedAsset, prepared.value.data)
    void getThumbnail(savedAsset).catch(() => undefined)
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
        <DeviceVisual :product="product" :model="productModel(product)" :width="Math.min(44, 20 + product.moduleWidth * 5)" />
        <span class="item-copy">
          <strong>{{ product.name }}</strong>
          <small>{{ product.brand }} · {{ product.sku }}</small>
          <span class="specs"><b>{{ product.moduleWidth }} мод.</b><b>{{ product.ratedCurrent }} A</b><b>{{ product.price > 0 ? `${product.price.toLocaleString('ru-RU')} ₽` : '«уточняется»' }}</b><b v-if="verificationLabel(product)" class="verify-flag">{{ verificationLabel(product) }}</b></span>
        </span>
        <span v-if="productModel(product)" class="import-badge cad-badge">CAD</span>
        <svg class="add-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>
      </button>
      <div v-if="!products.length" class="empty-list">Ничего не найдено. Измените запрос.</div>
    </div>

    <section class="model-import" aria-labelledby="model-import-title">
      <div class="panel-heading compact-heading">
        <div><span class="eyebrow">IndexedDB</span><h3 id="model-import-title">CAD-модели</h3></div>
        <span class="mono count">{{ modelLibrary.assets.length }}</span>
      </div>
      <input ref="fileInput" class="sr-only" tabindex="-1" aria-label="Файл CAD-модели" type="file" accept=".glb,.gltf,.zip,model/gltf-binary,model/gltf+json,application/zip" @change="onFile" />
      <button class="upload-button" :disabled="adding" @click="browse"><span>＋</span>{{ adding ? 'Проверка файла…' : 'Импорт .glb / .gltf / .zip' }}</button>
      <p class="file-help">GLB напрямую; glTF с ресурсами в ZIP. До 50 МБ.</p>
      <div v-if="importError" class="error-text" role="alert"><b>Ошибка импорта</b>{{ importError }}</div>
      <div v-for="model in modelLibrary.assets" :key="model.id" class="model-row" :class="{ 'is-missing': model.missing }">
        <span><b>{{ model.name }}</b><small>{{ model.missing ? 'файл потерян · переимпортируйте' : `${model.fileName || model.id} · ${stubProduct(model.id)?.moduleWidth ?? '?'} мод.` }}</small></span>
        <button class="icon-button danger" :aria-label="`Удалить модель ${model.name}`" @click="askRemoveModel(model.id)">×</button>
      </div>
    </section>

    <AppDialog :open="Boolean(prepared && importForm)" title="Параметры импорта" description="Проверьте габариты модели и параметры товара перед добавлением в локальную библиотеку." @close="prepared = null; importForm = null">
      <div v-if="importForm" class="form-grid">
        <p v-if="importForm.replacing" class="import-note" role="status">
          Файл совпал с существующей моделью «{{ importForm.replacing.name }}» — она будет обновлена на месте. Устройства из прежних проектов оживут без повторной расстановки.
        </p>
        <p class="import-note mono">Габариты после масштаба: {{ scaledMm(importForm).width }} × {{ scaledMm(importForm).height }} × {{ scaledMm(importForm).depth }} мм</p>
        <label>Масштаб<input v-model.number="importForm.asset.transform.scale" type="number" min="0.000001" max="1000" step="0.001" /></label>
        <label>Поворот Y, °<input v-model.number="importForm.rotationDeg" type="number" min="-360" max="360" step="15" /></label>
        <p v-if="widthMismatch && importForm.product" class="import-note warn" role="alert">
          Ширина модели ({{ scaledMm(importForm).width }} мм) заметно отличается от ожидаемой {{ Math.max(1, importForm.product.moduleWidth) * 18 }} мм — проверьте масштаб или число модулей.
        </p>
        <label class="wide checkbox-row"><input v-model="importForm.createProduct" type="checkbox" />Создать товар-заготовку в каталоге</label>
        <template v-if="importForm.createProduct && importForm.product">
          <label class="wide">Название<input v-model="importForm.product.name" required /></label>
          <label>Бренд<input v-model="importForm.product.brand" /></label>
          <label>Артикул<input v-model="importForm.product.sku" /></label>
          <label>Категория<AppSelect label="Категория" :model-value="importForm.product.category" :options="categoryOptions" @update:model-value="importForm.product.category = $event as Category" /></label>
          <label>Модулей<input v-model.number="importForm.product.moduleWidth" type="number" min="0.5" max="24" step="0.5" /></label>
          <label>Высота, мм<input v-model.number="importForm.product.height" type="number" min="10" /></label>
          <label>Глубина, мм<input v-model.number="importForm.product.depth" type="number" min="10" /></label>
          <label>Полюсов<input v-model.number="importForm.product.poles" type="number" min="1" max="12" /></label>
          <label>Ток, А<input v-model.number="importForm.product.ratedCurrent" type="number" min="0.1" /></label>
          <label>Шина<AppSelect label="Шина" :model-value="importForm.product.bus" :options="BUS_OPTIONS" @update:model-value="importForm.product.bus = $event as BusType" /></label>
          <label>Цена, ₽<input v-model.number="importForm.product.price" type="number" min="0" /></label>
          <label>Вес, кг<input v-model.number="importForm.product.weight" type="number" min="0" step="0.01" /></label>
        </template>
      </div>
      <div class="app-dialog-actions"><button type="button" @click="prepared = null; importForm = null">Отмена</button><button class="primary-button" type="button" @click="confirmImport">{{ importForm?.replacing ? 'Обновить модель' : 'Добавить в библиотеку' }}</button></div>
    </AppDialog>
    <AppDialog :open="Boolean(deleteModelId)" title="Удалить модель?" description="Локальный CAD-файл будет удалён. Это действие нельзя отменить." @close="deleteModelId = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="deleteModelId = null">Отмена</button><button class="danger-button" type="button" @click="removeModel">Удалить</button></div>
    </AppDialog>
  </aside>
</template>
