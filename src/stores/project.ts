import { computed, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import { builtinCatalog, workspaceCatalog } from '../data/catalog'
import {
  compactRow,
  evaluateCabinetMigration,
  getFootprintModules,
  getRowCapacity,
  MAX_ROWS,
  placeProduct,
  resolveDeviceMove,
  type LayoutMigrationPlan,
} from '../domain/layout'
import { autoNumber, createProject, migrateProject, presetProducts, uid } from '../domain/project'
import type { RestoredWorkspaceBackup } from '../domain/projectBackup'
import { downloadJsonFile } from '../domain/projectBackup'
import { assertValidProjectSchema, PROJECT_LIMITS, PROJECT_SCHEMA_VERSION } from '../domain/projectSchema'
import type { BusType, Circuit, Connection, DeviceDefinition, ModelMetadata, PanelProject, PlacedDevice, ProjectSettings } from '../domain/types'
import { clearModelAssets, deleteModelAsset, putModelAsset } from '../storage/modelDb'
import { wireRouteError } from '../domain/wireRoute'
import { CONNECTION_THICKNESS_MM } from '../domain/connectionSpec'
import { connectionTouchesTerminal, connectionKey, faceTerminals, terminalForBus, wireColor } from '../domain/wiring'
import { actionableStorageError, WorkspaceRepository, type StorageBackupData, type StorageRecovery } from '../storage/projectRepository'
import { usePreferencesStore } from './preferences'

const HISTORY_LIMIT = 50
const COALESCE_WINDOW_MS = 800
/**
 * Autosave debounce. Kept short on purpose: this is the longest a single edit can exist only in
 * memory, and the store flushes the pending write on `pagehide` and on tab hiding anyway.
 */
export const PERSIST_DELAY_MS = 200
type ProjectHistory = { undo: PanelProject[]; redo: PanelProject[] }
type StorageStatus = 'saving' | 'saved' | 'save-failed' | 'storage-unavailable'

// structuredClone beats the JSON round-trip, but it refuses to walk a reactive proxy:
// devices can carry nested proxies (e.g. a definition straight from the reactive catalog),
// while toRaw only peels the top level. Raw payloads take the fast path; anything that
// still holds a proxy falls back to JSON, which reads through the getters.
const clone = <T>(value: T): T => {
  const raw = toRaw(value as object)
  try {
    return structuredClone(raw) as T
  } catch {
    return JSON.parse(JSON.stringify(raw)) as T
  }
}

const seedProject = () => {
  const project = createProject('Освещение квартиры', 'apartment', presetProducts('apartment').settings)
  // A fixed identity, not a fresh one on every load. This project is not written to storage until
  // the user changes something, so with a random id a refresh would build a different one and the
  // editor's deep link would point at a project that no longer exists — the user would land on the
  // project list instead of the board they were on. Saving the seed on first load would fix the
  // same thing by writing to storage before there is anything to save, which is the opposite of
  // what the app promises.
  project.id = 'sample-apartment'
  project.schemaVersion = PROJECT_SCHEMA_VERSION
  project.settings = { inputCurrent: 40, phase: 1, enclosureWidth: 540, enclosureHeight: 650, enclosureDepth: 110, rows: 9, reserveModules: 8 }
  const definitions = new Map(builtinCatalog.map((item) => [item.id, item]))
  const products = [
    definitions.get('ekf-spd-t1-3p-n-pe')!, definitions.get('ekf-mcb-4p-b32')!,
    definitions.get('ekf-rccb-4p-40')!, definitions.get('ekf-mcb-1p-c6')!,
    definitions.get('ekf-mcb-1p-c6')!, definitions.get('ekf-mcb-1p-b16')!,
    definitions.get('ekf-mcb-1p-c6')!, definitions.get('ekf-terminal-1p-gray')!,
    definitions.get('iek-terminal-1p-blue')!,
  ]
  let devices: PlacedDevice[] = []
  for (const [index, product] of products.entries()) {
    const result = placeProduct(devices, product, index < 4 ? 0 : 1, index < 4 ? index : index - 4, getRowCapacity(project), uid, definitions)
    devices = result.devices
  }
  project.devices = autoNumber(devices, definitions)
  return project
}

export const useProjectStore = defineStore('project', () => {
  const preferences = usePreferencesStore()
  const repository = new WorkspaceRepository()
  const fallbackProject = seedProject()
  const loaded = repository.load([fallbackProject])
  const projects = ref<PanelProject[]>(loaded.projects.length ? loaded.projects : [fallbackProject])
  const currentProjectId = ref(loaded.currentProjectId && projects.value.some((project) => project.id === loaded.currentProjectId) ? loaded.currentProjectId : projects.value[0]!.id)
  const selectedDeviceId = ref<string | null>(null)
  const cabinetMigration = ref<LayoutMigrationPlan | null>(null)
  const importedModels = ref<ModelMetadata[]>(loaded.models)
  const histories = ref<Record<string, ProjectHistory>>({})
  const lastCoalesce = new Map<string, { key: string; at: number }>()
  const undoStack = computed(() => histories.value[currentProjectId.value]?.undo ?? [])
  const redoStack = computed(() => histories.value[currentProjectId.value]?.redo ?? [])
  const storageStatus = ref<StorageStatus>(!repository.available ? 'storage-unavailable' : loaded.recovery.length ? 'save-failed' : 'saved')
  const storageError = ref<string | null>(!repository.available ? 'Локальное хранилище браузера недоступно. Изменения останутся только до закрытия страницы; экспортируйте проект в JSON.' : loaded.recovery.length ? 'Обнаружены повреждённые локальные данные. Восстановлена последняя корректная копия; исходный снимок сохранён для восстановления.' : null)
  const storageRecovery = ref<StorageRecovery[]>(loaded.recovery)
  const storageBackup = ref<StorageBackupData>(loaded.backup)
  const lastSavedAt = ref<string | null>(null)
  const theme = computed({
    get: () => preferences.theme,
    set: (value: 'light' | 'dark') => preferences.setTheme(value),
  })
  const toast = ref<{ text: string; tone: 'ok' | 'error' } | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let projectsDirty = false
  let currentProjectDirty = false
  let persistenceError: string | null = storageError.value

  const updateStorageState = () => {
    if (!repository.available) {
      storageStatus.value = 'storage-unavailable'
      return
    }
    if (persistenceError) {
      storageStatus.value = 'save-failed'
      return
    }
    storageStatus.value = projectsDirty || currentProjectDirty ? 'saving' : 'saved'
  }

  const currentProject = computed(() => projects.value.find((item) => item.id === currentProjectId.value) ?? projects.value[0]!)
  const definitions = computed(() => new Map<string, DeviceDefinition>([
    ...workspaceCatalog.map((item) => [item.id, item] as const),
    ...importedModels.value.map((model) => [model.id, {
      id: model.id, name: model.name, brand: model.brand, sku: model.sku, category: model.category,
      moduleWidth: model.moduleWidth, poles: model.poles, ratedCurrent: model.ratedCurrent,
      voltage: model.voltage, bus: model.bus, price: model.price, weight: model.weight,
      height: model.height, depth: model.depth, color: '#d9ded8', imported: true, modelAssetId: model.id,
      // The numbers came from the import dialog, not from a datasheet, so the position is
      // unverified. The field is required precisely so this cannot be left out.
      verificationStatus: 'unverified',
    }] as const),
  ]))
  const selectedDevice = computed(() => currentProject.value.devices.find((item) => item.instanceId === selectedDeviceId.value) ?? null)
  const selectedProduct = computed(() => selectedDevice.value ? definitions.value.get(selectedDevice.value.productId) ?? null : null)

  /**
   * The selected wire.
   *
   * A wire was previously untouchable: it could be drawn and it could be undone, but there was
   * nothing to click, so the only way to get rid of one was to delete a device it happened to
   * touch. Selection is part of the same store state as the selected device and is deliberately not
   * written to storage — nobody returns to a page expecting a wire to still be picked.
   */
  const selectedConnectionId = ref<string | null>(null)
  const selectedConnection = computed(() => currentProject.value.connections.find((item) => item.id === selectedConnectionId.value) ?? null)
  const selectDevice = (instanceId: string | null) => {
    selectedDeviceId.value = instanceId
    if (instanceId) selectedConnectionId.value = null
  }
  const selectConnection = (connectionId: string | null) => {
    selectedConnectionId.value = connectionId
    if (connectionId) selectedDeviceId.value = null
  }

  const persistNow = async () => {
    if (!repository.available) {
      updateStorageState()
      return false
    }
    try {
      repository.save({ projects: projects.value, models: importedModels.value, currentProjectId: currentProjectId.value })
      projectsDirty = false
      currentProjectDirty = false
      persistenceError = null
      storageError.value = null
      storageRecovery.value = repository.recoveryData
      storageBackup.value = repository.backupData
      lastSavedAt.value = new Date().toISOString()
      updateStorageState()
      return true
    } catch (error) {
      persistenceError = actionableStorageError(error, 'проекты и модели')
      storageError.value = persistenceError
      updateStorageState()
      notify(persistenceError, 'error')
      return false
    }
  }

  const schedulePersistence = () => {
    projectsDirty = true
    if (!repository.available) {
      updateStorageState()
      return
    }
    clearTimeout(persistTimer)
    updateStorageState()
    persistTimer = setTimeout(() => { void persistNow() }, PERSIST_DELAY_MS)
  }

  const flushPersistence = async () => {
    clearTimeout(persistTimer)
    if (projectsDirty || currentProjectDirty) await persistNow()
    return storageStatus.value
  }

  const retryPersistence = async () => {
    projectsDirty = true
    return flushPersistence()
  }

  /**
   * Damaged local data is kept as a verbatim snapshot in the repository, so the user can
   * still get their own bytes back out of it. The banner stays until that happens or the
   * user acknowledges it — a successful autosave does not erase the fact that a snapshot
   * is waiting to be dealt with.
   */
  const storageRecoveryDismissed = ref(false)
  const storageRecoveryNotice = computed(() => {
    if (!storageRecovery.value.length || storageRecoveryDismissed.value) return null
    return 'Обнаружены повреждённые локальные данные. Восстановлена последняя корректная копия; исходный снимок сохранён — его можно скачать или откатиться к предыдущему снимку.'
  })
  const storageAlert = computed(() => storageError.value ?? storageRecoveryNotice.value)
  const hasStorageBackup = computed(() => Boolean(storageBackup.value.projects?.length))
  const hasStorageRecovery = computed(() => storageRecovery.value.length > 0)

  const downloadStorageSnapshot = () => {
    if (!storageRecovery.value.length) return false
    downloadJsonFile({ schema: 'panel36.storage-recovery.v1', exportedAt: new Date().toISOString(), records: storageRecovery.value }, `panel36-recovery-${new Date().toISOString().slice(0, 10)}.json`)
    return true
  }

  const dismissStorageAlert = () => { storageRecoveryDismissed.value = true }

  // The autosave debounce belongs to this store, so the store also owns flushing it: a tab
  // closed inside the debounce window used to drop the last edit. `pagehide` is the one
  // event a browser still delivers on close and on bfcache navigation, and the write it
  // triggers is synchronous, so it completes before the document goes away.
  //
  // `visibilitychange` covers the case `pagehide` misses: a phone that backgrounds the tab and
  // then reclaims its memory sends no close event at all, and there the debounced write was the
  // only thing standing between the user and their last edit.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { void flushPersistence() })
    // Guarded rather than assumed: the store is also built in headless tests, where `window`
    // exists as a stub without a document to listen on.
    if (typeof document?.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushPersistence()
      })
    }
  }

  watch([projects, importedModels], schedulePersistence, { deep: true })

  watch(currentProjectId, (id) => {
    selectedDeviceId.value = null
    selectedConnectionId.value = null
    cabinetMigration.value = null
    currentProjectDirty = true
    if (repository.available) {
      try {
        repository.saveCurrentProjectId(id)
        currentProjectDirty = false
        if (!projectsDirty && !storageRecovery.value.length) persistenceError = null
        updateStorageState()
      } catch (error) {
        persistenceError = actionableStorageError(error, 'текущий проект')
        storageError.value = persistenceError
        updateStorageState()
      }
    }
  })

  const notify = (text: string, tone: 'ok' | 'error' = 'ok') => {
    toast.value = { text, tone }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value = null }, 3500)
  }

  const historyFor = (id: string) => histories.value[id] ?? (histories.value[id] = { undo: [], redo: [] })

  const commit = (mutator: (project: PanelProject) => void, message?: string, options?: { coalesce?: string }) => {
    const history = historyFor(currentProjectId.value)
    const previous = clone(currentProject.value)
    const next = clone(currentProject.value)
    mutator(next)
    next.updatedAt = new Date().toISOString()
    const index = projects.value.findIndex((item) => item.id === currentProjectId.value)
    if (index < 0) return
    // Holding an arrow key is one gesture, not one undo step per repeat, so a run
    // of commits that share a key folds into the entry that run already made. The
    // entry to keep is the one the run pushed first — it is the state before the
    // gesture started, and the stack is only appended to, never reordered.
    const key = options?.coalesce
    const open = key ? lastCoalesce.get(currentProjectId.value) : undefined
    const folds = Boolean(key) && open?.key === key && Date.now() - open!.at < COALESCE_WINDOW_MS && history.undo.length > 0
    if (!folds) {
      history.undo.push(previous)
      if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
    }
    if (key) lastCoalesce.set(currentProjectId.value, { key, at: Date.now() })
    else lastCoalesce.delete(currentProjectId.value)
    history.redo = []
    projects.value[index] = next
    if (message) notify(message)
  }

  const switchProject = (id: string) => { if (projects.value.some((item) => item.id === id)) currentProjectId.value = id }

  const newProject = (name: string, preset: string) => {
    const config = presetProducts(preset)
    const project = createProject(name || 'Новая панель', preset, config.settings)
    projects.value.unshift(project)
    histories.value[project.id] = { undo: [], redo: [] }
    currentProjectId.value = project.id
    notify('Проект создан')
  }

  const duplicateProject = (id: string) => {
    const source = projects.value.find((item) => item.id === id)
    if (!source) return
    const copy = clone(source)
    copy.id = uid(); copy.name = `${source.name} — копия`; copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt
    projects.value.unshift(copy)
    histories.value[copy.id] = { undo: [], redo: [] }
    currentProjectId.value = copy.id
    notify('Проект продублирован')
  }

  const renameProject = (id: string, name: string) => {
    const project = projects.value.find((item) => item.id === id)
    if (!project || !name.trim()) return
    project.name = name.trim(); project.updatedAt = new Date().toISOString()
  }

  const deleteProject = (id: string) => {
    if (projects.value.length === 1) return notify('Нужен хотя бы один проект', 'error')
    const index = projects.value.findIndex((item) => item.id === id)
    projects.value = projects.value.filter((item) => item.id !== id)
    delete histories.value[id]
    if (currentProjectId.value === id) currentProjectId.value = projects.value[Math.max(0, index - 1)]!.id
    notify('Проект удалён')
  }

  const applyPreset = (preset: string) => commit((project) => {
    const config = presetProducts(preset)
    Object.assign(project.settings, config.settings)
    project.preset = preset
    const allowed = new Set(config.catalog)
    const products = definitions.value ? [...definitions.value.values()].filter((item) => allowed.has(item.category) && !item.imported) : []
    const unique = Array.from(new Map(products.map((item) => [item.category, item])).values()).slice(0, Math.min(7, config.settings.rows ?? project.settings.rows))
    const productsMap = new Map(definitions.value)
    let devices: PlacedDevice[] = []
    unique.forEach((product, index) => {
      const row = Math.floor(index / 4) % Math.max(1, project.settings.rows)
      const result = placeProduct(devices, product, row, 0, getRowCapacity(project), uid, productsMap)
      devices = result.devices
    })
    project.devices = autoNumber(devices, definitions.value)
  }, 'Пресет применён')

  const rejectCommand = (message: string) => {
    notify(message, 'error')
    return false
  }

  const finiteInRange = (value: unknown, min: number, max: number, integer = false) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))

  const validText = (value: unknown, max: number, nonEmpty = false) =>
    typeof value === 'string' && value.length <= max && (!nonEmpty || Boolean(value.trim()))

  const updateSettings = (patch: Partial<ProjectSettings>): boolean => {
    const values = patch as Record<string, unknown>
    const allowed = new Set(['inputCurrent', 'phase', 'enclosureWidth', 'enclosureHeight', 'enclosureDepth', 'rows', 'reserveModules'])
    if (Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Корпус и рейку меняйте только через подтверждаемую миграцию.')
    if ('inputCurrent' in values && !finiteInRange(values.inputCurrent, 1, 1000)) return rejectCommand('Вводной ток должен быть конечным числом от 1 до 1000 А.')
    if ('phase' in values && values.phase !== 1 && values.phase !== 3) return rejectCommand('Допустимая системная фаза: 1 или 3.')
    for (const key of ['enclosureWidth', 'enclosureHeight', 'enclosureDepth'] as const) {
      if (key in values && !finiteInRange(values[key], 1, 10000)) return rejectCommand(`Размер ${key} должен быть конечным числом от 1 до 10000 мм.`)
    }
    if ('rows' in values && !finiteInRange(values.rows, 1, PROJECT_LIMITS.rows, true)) return rejectCommand('Число рядов должно быть целым от 1 до 30.')
    if ('reserveModules' in values && !finiteInRange(values.reserveModules, 0, 1000, true)) return rejectCommand('Резерв должен быть целым от 0 до 1000 модулей.')
    commit((project) => Object.assign(project.settings, patch), 'Параметры обновлены')
    return true
  }

  const stageCabinetMigration = (id: string): LayoutMigrationPlan => {
    const plan = evaluateCabinetMigration(currentProject.value, definitions.value, id)
    cabinetMigration.value = plan
    return plan
  }

  const stageRailMigration = (id: 'rail-12' | 'rail-18'): LayoutMigrationPlan => {
    const cabinetId = currentProject.value.settings.cabinetId
    if (!cabinetId) return stageCabinetMigration(id)
    const plan = evaluateCabinetMigration(currentProject.value, definitions.value, cabinetId, id)
    cabinetMigration.value = plan
    return plan
  }

  const cancelCabinetMigration = () => { cabinetMigration.value = null }

  const commitCabinetMigration = (): boolean => {
    const staged = cabinetMigration.value
    if (!staged) return false
    if (staged.sourceUpdatedAt !== currentProject.value.updatedAt) {
      cancelCabinetMigration()
      return rejectCommand('Проект изменился после подготовки миграции. Проверьте новый план.')
    }
    const fresh = evaluateCabinetMigration(currentProject.value, definitions.value, staged.target.cabinetId, staged.target.railId)
    if (!fresh.canApply) {
      cabinetMigration.value = fresh
      return rejectCommand('Миграция невозможна: проверьте отсутствующие товары и свободные позиции.')
    }
    commit((project) => {
      project.settings = { ...fresh.settings }
      project.devices = fresh.devices.map((item) => ({ ...item }))
    }, 'Корпус и рейка обновлены')
    cabinetMigration.value = null
    return true
  }

  // Source-compatible aliases now stage an explicit transaction instead of
  // silently moving devices.
  const selectCabinet = (id: string) => { stageCabinetMigration(id) }
  const selectRail = (id: 'rail-12' | 'rail-18') => { stageRailMigration(id) }

  // Busbar wiring is offered only for the devices that were just inserted. An apparatus the
  // user deliberately left unwired must not gain a connection because something else was
  // added, so the scan walks the caller-supplied ids and nothing else.

  /**
   * `row` and `slot` stay optional so that a click in the catalogue, which names no position, can be
   * told apart from a drop, which does.
   *
   * A click searches rows from the top for the first one that will take the device. Refusing because
   * row 1 is full while row 2 is half empty is not a rule anyone would write on purpose — the person
   * clicking wanted the device on the board, and where it lands is bookkeeping. A drop, on the other
   * hand, lands exactly where it was dropped or not at all, so it never searches.
   */
  /**
   * Places a device and reports where it went, so a caller that can do better than "it failed" —
   * duplicating next to an original, for one — can try somewhere else without having to parse a
   * notice it cannot clear.
   */
  const addDevice = (productId: string, row?: number, slot = 0): { ok: boolean; row?: number; error?: string } => {
    const product = definitions.value.get(productId)
    if (!product) { notify('Товар не найден', 'error'); return { ok: false } }
    const capacity = getRowCapacity(currentProject.value)
    const candidates = row === undefined ? Array.from({ length: MAX_ROWS }, (_, index) => index) : [row]
    let result: ReturnType<typeof placeProduct> = { devices: currentProject.value.devices, slot }
    let landedRow = row
    for (const candidate of candidates) {
      result = placeProduct(currentProject.value.devices, product, candidate, slot, capacity, uid, definitions.value)
      if (!result.error) { landedRow = candidate; break }
    }
    if (result.error) { notify(result.error, 'error'); return { ok: false } }
    const previousIds = new Set(currentProject.value.devices.map((item) => item.instanceId))
    commit((project) => {
      project.devices = autoNumber(result.devices, definitions.value)
    })
    selectedDeviceId.value = result.devices.find((item) => !previousIds.has(item.instanceId))?.instanceId ?? null
    return { ok: true, row: landedRow }
  }

  const moveDeviceById = (instanceId: string, row: number, slot: number, options?: { coalesce?: string }) => {
    const device = currentProject.value.devices.find((item) => item.instanceId === instanceId)
    const product = device ? definitions.value.get(device.productId) : undefined
    if (!device || !product) return notify('Устройство не найдено', 'error')
    if (device.mount === 'busbar' && (!Number.isInteger(row) || row < 0 || row >= currentProject.value.settings.rows)) {
      return rejectCommand('Позиция за пределами ряда')
    }
    const result = resolveDeviceMove(currentProject.value.devices, instanceId, row, slot, getRowCapacity(currentProject.value), definitions.value)
    if (result.error) return notify(result.error, 'error')
    selectedDeviceId.value = instanceId
    // A nudge that lands where the device already is must not leave an undo entry
    // or a save behind; holding an arrow key at the end of a rail would do both.
    const unchanged = result.devices.length === currentProject.value.devices.length
      && result.devices.every((item) => {
        const before = currentProject.value.devices.find((entry) => entry.instanceId === item.instanceId)
        return Boolean(before) && before!.row === item.row && before!.slot === item.slot
      })
    if (unchanged) return
    commit((project) => { project.devices = autoNumber(result.devices, definitions.value) }, undefined, { coalesce: options?.coalesce })
  }

  const moveSelected = (row: number, slot: number) => {
    if (!selectedDeviceId.value) return
    moveDeviceById(selectedDeviceId.value, row, slot)
  }

  /** One arrow-key step. Repeats of the same device fold into a single undo entry. */
  const nudgeSelectedDevice = (rowDelta: number, slotDelta: number) => {
    const device = currentProject.value.devices.find((item) => item.instanceId === selectedDeviceId.value)
    if (!device || device.mount === 'busbar' || (rowDelta === 0 && slotDelta === 0)) return
    moveDeviceById(device.instanceId, device.row + rowDelta, device.slot + slotDelta, { coalesce: `nudge:${device.instanceId}` })
  }

  const deleteSelected = () => {
    if (!selectedDeviceId.value) return
    const removedId = selectedDeviceId.value
    commit((project) => {
      const dependentIds = new Set(project.circuits.filter((circuit) =>
        circuit.protectionDeviceId === removedId || circuitTarget(project, circuit) === removedId).map((circuit) => circuit.id))
      removeCircuits(project, dependentIds)
      project.devices = project.devices.filter((item) => item.instanceId !== removedId)
      project.connections = project.connections.filter((item) => item.toDeviceId !== removedId && item.fromDeviceId !== removedId)
    })
    selectedDeviceId.value = null
    notify('Устройство удалено')
  }

  /**
   * A copy belongs next to its original. When the row has no room beside it, the next row that
   * does is still a copy — refusing outright and leaving the board untouched is the one outcome
   * that serves nobody, and the notice about it arrives after the person has waited.
   */
  const duplicateSelected = () => {
    const selected = selectedDevice.value
    if (!selected) return
    const beside = selected.slot + getFootprintModules(selected, definitions.value)
    const placed = addDevice(selected.productId, selected.row, beside)
    if (placed.ok) return
    const anywhere = addDevice(selected.productId)
    if (anywhere.ok && anywhere.row !== undefined && anywhere.row !== selected.row) {
      notify(`Копия поставлена в ряд ${anywhere.row + 1}: ряд ${selected.row + 1} занят.`)
    }
  }

  const updateSelected = (patch: Partial<PlacedDevice>): boolean => {
    if (!selectedDeviceId.value) return rejectCommand('Сначала выберите устройство.')
    const values = patch as Record<string, unknown>
    const allowed = new Set(['address', 'marking', 'note', 'quantity', 'phase'])
    if (!Object.keys(values).length || Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Для выбранного устройства можно изменить только адрес, маркировку, примечание, количество и фазу.')
    if ('address' in values && !validText(values.address, 64, true)) return rejectCommand('Адрес не может быть пустым и должен быть не длиннее 64 символов.')
    if ('marking' in values && !validText(values.marking, 64)) return rejectCommand('Маркировка должна быть строкой не длиннее 64 символов.')
    if ('note' in values && !validText(values.note, PROJECT_LIMITS.text)) return rejectCommand(`Примечание должно быть строкой не длиннее ${PROJECT_LIMITS.text} символов.`)
    if ('quantity' in values && !finiteInRange(values.quantity, 1, PROJECT_LIMITS.quantity, true)) return rejectCommand('Количество должно быть целым от 1 до 99. Физический размер устройства от него не зависит.')
    if ('phase' in values && ![1, 2, 3].includes(values.phase as number)) return rejectCommand('Фаза устройства должна быть 1, 2 или 3.')
    commit((project) => {
      const device = project.devices.find((item) => item.instanceId === selectedDeviceId.value)
      if (device) {
        const automaticMarking = !device.marking?.trim() || device.marking.trim() === device.address.trim()
        if (patch.address !== undefined && patch.marking === undefined && automaticMarking) device.marking = patch.address
        Object.assign(device, patch)
      }
    })
    return true
  }

  const compactSelectedRow = () => {
    const row = selectedDevice.value?.row
    if (row === undefined) return
    commit((project) => { project.devices = compactRow(project.devices, row, definitions.value) }, 'Ряд уплотнён')
  }

  const compactAllRows = () => {
    const rows = new Set(currentProject.value.devices.map((item) => item.row))
    if (!rows.size) return
    commit((project) => {
      for (const row of rows) project.devices = compactRow(project.devices, row, definitions.value)
    }, 'Ряды уплотнены')
  }

  const autoNumberAll = () => commit((project) => { project.devices = autoNumber(project.devices, definitions.value) }, 'Адреса обновлены')

  const endpointKey = (id: string, bus: BusType, side: 'top' | 'bottom', column?: number) => {
    const device = currentProject.value.devices.find((item) => item.instanceId === id)
    const product = device && definitions.value.get(device.productId)
    if (!product) return undefined
    const terminal = terminalForBus(faceTerminals(product), bus, side, column)
    return terminal ? `${id}:${terminal.side}:${terminal.column}` : undefined
  }

  const endpointError = (id: string, bus: BusType, side: 'top' | 'bottom', column?: number) => {
    const device = currentProject.value.devices.find((item) => item.instanceId === id)
    const product = device && definitions.value.get(device.productId)
    if (!product) return 'Аппарат не найден.'
    if (side !== 'top' && side !== 'bottom') return 'Выберите сторону зажима.'
    const row = faceTerminals(product)[side]
    if (column !== undefined && (!Number.isInteger(column) || !row.some((terminal) => terminal.column === column))) return 'Зажим у аппарата не найден.'
    if (!terminalForBus(faceTerminals(product), bus, side, column)) return `У выбранного зажима нет подключения ${bus}.`
    return ''
  }

  const duplicateConnection = (candidate: Connection) => currentProject.value.connections.some((item) =>
    item.id !== candidate.id && connectionKey(item, currentProject.value.devices, definitions.value)
      === connectionKey(candidate, currentProject.value.devices, definitions.value))

  // Every UI path uses the same endpoint rules before changing the project or its undo history.
  const connectionError = (connection: Connection, checkDuplicate = true) => {
    const invalidRoute = wireRouteError(connection.route)
    if (invalidRoute) return invalidRoute
    if (!['L', 'N', 'PE'].includes(connection.fromBus)) return 'Выберите провод L, N или PE.'
    if (connection.kind === 'busbar' && !connection.fromDeviceId) return 'Укажите аппарат или шину источника.'
    if (connection.kind === 'bus' && connection.fromDeviceId) return 'Питание от общей шины не может иметь аппарат-источник.'
    const targetError = endpointError(connection.toDeviceId, connection.fromBus, connection.toSide ?? 'top', connection.terminal)
    if (targetError) return targetError
    if (connection.fromDeviceId) {
      const sourceError = endpointError(connection.fromDeviceId, connection.fromBus, connection.fromSide ?? 'bottom', connection.fromTerminal)
      if (sourceError) return sourceError
      if (endpointKey(connection.fromDeviceId, connection.fromBus, connection.fromSide ?? 'bottom', connection.fromTerminal)
        === endpointKey(connection.toDeviceId, connection.fromBus, connection.toSide ?? 'top', connection.terminal)) return 'Нельзя соединить зажим с самим собой.'
    }
    return checkDuplicate && duplicateConnection(connection) ? 'Такой провод уже проведён.' : ''
  }

  const addBoardWire = (connection: Connection): boolean => {
    const invalid = connectionError(connection)
    if (invalid) return rejectCommand(invalid)
    commit((project) => project.connections.push(clone(connection)), `Провод ${connection.label} проведён`)
    return true
  }

  const addBusbarConnection = (fromDeviceId: string, toDeviceId: string): boolean => {
    const source = currentProject.value.devices.find((item) => item.instanceId === fromDeviceId)
    if (!source || source.mount !== 'busbar') return rejectCommand('Выберите шину-источник.')
    const product = definitions.value.get(source.productId)
    if (!product) return rejectCommand('Модель шины не найдена.')
    // This is an explicit flexible conductor. Physical comb teeth are not inferred from row membership.
    return addBoardWire({ id: uid(), circuitId: '', fromBus: product.bus, toDeviceId,
      color: wireColor(product.bus), thickness: 2, label: `${source.address || 'Шина'} → аппарат`, kind: 'busbar', fromDeviceId })
  }

  const connectOnBoard = (fromDeviceId: string, fromBus: BusType, toDeviceId: string, terminal?: number,
    endpoints: Pick<Connection, 'fromTerminal' | 'fromSide' | 'toSide' | 'route'> = {}): boolean => {
    const name = (id: string) => currentProject.value.devices.find((item) => item.instanceId === id)?.address || 'аппарат'
    return addBoardWire({ id: uid(), circuitId: '', fromBus, toDeviceId, fromDeviceId,
      color: wireColor(fromBus), thickness: 2, label: `${name(fromDeviceId)} → ${name(toDeviceId)}`,
      kind: 'busbar', terminal, ...endpoints })
  }

  const connectFromBus = (bus: BusType, toDeviceId: string, terminal?: number, toSide: 'top' | 'bottom' = 'top', route?: Connection['route']): boolean => {
    const name = currentProject.value.devices.find((item) => item.instanceId === toDeviceId)?.address || 'аппарат'
    return addBoardWire({ id: uid(), circuitId: '', fromBus: bus, toDeviceId,
      color: wireColor(bus), thickness: 2, label: `${bus} → ${name}`, kind: 'bus', terminal, toSide, route })
  }

  const isProtectionDevice = (device: PlacedDevice | undefined) => {
    if (!device) return false
    const category = definitions.value.get(device.productId)?.category
    return category === 'MCB' || category === 'RCCB' || category === 'RCBO'
  }

  const circuitError = (circuit: Circuit): string | null => {
    if (!validText(circuit.name, PROJECT_LIMITS.text, true)) return 'Название цепи должно быть непустой строкой.'
    if (!validText(circuit.loadName, PROJECT_LIMITS.text, true)) return 'Нагрузка должна быть непустой строкой.'
    if (!validText(circuit.protectionDeviceId, PROJECT_LIMITS.id, true)) return 'Укажите защитное устройство.'
    if (circuit.targetDeviceId !== undefined && (!validText(circuit.targetDeviceId, PROJECT_LIMITS.id, true) || !currentProject.value.devices.some((item) => item.instanceId === circuit.targetDeviceId))) return 'Устройство назначения цепи не найдено.'
    if (!validText(circuit.color, 64, true)) return 'Цвет цепи должен быть непустой строкой.'
    if (!validText(circuit.note, PROJECT_LIMITS.text)) return 'Примечание цепи слишком длинное.'
    if (!finiteInRange(circuit.current, 0, PROJECT_LIMITS.current)) return 'Ток цепи должен быть конечным числом от 0 до 10000 А.'
    if (!finiteInRange(circuit.power, 0, PROJECT_LIMITS.power)) return 'Мощность цепи должна быть конечным числом от 0 до 10000000 Вт.'
    if (!finiteInRange(circuit.wireCrossSection, 0.5, 1000)) return 'Сечение провода должно быть не меньше 0,5 мм².'
    if (![1, 2, 3].includes(circuit.phase)) return 'Фаза цепи должна быть 1, 2 или 3.'
    const protection = currentProject.value.devices.find((item) => item.instanceId === circuit.protectionDeviceId)
    if (!isProtectionDevice(protection)) return 'Для цепи можно выбрать только автомат, УЗО или дифавтомат.'
    return null
  }

  const addCircuit = (targetDeviceId = selectedDeviceId.value ?? currentProject.value.devices[0]?.instanceId) => {
    if (!targetDeviceId) return rejectCommand('Сначала разместите устройство в щите.')
    const target = currentProject.value.devices.find((item) => item.instanceId === targetDeviceId)
    if (!target) return rejectCommand('Устройство назначения не найдено.')
    const selectedProtection = selectedDevice.value
    const protection = isProtectionDevice(target) ? target
      : isProtectionDevice(selectedProtection ?? undefined) ? selectedProtection
      : currentProject.value.devices.find((item) => isProtectionDevice(item))
    if (!protection) return rejectCommand('Для цепи нужен автомат, УЗО или дифавтомат.')
    const circuit: Circuit = {
      id: uid(), name: `Цепь ${currentProject.value.circuits.length + 1}`,
      loadName: target.note || 'Новая нагрузка', current: 0, power: 0, phase: target.phase,
      protectionDeviceId: protection.instanceId, targetDeviceId, color: '#c65c3b', wireCrossSection: 1.5, note: '',
    }
    const invalid = circuitError(circuit)
    if (invalid) return rejectCommand(invalid)
    const connection: Connection = {
      id: uid(), circuitId: circuit.id, fromBus: 'L', toDeviceId: targetDeviceId,
      color: circuit.color, thickness: 2, label: circuit.name, kind: 'circuit',
    }
    const invalidConnection = connectionError(connection, false)
    if (invalidConnection) return rejectCommand(invalidConnection)
    const alreadyFed = currentProject.value.connections.some((item) =>
      connectionTouchesTerminal(item, currentProject.value.devices, definitions.value, targetDeviceId, 'L'))
    commit((project) => {
      project.circuits.push(circuit)
      if (!alreadyFed) project.connections.push(clone(connection))
    }, 'Цепь добавлена')
    // The circuit is returned so the board can offer its load name for editing straight away,
    // instead of sending the person to a panel to find out what they just created.
    return circuit
  }

  const updateCircuit = (id: string, patch: Partial<Circuit>): boolean => {
    const current = currentProject.value.circuits.find((item) => item.id === id)
    if (!current) return rejectCommand('Цепь не найдена.')
    const values = patch as Record<string, unknown>
    const allowed = new Set(['name', 'loadName', 'current', 'power', 'phase', 'protectionDeviceId', 'color', 'wireCrossSection', 'note'])
    if (!Object.keys(values).length || Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Изменение цепи содержит недопустимые поля.')
    const candidate = { ...current, ...patch }
    const invalid = circuitError(candidate)
    if (invalid) return rejectCommand(invalid)
    commit((project) => {
      const circuit = project.circuits.find((item) => item.id === id)
      if (!circuit) return
      Object.assign(circuit, patch)
      for (const connection of project.connections.filter((item) => item.circuitId === id)) {
        if (patch.color) connection.color = patch.color
        if (patch.name) connection.label = patch.name
      }
    })
    return true
  }

  const addConnection = (circuitId: string): boolean => {
    const circuit = currentProject.value.circuits.find((item) => item.id === circuitId)
    if (!circuit) return rejectCommand('Цепь не найдена.')
    const existing = currentProject.value.connections.filter((item) => item.circuitId === circuitId && item.kind !== 'busbar')
    const usedBuses = new Set(existing.filter((item) => !connectionError(item, false)).map((item) => item.fromBus))
    const toDeviceId = selectedDeviceId.value ?? circuit.targetDeviceId ?? existing[0]?.toDeviceId ?? circuit.protectionDeviceId
    if (!toDeviceId) return rejectCommand('Сначала выберите устройство в щите.')
    for (const fromBus of ['L', 'N', 'PE'] as const) {
      if (usedBuses.has(fromBus)) continue
      if (currentProject.value.connections.some((item) =>
        connectionTouchesTerminal(item, currentProject.value.devices, definitions.value, toDeviceId, fromBus))) continue
      const connection: Connection = {
        id: uid(), circuitId, fromBus, toDeviceId,
        color: wireColor(fromBus), thickness: 2, label: `${circuit.name} · ${fromBus}`, kind: 'circuit',
      }
      if (connectionError(connection)) continue
      return addBoardWire(connection)
    }
    return rejectCommand('У выбранного аппарата нет свободного совместимого подключения L, N или PE для этой цепи. Выберите нужную клемму или шину.')
  }

  const updateConnection = (id: string, patch: Partial<Connection>): boolean => {
    const connection = currentProject.value.connections.find((item) => item.id === id)
    if (!connection) return rejectCommand('Подключение не найдено.')
    const values = patch as Record<string, unknown>
    const allowed = new Set(['circuitId', 'fromBus', 'toDeviceId', 'color', 'thickness', 'label', 'terminal', 'fromTerminal', 'fromSide', 'toSide', 'route'])
    if (!Object.keys(values).length || Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Изменение подключения содержит недопустимые поля.')
    if ('fromBus' in values && !['L', 'N', 'PE'].includes(values.fromBus as string)) return rejectCommand('Шина должна быть L, N или PE.')
    if ('toDeviceId' in values && !currentProject.value.devices.some((item) => item.instanceId === values.toDeviceId)) return rejectCommand('Подключаемое устройство не найдено.')
    if ('color' in values && !validText(values.color, 64, true)) return rejectCommand('Цвет подключения должен быть непустой строкой.')
    if ('thickness' in values && !finiteInRange(values.thickness, CONNECTION_THICKNESS_MM.min, CONNECTION_THICKNESS_MM.max)) return rejectCommand(`Толщина подключения должна быть конечным числом от ${CONNECTION_THICKNESS_MM.min} до ${CONNECTION_THICKNESS_MM.max} мм.`)
    if ('label' in values && !validText(values.label, PROJECT_LIMITS.text)) return rejectCommand('Подпись подключения слишком длинная.')
    if ('circuitId' in values && !currentProject.value.circuits.some((item) => item.id === values.circuitId)) return rejectCommand('Цепь подключения не найдена.')
    const candidate = { ...connection, ...patch }
    for (const field of ['fromSide', 'toSide'] as const) {
      if (field in values && !['top', 'bottom'].includes(values[field] as string)) return rejectCommand('Выберите сторону зажима.')
    }
    const invalid = connectionError(candidate)
    if (invalid) return rejectCommand(invalid)
    if (patch.fromBus && !patch.color) patch.color = wireColor(patch.fromBus)
    commit((project) => {
      const item = project.connections.find((entry) => entry.id === id)
      if (item) {
        Object.assign(item, clone(patch))
        if ('route' in patch && patch.route === undefined) delete item.route
      }
    })
    return true
  }


  const deleteConnection = (id: string) => {
    commit((project) => {
      project.connections = project.connections.filter((item) => item.id !== id)
    }, 'Подключение удалено')
    if (selectedConnectionId.value === id) selectedConnectionId.value = null
  }

  const circuitTarget = (project: PanelProject, circuit: Circuit) => circuit.targetDeviceId
    ?? project.connections.find((item) => item.circuitId === circuit.id)?.toDeviceId
    ?? circuit.protectionDeviceId

  const removeCircuits = (project: PanelProject, ids: Set<string>) => {
    const remaining = project.circuits.filter((item) => !ids.has(item.id))
    const targets = remaining.map((item) => circuitTarget(project, item))
    project.connections = project.connections.flatMap((connection) => {
      if (!ids.has(connection.circuitId)) return [connection]
      const shared = targets.some((target) => connectionTouchesTerminal(
        connection, project.devices, definitions.value, target, connection.fromBus))
      // Retain a physical feed when another logical circuit still uses this exact contact.
      return shared ? [{ ...connection, circuitId: '', kind: connection.fromDeviceId ? 'busbar' as const : 'bus' as const }] : []
    })
    project.circuits = remaining
  }

  const deleteCircuit = (id: string) => commit((project) => {
    removeCircuits(project, new Set([id]))
  }, 'Цепь удалена')

  const undo = () => {
    const history = historyFor(currentProjectId.value)
    const previous = history.undo.pop()
    if (!previous) return
    lastCoalesce.delete(currentProjectId.value)
    history.redo.push(clone(currentProject.value))
    const index = projects.value.findIndex((item) => item.id === currentProjectId.value)
    if (index >= 0) projects.value[index] = previous
  }

  const redo = () => {
    const history = historyFor(currentProjectId.value)
    const next = history.redo.pop()
    if (!next) return
    lastCoalesce.delete(currentProjectId.value)
    history.undo.push(clone(currentProject.value))
    const index = projects.value.findIndex((item) => item.id === currentProjectId.value)
    if (index >= 0) projects.value[index] = next
  }

  /**
   * `silent` is for restoring a whole library from an archive: the same notice repeated once per
   * model is noise, and the caller announces the result as a single count.
   */
  const addImportedModel = async (metadata: ModelMetadata, data: ArrayBuffer, options?: { silent?: boolean }) => {
    try {
      await putModelAsset(metadata.id, data)
      importedModels.value.push(metadata)
      if (repository.available) await persistNow()
      if (!options?.silent) notify('Модель добавлена в библиотеку')
    } catch (error) {
      persistenceError = actionableStorageError(error, 'модель в IndexedDB')
      storageError.value = persistenceError
      updateStorageState()
      throw error
    }
  }

  const deleteImportedModel = async (id: string) => {
    const usage = projects.value.reduce((sum, project) => sum + project.devices.filter((item) => item.productId === id).length, 0)
    if (usage) return notify(`Модель используется в ${usage} позициях. Сначала удалите их.`, 'error')
    try {
      await deleteModelAsset(id)
      importedModels.value = importedModels.value.filter((item) => item.id !== id)
      notify('Модель удалена')
    } catch (error) {
      persistenceError = actionableStorageError(error, 'модель в IndexedDB')
      storageError.value = persistenceError
      updateStorageState()
      throw error
    }
  }

  const clearLocalData = async () => {
    let assetError: unknown
    try {
      await clearModelAssets()
    } catch (error) {
      assetError = error
    }
    try {
      repository.clear()
      persistenceError = null
      storageError.value = null
      storageRecovery.value = []
      storageBackup.value = repository.backupData
    } catch (error) {
      persistenceError = actionableStorageError(error, 'локальные данные')
      storageError.value = persistenceError
    }
    const fresh = seedProject()
    projects.value = [fresh]
    currentProjectId.value = fresh.id
    importedModels.value = []
    histories.value = {}
    selectedDeviceId.value = null
    cabinetMigration.value = null
    projectsDirty = false
    currentProjectDirty = false
    lastSavedAt.value = null
    theme.value = 'light'
    updateStorageState()
    if (assetError) notify(actionableStorageError(assetError, 'модели в IndexedDB'), 'error')
    else if (persistenceError) notify(persistenceError, 'error')
    else notify('Локальные данные удалены')
  }

  const importProject = (project: PanelProject) => {
    if (!project || typeof project !== 'object' || !project.name?.trim() || !Array.isArray(project.devices)) throw new Error('Некорректный файл проекта')
    // Both branches have to end in a validated project: an imported record that the next
    // save would reject would make every later autosave fail for the whole workspace.
    const normalized = project.schemaVersion === PROJECT_SCHEMA_VERSION
      ? assertValidProjectSchema(project)
      : assertValidProjectSchema(migrateProject(project))
    normalized.id = uid(); normalized.updatedAt = new Date().toISOString()
    projects.value.unshift(normalized)
    histories.value[normalized.id] = { undo: [], redo: [] }
    currentProjectId.value = normalized.id
    notify('Проект импортирован')
  }

  const restoreWorkspaceBackup = async (backup: RestoredWorkspaceBackup) => {
    projects.value = clone(backup.projects)
    histories.value = {}
    selectedDeviceId.value = null
    cabinetMigration.value = null
    currentProjectId.value = backup.projects.some((project) => project.id === backup.currentProjectId)
      ? backup.currentProjectId!
      : backup.projects[0]!.id
    projectsDirty = true
    currentProjectDirty = true
    const saved = await persistNow()
    if (saved) notify('Резервная копия восстановлена')
  }

  const restoreStorageBackup = async () => {
    const backup = storageBackup.value.projects
    if (!backup?.length) return false
    projects.value = clone(backup)
    histories.value = {}
    selectedDeviceId.value = null
    cabinetMigration.value = null
    const restoredId = storageBackup.value.currentProjectId && backup.some((project) => project.id === storageBackup.value.currentProjectId)
      ? storageBackup.value.currentProjectId
      : backup[0]!.id
    currentProjectId.value = restoredId
    projectsDirty = true
    currentProjectDirty = true
    const saved = await persistNow()
    if (saved) notify(`Восстановлен предыдущий снимок: ${backup.length} проект(ов)`)
    return saved
  }

  return {
    projects, currentProjectId, currentProject, selectedDeviceId, selectedDevice, selectedProduct, cabinetMigration,
    selectedConnectionId, selectedConnection, selectDevice, selectConnection,
    definitions, importedModels, undoStack, redoStack, storageStatus, storageError, storageRecovery, storageBackup,
    storageAlert, storageRecoveryNotice, hasStorageBackup, hasStorageRecovery, downloadStorageSnapshot, restoreStorageBackup, dismissStorageAlert,
    lastSavedAt, theme, toast, switchProject, newProject, duplicateProject, renameProject, deleteProject,
    applyPreset, updateSettings, selectCabinet, selectRail, stageCabinetMigration, stageRailMigration,
    commitCabinetMigration, cancelCabinetMigration, addDevice, moveSelected, nudgeSelectedDevice, deleteSelected, duplicateSelected,
    updateSelected, compactSelectedRow, compactAllRows, autoNumberAll, moveDeviceById, addCircuit, updateCircuit, addConnection,
    addBusbarConnection, connectOnBoard, connectFromBus, updateConnection, deleteConnection, deleteCircuit, undo, redo, persistNow, flushPersistence,
    retryPersistence, addImportedModel, deleteImportedModel, clearLocalData, importProject, restoreWorkspaceBackup, notify,
  }
})
