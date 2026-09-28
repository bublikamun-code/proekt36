<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { DeviceDefinition, ModelAsset, StoredModelAsset } from '../domain/types'
import { downloadWorkspaceBackup } from '../domain/projectBackup'
import { detectImportKind, validateGltfZip, validateModelFile } from '../storage/modelImportFlow'
import { getModelAsset } from '../storage/modelDb'
import { getThumbnail } from '../services/modelRender'
import { useProjectStore } from '../stores/project'
import { usePreferencesStore } from '../stores/preferences'
import AppDialog from '../components/ui/AppDialog.vue'
import BrandMark from '../components/ui/BrandMark.vue'

const store = useProjectStore()
const preferences = usePreferencesStore()
const { projects, modelLibrary, definitions, modelAssetsById, storageStatus, lastSavedAt } = storeToRefs(store)
const { theme } = storeToRefs(preferences)

const statusLabel = computed(() => ({ saving: 'Сохранение…', saved: 'Сохранено', 'save-failed': 'Не сохранено', 'storage-unavailable': 'Хранилище недоступно' }[storageStatus.value]))
const savedAtLabel = computed(() => lastSavedAt.value ? new Date(lastSavedAt.value).toLocaleString('ru-RU') : '—')

const usage = ref<{ usage: number; quota: number } | null>(null)
void (async () => {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (typeof estimate?.usage === 'number' && typeof estimate?.quota === 'number') usage.value = { usage: estimate.usage, quota: estimate.quota }
  } catch { /* the estimate is a courtesy, not a feature */ }
})()
const mb = (value: number) => `${(value / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`

/** One row per asset, with the products it serves either as a stub or as a binding. */
interface LibraryRow {
  asset: ModelAsset
  stub: DeviceDefinition | undefined
  boundProducts: string[]
}
const libraryRows = computed<LibraryRow[]>(() => {
  const stubs = new Map(modelLibrary.value.products.map((product) => [product.id, product]))
  const bound = new Map<string, string[]>()
  for (const [productId, modelId] of Object.entries(modelLibrary.value.bindings)) {
    bound.set(modelId, [...(bound.get(modelId) ?? []), productId])
  }
  return [...modelAssetsById.value.values()].map((asset) => ({
    asset,
    stub: stubs.get(asset.id),
    boundProducts: (bound.get(asset.id) ?? []).map((productId) => definitions.value.get(productId)?.name ?? productId),
  }))
})
const productName = (ids: string[]) => ids.join(', ')

const removeTarget = ref<string | null>(null)
const clearConfirmOpen = ref(false)
const importError = ref('')
const importBusy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const browse = () => fileInput.value?.click()

/**
 * Re-import in place: a file with a known name and byte length refreshes that asset,
 * keeping the id (and therefore every placement) alive. A brand-new file is declined here —
 * the catalogue panel owns first imports together with the product stub form.
 */
const onReimport = async (event: Event) => {
  importError.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importBusy.value = true
  try {
    const kind = detectImportKind(file)
    const data = await file.arrayBuffer()
    const prepared = kind === 'zip' ? validateGltfZip(data, file) : await validateModelFile(file)
    let target: StoredModelAsset | undefined
    for (const asset of modelLibrary.value.assets) {
      if (asset.fileName !== file.name) continue
      const record = asset.missing ? undefined : await getModelAsset(asset.id).catch(() => null)
      if (record === null) continue
      if (!record || record.data.byteLength === data.byteLength) { target = asset; break }
    }
    if (!target) {
      importError.value = 'Такого файла нет в библиотеке. Первый импорт выполняется в панели каталога редактора.'
      return
    }
    const stub = modelLibrary.value.products.find((product) => product.id === target.id)
    const refreshed: StoredModelAsset = { ...target, missing: false }
    await store.addImportedModel(stub ? { ...stub } : null, refreshed, prepared.data)
    void getThumbnail(refreshed).catch(() => undefined)
  } catch (error) {
    importError.value = error instanceof Error ? error.message : 'Не удалось обновить модель'
  } finally {
    importBusy.value = false
    input.value = ''
  }
}

const removeModel = async () => {
  if (!removeTarget.value) return
  await store.deleteImportedModel(removeTarget.value)
  removeTarget.value = null
}
const unbind = (productId: string) => store.bindProductModel(productId, null)
const saveNow = () => { void store.persistNow() }
const exportBackup = () => downloadWorkspaceBackup(projects.value, modelLibrary.value, store.currentProjectId)
const clearData = async () => {
  await store.clearLocalData()
  clearConfirmOpen.value = false
}
</script>

<template>
  <div class="app-shell settings-shell">
    <header class="app-header">
      <BrandMark />
      <div class="header-status" :class="{ 'status-error': storageStatus === 'save-failed', 'status-warning': storageStatus === 'storage-unavailable' }" role="status" aria-live="polite"><i></i><span>{{ statusLabel }}</span></div>
      <div class="header-actions">
        <button class="toolbar-button" :disabled="storageStatus === 'saved'" @click="saveNow">Сохранить</button>
        <button class="toolbar-button icon-only" :aria-label="theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'" @click="preferences.setTheme(theme === 'light' ? 'dark' : 'light')">{{ theme === 'light' ? '◐' : '○' }}</button>
      </div>
    </header>

    <main class="settings-page">
      <section class="settings-section" aria-labelledby="settings-title">
        <div class="panel-heading"><div><span class="eyebrow">Кабинет</span><h1 id="settings-title">Настройки</h1></div></div>

        <div class="settings-block">
          <h2>Оформление</h2>
          <label class="checkbox-row"><input type="radio" name="theme" value="light" :checked="theme === 'light'" @change="preferences.setTheme('light')" />Светлая тема</label>
          <label class="checkbox-row"><input type="radio" name="theme" value="dark" :checked="theme === 'dark'" @change="preferences.setTheme('dark')" />Тёмная тема</label>
        </div>

        <div class="settings-block">
          <h2>Локальное хранилище</h2>
          <p class="microcopy">Проекты хранятся в этом браузере. Последнее сохранение: {{ savedAtLabel }}.</p>
          <p v-if="usage" class="microcopy mono">Занято {{ mb(usage.usage) }} из {{ mb(usage.quota) }}</p>
          <div class="button-row">
            <button @click="saveNow">Сохранить сейчас</button>
            <button @click="exportBackup">Экспортировать копию</button>
            <button class="danger" data-local-clear @click="clearConfirmOpen = true">Очистить локальные данные</button>
          </div>
        </div>

        <div class="settings-block" aria-labelledby="cad-library-title">
          <h2 id="cad-library-title">Библиотека CAD-моделей</h2>
          <p class="microcopy">Первый импорт выполняется в панели каталога редактора; здесь можно обновить файл на месте (совпадение имени и размера) — устройства в проектах сохранят привязку.</p>
          <input ref="fileInput" class="sr-only" tabindex="-1" aria-label="Файл CAD-модели для обновления" type="file" accept=".glb,.gltf,.zip,model/gltf-binary,model/gltf+json,application/zip" @change="onReimport" />
          <div class="button-row">
            <button :disabled="importBusy" @click="browse">{{ importBusy ? 'Проверка файла…' : 'Обновить модель из файла' }}</button>
          </div>
          <div v-if="importError" class="error-text" role="alert"><b>Ошибка обновления</b>{{ importError }}</div>
          <table class="settings-table">
            <thead><tr><th>Модель</th><th>Файл</th><th>Обслуживает товары</th><th>Состояние</th><th></th></tr></thead>
            <tbody>
              <tr v-for="row in libraryRows" :key="row.asset.id">
                <td><strong>{{ row.asset.name }}</strong><small>{{ row.asset.source === 'embedded' ? 'встроенная' : 'локальная' }}</small></td>
                <td class="mono">{{ row.asset.fileName ?? '—' }}</td>
                <td>{{ row.stub ? `заготовка «${row.stub.name}»` : '—' }}{{ row.boundProducts.length ? productName(row.boundProducts) : '' }}</td>
                <td>
                  <span v-if="'missing' in row.asset && row.asset.missing" class="verify-flag">файл потерян</span>
                  <span v-else>готова</span>
                </td>
                <td>
                  <button v-if="row.asset.source === 'local'" class="icon-button danger" :aria-label="`Удалить модель ${row.asset.name}`" @click="removeTarget = row.asset.id">×</button>
                </td>
              </tr>
              <tr v-if="!libraryRows.length"><td colspan="5">Библиотека пуста.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="settings-block" aria-labelledby="bindings-title">
          <h2 id="bindings-title">Привязки моделей к товарам</h2>
          <p class="microcopy">Модель можно привязать к товару каталога в инспекторе редактора; здесь привязку можно снять.</p>
          <table class="settings-table" v-if="Object.keys(modelLibrary.bindings).length">
            <thead><tr><th>Товар</th><th>Модель</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(modelId, productId) in modelLibrary.bindings" :key="productId">
                <td>{{ definitions.get(productId)?.name ?? productId }}</td>
                <td>{{ modelAssetsById.get(modelId)?.name ?? modelId }}</td>
                <td><button class="icon-button danger" :aria-label="`Снять привязку с товара ${definitions.get(productId)?.name ?? productId}`" @click="unbind(productId)">×</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="microcopy">Привязок нет.</p>
        </div>
      </section>
    </main>

    <AppDialog :open="Boolean(removeTarget)" title="Удалить модель?" description="Локальный CAD-файл и заготовка товара будут удалены. Это действие нельзя отменить." @close="removeTarget = null">
      <div class="app-dialog-actions"><button type="button" autofocus @click="removeTarget = null">Отмена</button><button class="danger-button" type="button" @click="removeModel">Удалить</button></div>
    </AppDialog>
    <AppDialog :open="clearConfirmOpen" title="Очистить локальные данные?" description="Все локальные проекты и импортированные CAD-модели будут удалены. Это действие нельзя отменить." @close="clearConfirmOpen = false">
      <div class="app-dialog-actions"><button type="button" autofocus @click="clearConfirmOpen = false">Отмена</button><button class="danger-button" type="button" @click="clearData">Очистить всё</button></div>
    </AppDialog>
  </div>
</template>
