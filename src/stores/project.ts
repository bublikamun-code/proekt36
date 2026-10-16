import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { workspaceCatalog, enmasSeriesCatalog } from '../data/catalog'
import { embeddedModelById } from '../data/models'
import {
  compactRow,
  evaluateCabinetMigration,
  getFootprintModules,
  getRowCapacity,
  placeProduct,
  resolveDeviceMove,
  type LayoutMigrationPlan,
} from '../domain/layout'
import { autoConnectionLabel, autoNumber, autoNumberConnections, createProject, migrateProject, presetProducts, uid } from '../domain/project'
import type { RestoredWorkspaceBackup } from '../domain/projectBackup'
import { downloadJsonFile } from '../domain/projectBackup'
import { assertValidProjectSchema, PROJECT_LIMITS, PROJECT_SCHEMA_VERSION } from '../domain/projectSchema'
import type { Circuit, Connection, DeviceDefinition, ModelAsset, PanelProject, PlacedDevice, ProjectSettings, Room, RowComb, StoredModelAsset, StoredModelLibrary } from '../domain/types'
import { CIRCUIT_KINDS } from '../domain/types'
import { terminalOccupied } from '../domain/wireRouting'
import { deviceTerminals, sameTerminal, terminalColumnForPole, terminalColumns, terminalType } from '../domain/terminals'
import type { TerminalInfo, TerminalRef, TerminalType } from '../domain/terminals'
import { clearModelAssets, deleteModelAsset, listModelAssetIds, putModelAsset } from '../storage/modelDb'
import { actionableStorageError, isImportedProduct, WorkspaceRepository, type StorageBackupData, type StorageRecovery } from '../storage/projectRepository'
import { invalidateModelCaches } from '../services/modelRender'
import { usePreferencesStore } from './preferences'

const HISTORY_LIMIT = 50
const COALESCE_WINDOW_MS = 800
const PERSIST_DELAY_MS = 450
type ProjectHistory = { undo: PanelProject[]; redo: PanelProject[] }
type StorageStatus = 'saving' | 'saved' | 'save-failed' | 'storage-unavailable'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** What the planner needs to know to add a line; everything else gets a sensible default. */
export interface NewLineInput {
  name: string
  roomId?: string
  kind?: Circuit['kind']
  phase?: 1 | 2 | 3
  protectionProductId: string
  current?: number
  power?: number
  wireCrossSection?: number
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
  // Only the demo's electrical inputs are overridden; the cabinet geometry that
  // createProject derived from the apartment preset (NX8-24, rail-12) has to survive.
  // The old literal replacement silently degraded the seed to the 17.5 mm legacy layout.
  project.settings = { ...project.settings, inputCurrent: 40, phase: 1, reserveModules: 8 }
  const definitions = new Map(workspaceCatalog.map((item) => [item.id, item]))
  const products = [
    definitions.get('ekf-spd-t1-3p-n-pe')!, definitions.get('ekf-mcb-4p-b32')!,
    definitions.get('ekf-rccb-4p-40')!, definitions.get('ekf-mcb-1p-c6')!,
    definitions.get('ekf-mcb-1p-c6')!, definitions.get('ekf-mcb-1p-b16')!,
    definitions.get('ekf-mcb-1p-c6')!, definitions.get('ekf-terminal-1p-gray')!,
    definitions.get('iek-terminal-1p-blue')!,
  ]
  // Three 4-module apparatus fill a 12-slot rail exactly (slots 0/4/8); everything else
  // starts row two. Preferred slots are the final ones — an insert into a packed middle
  // would demand a row shift the full rail cannot grant.
  let devices: PlacedDevice[] = []
  for (const [index, product] of products.entries()) {
    const row = index < 3 ? 0 : 1
    const slot = index < 3 ? index * 4 : index - 3
    const result = placeProduct(devices, product, row, slot, getRowCapacity(project), uid, definitions)
    devices = result.devices
  }
  project.devices = autoNumber(devices, definitions)
  wireDemo(project, definitions)
  return project
}

/**
 * A distribution board is not a row of devices. The phase reaches the breakers through a comb, the
 * earth through its own bar, and the main runs on to the RCCB as a drawn conductor. The demo is
 * therefore shipped wired: an empty rail teaches nothing about what the board is for, and every
 * screenshot of the editor would show an unfinished panel.
 */
const wireDemo = (project: PanelProject, definitions: Map<string, DeviceDefinition>) => {
  const nth = (productId: string, index = 0) => project.devices.filter((item) => item.productId === productId)[index]
  const main = nth('ekf-mcb-4p-b32')
  const rccb = nth('ekf-rccb-4p-40')
  const earth = nth('ekf-terminal-1p-gray')
  project.combs = [{ id: 'demo-comb-3p', row: 1, poles: 3, fromSlot: 0, toSlot: 2, label: 'Гребёнка 3P' }]
  const wires: Connection[] = []
  // A 4P device numbers its poles in staggered rows, so the first clamp underneath is pole 2.
  if (main && rccb) wires.push({
    id: 'demo-main-rccb', circuitId: '', fromBus: 'L', toDeviceId: rccb.instanceId, color: '', thickness: 2,
    kind: 'jumper', phase: 1,
    fromTerminal: { deviceId: main.instanceId, pole: 2, side: 'bottom' },
    toTerminal: { deviceId: rccb.instanceId, pole: 1, side: 'top' },
    label: '',
  })
  if (earth) wires.push({
    id: 'demo-earth', circuitId: '', fromBus: 'PE', toDeviceId: earth.instanceId, color: '', thickness: 2,
    kind: 'circuit', busId: 'bus-pe-bottom',
    toTerminal: { deviceId: earth.instanceId, pole: 1, side: 'top' },
    label: '',
  })
  project.connections = autoNumberConnections(wires, project.devices, definitions)
}

export const useProjectStore = defineStore('project', () => {
  const preferences = usePreferencesStore()
  const repository = new WorkspaceRepository()
  const fallbackProject = seedProject()
  const loaded = repository.load([fallbackProject])
  const projects = ref<PanelProject[]>(loaded.projects.length ? loaded.projects : [fallbackProject])
  const currentProjectId = ref(loaded.currentProjectId && projects.value.some((project) => project.id === loaded.currentProjectId) ? loaded.currentProjectId : projects.value[0]!.id)
  const selectedDeviceId = ref<string | null>(null)
  const selectedConnectionId = ref<string | null>(null)
  // The line the planner tab is looking at, so the board can highlight its conductors; null when
  // no row is selected. Kept here for the same reason as selectedConnectionId: two views, one state.
  const selectedLineId = ref<string | null>(null)
  const selectLine = (id: string | null) => {
    selectedLineId.value = selectedLineId.value === id ? null : id
  }
  const cabinetMigration = ref<LayoutMigrationPlan | null>(null)
  const modelLibrary = ref<StoredModelLibrary>(loaded.models)
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
  let modelsDirty = false
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
  /** Embedded assets ship with the app; local ones come from imports and live in IndexedDB. */
  const modelAssetsById = computed<Map<string, ModelAsset>>(() => {
    const map = new Map<string, ModelAsset>(embeddedModelById)
    for (const asset of modelLibrary.value.assets) map.set(asset.id, asset)
    return map
  })
  const resolveProductModel = (product: DeviceDefinition): ModelAsset | undefined =>
    product.modelId ? modelAssetsById.value.get(product.modelId) : undefined
  const definitions = computed(() => {
    const map = new Map<string, DeviceDefinition>([
      ...workspaceCatalog.map((item) => [item.id, item] as const),
      ...enmasSeriesCatalog.map((item) => [item.id, item] as const),
      ...modelLibrary.value.products.map((item) => [item.id, item] as const),
    ])
    // Bindings attach a model to a built-in product without cloning it into the library.
    for (const [productId, modelId] of Object.entries(modelLibrary.value.bindings)) {
      const product = map.get(productId)
      if (product && modelAssetsById.value.has(modelId)) map.set(productId, { ...product, modelId })
    }
    return map
  })
  /**
   * Addresses and the wire labels that quote them are one thing. Renumbering the devices and
   * leaving the wiring alone would leave every conductor pointing at an address that moved.
   */
  const renumber = (project: PanelProject, devices: PlacedDevice[] = project.devices) => {
    project.devices = autoNumber(devices, definitions.value)
    project.connections = autoNumberConnections(project.connections ?? [], project.devices, definitions.value)
  }
  const selectedDevice = computed(() => currentProject.value.devices.find((item) => item.instanceId === selectedDeviceId.value) ?? null)
  const selectedProduct = computed(() => selectedDevice.value ? definitions.value.get(selectedDevice.value.productId) ?? null : null)

  const persistNow = async () => {
    if (!repository.available) {
      updateStorageState()
      return false
    }
    try {
      repository.save({ projects: projects.value, models: modelLibrary.value, currentProjectId: currentProjectId.value }, { modelsDirty })
      projectsDirty = false
      currentProjectDirty = false
      modelsDirty = false
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
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { void flushPersistence() })

  // Registered before the persistence watcher so a library change is flagged before the
  // debounced save decides whether the models key needs to be written at all.
  watch(modelLibrary, () => { modelsDirty = true }, { deep: true })
  watch([projects, modelLibrary], schedulePersistence, { deep: true })

  watch(currentProjectId, (id) => {
    selectedDeviceId.value = null
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
    // First product of the category wins, and template entries never seed a board.
    // Last-wins used to hand every preset the same late-catalogue breaker regardless of brand.
    const picked = new Map<string, DeviceDefinition>()
    for (const item of definitions.value.values()) {
      if (!allowed.has(item.category) || item.imported || item.verificationStatus === 'template') continue
      if (!picked.has(item.category)) picked.set(item.category, item)
    }
    const unique = [...picked.values()].slice(0, Math.min(7, project.settings.rows))
    const productsMap = new Map(definitions.value)
    let devices: PlacedDevice[] = []
    unique.forEach((product, index) => {
      const row = Math.floor(index / 4) % Math.max(1, project.settings.rows)
      const result = placeProduct(devices, product, row, 0, getRowCapacity(project), uid, productsMap)
      devices = result.devices
    })
    renumber(project, devices)
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
  const syncBusbarConnections = (project: PanelProject, addedIds: ReadonlySet<string>) => {
    const busbars = project.devices.filter((item) => item.mount === 'busbar')
    if (!busbars.length || !addedIds.size) return 0
    let created = 0
    for (const target of project.devices) {
      if (!addedIds.has(target.instanceId)) continue
      const category = definitions.value.get(target.productId)?.category
      if (category !== 'MCB' && category !== 'RCCB' && category !== 'RCBO') continue
      const source = busbars.find((busbar) => busbar.row === target.row) ?? busbars[0]
      if (!source) continue
      const exists = project.connections.some((connection) => connection.kind === 'busbar' && connection.fromDeviceId === source.instanceId && connection.toDeviceId === target.instanceId)
      if (!exists) {
        project.connections.push({
          id: uid(), circuitId: '', fromBus: 'L', toDeviceId: target.instanceId,
          color: '#aeb8b4', thickness: 2, label: `FORK → ${target.address || 'аппарат'}`,
          kind: 'busbar', fromDeviceId: source.instanceId,
        })
        created += 1
      }
    }
    return created
  }

  const addDevice = (productId: string, row = 0, slot = 0) => {
    const product = definitions.value.get(productId)
    if (!product) return notify('Товар не найден', 'error')
    const capacity = getRowCapacity(currentProject.value)
    let result = placeProduct(currentProject.value.devices, product, row, slot, capacity, uid, definitions.value)
    // A catalogue click means "put it anywhere sensible". With the requested rail packed,
    // the device used to be refused even when the next row was completely empty.
    if (result.error && row === 0 && slot === 0) {
      for (let candidateRow = 1; candidateRow < currentProject.value.settings.rows && result.error; candidateRow += 1) {
        result = placeProduct(currentProject.value.devices, product, candidateRow, 0, capacity, uid, definitions.value)
      }
    }
    if (result.error) return notify(result.error, 'error')
    const previousIds = new Set(currentProject.value.devices.map((item) => item.instanceId))
    let linked = 0
    commit((project) => {
      renumber(project, result.devices)
      linked = syncBusbarConnections(project, new Set(project.devices.filter((item) => !previousIds.has(item.instanceId)).map((item) => item.instanceId)))
    })
    selectedDeviceId.value = result.devices.find((item) => !previousIds.has(item.instanceId))?.instanceId ?? null
    if (linked) notify(`Аппарат добавлен и подключён к шине`)
  }

  const moveDeviceById = (instanceId: string, row: number, slot: number, options?: { coalesce?: string }) => {
    const device = currentProject.value.devices.find((item) => item.instanceId === instanceId)
    if (!device) return notify('Устройство не найдено', 'error')
    if (device.mount === 'busbar' && (!Number.isInteger(row) || row < 0 || row >= currentProject.value.settings.rows)) {
      return rejectCommand('Позиция за пределами ряда')
    }
    // A device whose product left the catalogue still moves on a one-module footprint from
    // getFootprintModules; freezing it in place only made the placeholder impossible to tidy up.
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
    commit((project) => { renumber(project, result.devices) }, undefined, { coalesce: options?.coalesce })
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
      project.devices = project.devices.filter((item) => item.instanceId !== removedId)
      project.connections = project.connections.filter((item) => item.toDeviceId !== removedId && item.fromDeviceId !== removedId)
    })
    selectedDeviceId.value = null
    notify('Устройство удалено')
  }

  const duplicateSelected = () => {
    const selected = selectedDevice.value
    if (!selected) return
    addDevice(selected.productId, selected.row, selected.slot + getFootprintModules(selected, definitions.value))
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
      if (device) Object.assign(device, patch)
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

  const autoNumberAll = () => commit((project) => renumber(project), 'Адреса и подписи проводов обновлены')

  /** The slot span a new comb on this row should cover: every device already in the row. */
  const addComb = (row: number, poles: 1 | 2 | 3 | 4 = 1) => {
    const inRow = currentProject.value.devices.filter((item) => item.row === row).sort((a, b) => a.slot - b.slot)
    if (!inRow.length) return notify('В ряду нет аппаратов — гребёнке нечего соединять', 'error')
    // A comb is a physical part of a fixed length: its teeth span as many devices as it has
    // poles, starting at the leftmost one. Covering the whole row would draw a one-tooth comb
    // across nine devices, which no installer would recognise.
    const fed = inRow.slice(0, poles)
    const fromSlot = Math.min(...fed.map((item) => item.slot))
    const toSlot = Math.max(...fed.map((item) => item.slot + getFootprintModules(item, definitions.value) - 1))
    commit((project) => {
      project.combs = [...(project.combs ?? []), { id: uid(), row, poles, fromSlot, toSlot, label: `Гребёнка ${poles}P` }]
    }, `Гребёнка ${poles}P добавлена`)
  }

  const updateComb = (id: string, patch: Partial<RowComb>) => {
    if (!currentProject.value.combs?.some((comb) => comb.id === id)) return
    commit((project) => {
      project.combs = (project.combs ?? []).map((comb) => {
        if (comb.id !== id) return comb
        const next = { ...comb, ...patch }
        return { ...next, fromSlot: Math.min(next.fromSlot, next.toSlot), toSlot: Math.max(next.fromSlot, next.toSlot) }
      })
    }, 'Гребёнка обновлена', { coalesce: `comb:${id}` })
  }

  const removeComb = (id: string) => {
    if (!currentProject.value.combs?.some((comb) => comb.id === id)) return
    commit((project) => { project.combs = (project.combs ?? []).filter((comb) => comb.id !== id) }, 'Гребёнка удалена')
  }

  const addBusbarConnection = (fromDeviceId: string, toDeviceId: string) => {
    const source = currentProject.value.devices.find((item) => item.instanceId === fromDeviceId)
    const target = currentProject.value.devices.find((item) => item.instanceId === toDeviceId)
    if (!source || source.mount !== 'busbar' || !target) return notify('Выберите шину Fork и аппарат назначения', 'error')
    if (currentProject.value.connections.some((item) => item.kind === 'busbar' && item.fromDeviceId === fromDeviceId && item.toDeviceId === toDeviceId)) return notify('Такое подключение уже есть', 'error')
    commit((project) => project.connections.push({ id: uid(), circuitId: '', fromBus: 'L', toDeviceId, color: '#aeb8b4', thickness: 2, label: `FORK → ${target.address || 'аппарат'}`, kind: 'busbar', fromDeviceId }), 'Шина подключена')
  }

  const terminalDevice = (ref: TerminalRef) => currentProject.value.devices.find((item) => item.instanceId === ref.deviceId)

  const deviceMap = (project: PanelProject) => new Map(project.devices.map((item) => [item.instanceId, item]))

  /** What a clamp is: the marking on the device, not the pole number, decides it. */
  const terminalMarking = (ref: TerminalRef): TerminalType | null => {
    const product = terminalProduct(ref)
    if (!product) return null
    const columns = terminalColumns(product)
    return terminalType(product, terminalColumnForPole(product, ref.pole), columns, ref.side === 'bottom')
  }

  const terminalProduct = (ref: TerminalRef) => {
    const device = terminalDevice(ref)
    return device ? definitions.value.get(device.productId) : undefined
  }

  /**
   * A wire drawn by hand between two clamps. The pair decides the rest of the record: a terminal
   * marked N makes the conductor a neutral, one marked PE an earth, and anything else takes the
   * phase colour of the pole it leaves from — which is what an installer reads off the board.
   */
  const addWire = (from: TerminalRef, to: TerminalRef): boolean => {
    const source = terminalDevice(from)
    const target = terminalDevice(to)
    if (!source || !target) return rejectCommand('Клемма не найдена: устройство удалено или не то, что нарисовано.')
    if (sameTerminal(from, to)) return rejectCommand('Провод не может начинаться и заканчиваться на одной клемме.')
    if (terminalOccupied(currentProject.value, from) || terminalOccupied(currentProject.value, to))
      return rejectCommand('Клемма уже занята другим проводом.')
    const marking = terminalMarking(from)
    const connection: Connection = {
      id: uid(), circuitId: '', fromBus: marking === 'neutral' ? 'N' : marking === 'pe' ? 'PE' : 'L',
      toDeviceId: to.deviceId, color: '', thickness: 2, kind: 'jumper',
      fromTerminal: from, toTerminal: to, label: '',
    }
    if (marking === 'phase') connection.phase = (((from.pole - 1) % 3) + 1) as 1 | 2 | 3
    // The label quotes addresses, so it comes from the same rule the renumbering pass uses rather
    // than from a second spelling of it that could drift.
    connection.label = autoConnectionLabel(connection, deviceMap(currentProject.value), definitions.value)
    commit((project) => { project.connections.push(connection) }, 'Провод добавлен')
    return true
  }

  /** Feeds a clamp from one of the visible board bars rather than from another device. */
  const addBusWire = (busId: string, to: TerminalRef): boolean => {
    const bus = currentProject.value.busAssemblies?.find((item) => item.id === busId)
    const target = terminalDevice(to)
    if (!bus || !target) return rejectCommand('Шина или клемма не найдена.')
    if (terminalOccupied(currentProject.value, to)) return rejectCommand('Клемма уже занята другим проводом.')
    const connection: Connection = {
      id: uid(), circuitId: '', fromBus: bus.kind, toDeviceId: to.deviceId,
      color: '', thickness: 2, kind: 'circuit', busId, toTerminal: to, label: '',
    }
    connection.label = autoConnectionLabel(connection, deviceMap(currentProject.value), definitions.value)
    if (bus.kind === 'L') connection.phase = 1
    commit((project) => { project.connections.push(connection) }, 'Провод от шины добавлен')
    return true
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
    const protection = isProtectionDevice(selectedProtection ?? undefined)
      ? selectedProtection
      : currentProject.value.devices.find((item) => isProtectionDevice(item))
    if (!protection) return rejectCommand('Для цепи нужен автомат, УЗО или дифавтомат.')
    const circuit: Circuit = {
      id: uid(), name: `Цепь ${currentProject.value.circuits.length + 1}`,
      loadName: target.note || 'Новая нагрузка', current: 0, power: 0, phase: target.phase,
      protectionDeviceId: protection.instanceId, color: '#c65c3b', wireCrossSection: 1.5, note: '',
    }
    const invalid = circuitError(circuit)
    if (invalid) return rejectCommand(invalid)
    const connection: Connection = {
      id: uid(), circuitId: circuit.id, fromBus: 'L', toDeviceId: targetDeviceId,
      color: circuit.color, thickness: 2, label: circuit.name, kind: 'circuit',
    }
    commit((project) => {
      project.circuits.push(circuit)
      project.connections.push(connection)
    }, 'Цепь добавлена')
  }

  const updateCircuit = (id: string, patch: Partial<Circuit>): boolean => {
    const current = currentProject.value.circuits.find((item) => item.id === id)
    if (!current) return rejectCommand('Цепь не найдена.')
    const values = patch as Record<string, unknown>
    // Planner fields ride the same command: a row edit in the lines tab is a circuit edit, and
    // letting them through one door keeps the inspector and the worksheet from drifting apart.
    const allowed = new Set(['name', 'loadName', 'current', 'power', 'phase', 'protectionDeviceId', 'color', 'wireCrossSection', 'note', 'roomId', 'kind', 'cableLength'])
    if (!Object.keys(values).length || Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Изменение цепи содержит недопустимые поля.')
    if ('roomId' in values && values.roomId && !currentProject.value.rooms?.some((item) => item.id === values.roomId)) return rejectCommand('Помещение цепи не найдено.')
    if ('kind' in values && !CIRCUIT_KINDS.includes(String(values.kind) as typeof CIRCUIT_KINDS[number])) return rejectCommand('Вид линии должен быть силовым, освещением, DC или управлением.')
    if ('cableLength' in values && !finiteInRange(values.cableLength, 0, PROJECT_LIMITS.cableLength)) return rejectCommand('Длина кабеля должна быть числом от 0 до 1000 м.')
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
    const usedBuses = new Set(existing.map((item) => item.fromBus))
    const fromBus = (['L', 'N', 'PE'] as const).find((bus) => !usedBuses.has(bus))
    if (!fromBus) return rejectCommand('Для этой цепи уже используются все шины L, N и PE.')
    const toDeviceId = existing[0]?.toDeviceId ?? currentProject.value.devices[0]?.instanceId
    if (!toDeviceId) return rejectCommand('Сначала разместите устройство в щите.')
    if (existing.some((item) => item.fromBus === fromBus && item.toDeviceId === toDeviceId)) return rejectCommand('Такое подключение устройства и шины уже есть.')
    const connection: Connection = {
      id: uid(), circuitId, fromBus, toDeviceId,
      color: circuit.color, thickness: 2, label: `${circuit.name} · ${fromBus}`, kind: 'circuit',
    }
    commit((project) => { project.connections.push(connection) }, 'Подключение добавлено')
    return true
  }

  const updateConnection = (id: string, patch: Partial<Connection>): boolean => {
    const connection = currentProject.value.connections.find((item) => item.id === id)
    if (!connection) return rejectCommand('Подключение не найдено.')
    const values = patch as Record<string, unknown>
    const allowed = new Set(['circuitId', 'fromBus', 'toDeviceId', 'color', 'thickness', 'label'])
    if (!Object.keys(values).length || Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Изменение подключения содержит недопустимые поля.')
    if ('fromBus' in values && !['L', 'N', 'PE'].includes(values.fromBus as string)) return rejectCommand('Шина должна быть L, N или PE.')
    if ('toDeviceId' in values && !currentProject.value.devices.some((item) => item.instanceId === values.toDeviceId)) return rejectCommand('Подключаемое устройство не найдено.')
    if ('color' in values && !validText(values.color, 64, true)) return rejectCommand('Цвет подключения должен быть непустой строкой.')
    if ('thickness' in values && !finiteInRange(values.thickness, 0.5, 8)) return rejectCommand('Толщина подключения должна быть конечным числом от 0,5 до 8 мм.')
    if ('label' in values && !validText(values.label, PROJECT_LIMITS.text)) return rejectCommand('Подпись подключения слишком длинная.')
    if ('circuitId' in values && !currentProject.value.circuits.some((item) => item.id === values.circuitId)) return rejectCommand('Цепь подключения не найдена.')
    const candidate = { ...connection, ...patch }
    if (currentProject.value.connections.some((item) => item.id !== id && item.circuitId === candidate.circuitId && item.fromBus === candidate.fromBus && item.toDeviceId === candidate.toDeviceId && item.kind === candidate.kind)) return rejectCommand('Такое подключение устройства и шины уже есть.')
    commit((project) => {
      const item = project.connections.find((entry) => entry.id === id)
      if (item) Object.assign(item, patch)
    })
    return true
  }


  const deleteConnection = (id: string) => {
    if (selectedConnectionId.value === id) selectedConnectionId.value = null
    commit((project) => {
      project.connections = project.connections.filter((item) => item.id !== id)
    }, 'Подключение удалено')
  }

  /**
   * Which conductor the user is looking at. It lives in the store, not in the board, because the
   * inspector lists the same wires and has to be able to point at one: a selection the board owns
   * would leave the list blind to the click, and Delete would remove nothing the panel shows.
   */
  const selectConnection = (id: string | null) => {
    selectedConnectionId.value = selectedConnectionId.value === id ? null : id
  }

  const deleteCircuit = (id: string) => commit((project) => {
    project.circuits = project.circuits.filter((item) => item.id !== id)
    project.connections = project.connections.filter((item) => item.circuitId !== id)
  }, 'Цепь удалена')

  // ── Планировщик линий ──────────────────────────────────────────────────────────────────────
  // A line is planned as a row in a worksheet and lands on the board the same moment: the
  // protection device is placed, the circuit is created and a conductor from the phase bus is
  // already drawn. The board stays the place to fine-tune what the planner produced.

  const addRoom = (name: string, floor = 1): Room | null => {
    const refuse = (message: string): null => { rejectCommand(message); return null }
    if (!validText(name, PROJECT_LIMITS.text, true)) return refuse('Название помещения должно быть непустой строкой.')
    if (!finiteInRange(floor, 0, PROJECT_LIMITS.floor, true)) return refuse('Этаж должен быть целым числом от 0 до 100.')
    const room: Room = { id: uid(), name: name.trim(), floor }
    commit((project) => { project.rooms = [...(project.rooms ?? []), room] }, 'Помещение добавлено')
    return room
  }

  const updateRoom = (id: string, patch: Partial<Room>): boolean => {
    const current = currentProject.value.rooms?.find((item) => item.id === id)
    if (!current) return rejectCommand('Помещение не найдено.')
    const values = patch as Record<string, unknown>
    const allowed = new Set(['name', 'floor'])
    if (!Object.keys(values).length || Object.keys(values).some((key) => !allowed.has(key))) return rejectCommand('Изменение помещения содержит недопустимые поля.')
    if ('name' in values && !validText(values.name, PROJECT_LIMITS.text, true)) return rejectCommand('Название помещения должно быть непустой строкой.')
    if ('floor' in values && !finiteInRange(values.floor, 0, PROJECT_LIMITS.floor, true)) return rejectCommand('Этаж должен быть целым числом от 0 до 100.')
    commit((project) => {
      const room = project.rooms?.find((item) => item.id === id)
      if (room) Object.assign(room, patch)
    })
    return true
  }

  /** Deleting a room keeps its lines — they simply sit outside any room until regrouped. */
  const deleteRoom = (id: string) => commit((project) => {
    project.rooms = (project.rooms ?? []).filter((item) => item.id !== id)
    for (const circuit of project.circuits) if (circuit.roomId === id) circuit.roomId = undefined
  }, 'Помещение удалено')

  /**
   * Plans a line: places its protection device on the first row with room (top row first, the
   * way a board fills left to right), creates the circuit and feeds it a conductor from the
   * phase bus, so the plan and the board never tell two different stories.
   */
  const addLine = (input: NewLineInput): string | null => {
    // rejectCommand has already shown its toast by the time it returns; collapsing its false to
    // null keeps the signature honest — the caller only wants the new id or its absence.
    const refuse = (message: string): null => { rejectCommand(message); return null }
    if (input.roomId && !currentProject.value.rooms?.some((item) => item.id === input.roomId)) return refuse('Помещение не найдено.')
    const product = definitions.value.get(input.protectionProductId)
    if (!product) return refuse('Аппарат защиты не найден в каталоге.')
    if (product.category !== 'MCB' && product.category !== 'RCCB' && product.category !== 'RCBO') {
      return refuse('Линию защищает автомат, УЗО или дифавтомат.')
    }
    const capacity = getRowCapacity(currentProject.value)
    let result = placeProduct(currentProject.value.devices, product, 0, 0, capacity, uid, definitions.value)
    for (let row = 1; row < currentProject.value.settings.rows && result.error; row += 1) {
      result = placeProduct(currentProject.value.devices, product, row, 0, capacity, uid, definitions.value)
    }
    if (result.error) return refuse(result.error)
    const placed = result.devices.find((item) => !currentProject.value.devices.some((before) => before.instanceId === item.instanceId))
    if (!placed) return refuse('Не удалось разместить аппарат линии.')
    const circuit: Circuit = {
      id: uid(), name: input.name.trim(), loadName: input.name.trim(),
      current: input.current ?? 0, power: input.power ?? 0,
      phase: input.phase ?? 1, protectionDeviceId: placed.instanceId,
      color: '#c65c3b', wireCrossSection: input.wireCrossSection ?? 1.5, note: '',
      roomId: input.roomId || undefined, kind: input.kind ?? 'power', cableLength: 0,
    }
    // circuitError reads the protection out of the stored project, where the just-placed device
    // only lands inside the commit below — running it here would refuse every line. The checks
    // that matter are the ones about the input itself; the protection category was vetted above.
    if (!validText(circuit.name, PROJECT_LIMITS.text, true)) return refuse('Название линии должно быть непустой строкой.')
    if (!finiteInRange(circuit.current, 0, PROJECT_LIMITS.current)) return refuse('Ток линии должен быть числом от 0 до 10000 А.')
    if (!finiteInRange(circuit.power, 0, PROJECT_LIMITS.power)) return refuse('Мощность линии должна быть числом от 0 до 10000000 Вт.')
    if (!finiteInRange(circuit.wireCrossSection, 0.5, 1000)) return refuse('Сечение провода должно быть не меньше 0,5 мм².')
    const phaseBus = currentProject.value.busAssemblies?.find((item) => item.kind === 'L')
    const connection: Connection = {
      id: uid(), circuitId: circuit.id, fromBus: 'L', toDeviceId: placed.instanceId,
      color: circuit.color, thickness: 2, label: circuit.name, kind: 'circuit',
      busId: phaseBus?.id,
    }
    commit((project) => {
      renumber(project, result.devices)
      project.circuits.push(circuit)
      project.connections.push(connection)
    }, 'Линия добавлена')
    selectedDeviceId.value = placed.instanceId
    notify(`Линия «${circuit.name}» добавлена: ${placed.address || 'аппарат'} на доске`)
    return circuit.id
  }

  /**
   * A line owns the apparatus the planner placed for it, so taking the line off removes the
   * apparatus too — a breaker with no circuit to protect is board clutter, and the undo stack
   * is the safety net the confirmation dialog names.
   */
  const deleteLine = (id: string) => {
    const circuit = currentProject.value.circuits.find((item) => item.id === id)
    if (!circuit) return rejectCommand('Линия не найдена.')
    const protectionId = circuit.protectionDeviceId
    commit((project) => {
      project.circuits = project.circuits.filter((item) => item.id !== id)
      project.connections = project.connections.filter((item) => item.circuitId !== id)
      const kept = project.devices.filter((item) => item.instanceId !== protectionId)
      if (kept.length !== project.devices.length) renumber(project, kept)
    }, 'Линия удалена')
    if (selectedDeviceId.value === protectionId) selectedDeviceId.value = null
  }

  /** Points a line at an apparatus the user placed by hand, when the planner's own is not wanted. */
  const bindProtection = (circuitId: string, deviceId: string): boolean => {
    const device = currentProject.value.devices.find((item) => item.instanceId === deviceId)
    if (!isProtectionDevice(device)) return rejectCommand('Линию защищает автомат, УЗО или дифавтомат.')
    return updateCircuit(circuitId, { protectionDeviceId: deviceId })
  }

  /**
   * Draws the conductors a worksheet expects for a line: the neutral from the N bar into the
   * apparatus' neutral clamp, the earth into its PE clamp when it has one. The phase is
   * deliberately left alone — it arrives through the comb, which the board already draws.
   */
  const wireLine = (circuitId: string): boolean => {
    const circuit = currentProject.value.circuits.find((item) => item.id === circuitId)
    if (!circuit) return rejectCommand('Линия не найдена.')
    const device = currentProject.value.devices.find((item) => item.instanceId === circuit.protectionDeviceId)
    const product = device ? definitions.value.get(device.productId) : undefined
    if (!device || !product) return rejectCommand('Аппарат защиты линии не найден.')
    const bars = new Map((currentProject.value.busAssemblies ?? []).map((item) => [item.kind, item]))
    let drawn = 0
    const wanted: Array<{ bus: 'N' | 'PE'; terminal: TerminalInfo }> = []
    for (const terminal of deviceTerminals(product)) {
      if (terminal.type === 'neutral' || terminal.type === 'pe') wanted.push({ bus: terminal.type === 'neutral' ? 'N' : 'PE', terminal })
    }
    for (const { bus, terminal } of wanted) {
      const bar = bars.get(bus)
      if (!bar) continue
      const ref: TerminalRef = { deviceId: device.instanceId, pole: terminal.pole, side: terminal.side }
      if (terminalOccupied(currentProject.value, ref)) continue
      if (currentProject.value.connections.some((item) => item.circuitId === circuitId && item.busId === bar.id)) continue
      const connection: Connection = {
        id: uid(), circuitId, fromBus: bus, toDeviceId: device.instanceId,
        color: '', thickness: 2, kind: 'circuit', busId: bar.id, toTerminal: ref,
        label: `${circuit.name} / ${device.address || 'аппарат'}`,
      }
      commit((project) => { project.connections.push(connection) })
      drawn += 1
    }
    notify(drawn ? `Линия «${circuit.name}» соединена (${drawn})` : `Линии «${circuit.name}» нечего дорисовывать`)
    return true
  }

  /**
   * «Запитано от QF02»: the address of the apparatus feeding this one, read off the jumper that
   * enters its top clamp. Empty when the apparatus is fed from the comb or the bus instead.
   */
  const cascadeLabel = (deviceId: string): string => {
    for (const connection of currentProject.value.connections) {
      if (connection.kind !== 'jumper') continue
      const enters = connection.toTerminal?.deviceId === deviceId || (!connection.toTerminal && connection.toDeviceId === deviceId)
      if (!enters) continue
      const sourceId = connection.fromTerminal?.deviceId ?? connection.fromDeviceId
      if (!sourceId || sourceId === deviceId) continue
      const source = currentProject.value.devices.find((item) => item.instanceId === sourceId)
      if (source?.address) return `запитано от ${source.address}`
    }
    return ''
  }

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
   * Adds a CAD asset plus its product stub to the library. The stub keeps the asset id, so
   * re-importing the same file in another browser revives placed devices instead of leaving
   * them pointing at a product that no longer exists. A null product stores the asset alone,
   * ready to be bound to an existing catalogue entry.
   */
  const addImportedModel = async (product: DeviceDefinition | null, asset: StoredModelAsset, data: ArrayBuffer) => {
    if (product && product.id !== asset.id) return notify('Товар импорта должен наследовать id модели', 'error')
    if (product && !isImportedProduct(product)) return notify('Некорректные параметры товара импорта', 'error')
    try {
      await putModelAsset(asset.id, { data })
      invalidateModelCaches(asset.id)
      modelLibrary.value = {
        assets: [...modelLibrary.value.assets.filter((item) => item.id !== asset.id), asset],
        products: product
          ? [...modelLibrary.value.products.filter((item) => item.id !== product.id), product]
          : modelLibrary.value.products,
        bindings: modelLibrary.value.bindings,
      }
      if (repository.available) await persistNow()
      notify(product ? 'Модель добавлена в библиотеку' : 'Модель добавлена в библиотеку без товара')
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
      modelLibrary.value = {
        assets: modelLibrary.value.assets.filter((item) => item.id !== id),
        products: modelLibrary.value.products
          .filter((item) => item.id !== id)
          .map((item) => item.modelId === id ? { ...item, modelId: undefined } : item),
        bindings: Object.fromEntries(Object.entries(modelLibrary.value.bindings).filter(([, modelId]) => modelId !== id)),
      }
      notify('Модель удалена')
    } catch (error) {
      persistenceError = actionableStorageError(error, 'модель в IndexedDB')
      storageError.value = persistenceError
      updateStorageState()
      throw error
    }
  }

  /** Attaches (or detaches) a library model to any product, including built-in ones. */
  const bindProductModel = (productId: string, modelId: string | null): boolean => {
    if (!definitions.value.has(productId)) return rejectCommand('Товар не найден.')
    if (modelId && !modelAssetsById.value.has(modelId)) return rejectCommand('Модель не найдена в библиотеке.')
    const bindings = { ...modelLibrary.value.bindings }
    if (modelId) bindings[productId] = modelId
    else delete bindings[productId]
    modelLibrary.value = { ...modelLibrary.value, bindings }
    notify(modelId ? 'CAD-модель привязана к товару' : 'Привязка CAD-модели снята')
    return true
  }

  /**
   * Swaps the product behind a placed device, e.g. a placeholder whose original product left
   * the catalogue. The move resolver re-packs the row with the new footprint, so a wider
   * replacement still cannot swallow its neighbours.
   */
  const replaceDeviceProduct = (instanceId: string, productId: string): boolean => {
    const device = currentProject.value.devices.find((item) => item.instanceId === instanceId)
    if (!device) return rejectCommand('Устройство не найдено.')
    const product = definitions.value.get(productId)
    if (!product) return rejectCommand('Товар не найден.')
    if (device.productId === productId) return true
    const staged = currentProject.value.devices.map((item) => (item.instanceId === instanceId ? { ...item, productId } : item))
    const result = resolveDeviceMove(staged, instanceId, device.row, device.slot, getRowCapacity(currentProject.value), definitions.value)
    if (result.error) return rejectCommand(result.error)
    commit((project) => {
      renumber(project, result.devices)
    }, 'Товар заменён')
    return true
  }

  /**
   * Cross-checks stored asset metadata against IndexedDB: orphan binaries are removed, and
   * assets whose file disappeared are marked missing so the UI can ask for a re-import instead
   * of silently rendering a procedural face.
   */
  const reconcileModelAssets = async () => {
    if (typeof indexedDB === 'undefined') return
    try {
      const stored = new Set(await listModelAssetIds())
      const assets = modelLibrary.value.assets
      let changed = false
      for (const asset of assets) {
        const hasFile = stored.has(asset.id)
        if (hasFile === !asset.missing) continue
        asset.missing = !hasFile
        changed = true
      }
      const orphans = [...stored].filter((id) => !assets.some((asset) => asset.id === id))
      for (const id of orphans) await deleteModelAsset(id)
      if (changed || orphans.length) modelLibrary.value = { ...modelLibrary.value, assets: [...assets] }
    } catch {
      // IndexedDB being unavailable only costs the missing-file hint; the library still works.
    }
  }
  void reconcileModelAssets()

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
    modelLibrary.value = { assets: [], products: [], bindings: {} }
    histories.value = {}
    selectedDeviceId.value = null
    cabinetMigration.value = null
    projectsDirty = false
    currentProjectDirty = false
    modelsDirty = false
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
    projects, currentProjectId, currentProject, selectedDeviceId, selectedDevice, selectedProduct, cabinetMigration, selectedConnectionId, selectConnection,
    selectedLineId, selectLine,
    definitions, modelLibrary, modelAssetsById, resolveProductModel, undoStack, redoStack, storageStatus, storageError, storageRecovery, storageBackup,
    storageAlert, storageRecoveryNotice, hasStorageBackup, hasStorageRecovery, downloadStorageSnapshot, restoreStorageBackup, dismissStorageAlert,
    lastSavedAt, theme, toast, switchProject, newProject, duplicateProject, renameProject, deleteProject,
    applyPreset, updateSettings, selectCabinet, selectRail, stageCabinetMigration, stageRailMigration,
    commitCabinetMigration, cancelCabinetMigration, addDevice, moveSelected, nudgeSelectedDevice, deleteSelected, duplicateSelected,
    updateSelected, compactSelectedRow, compactAllRows, autoNumberAll, moveDeviceById, addCircuit, updateCircuit, addConnection,
    addComb, updateComb, removeComb, addWire, addBusWire,
    addBusbarConnection, updateConnection, deleteConnection, deleteCircuit, undo, redo, persistNow, flushPersistence,
    addRoom, updateRoom, deleteRoom, addLine, deleteLine, bindProtection, wireLine, cascadeLabel,
    retryPersistence, addImportedModel, deleteImportedModel, bindProductModel, replaceDeviceProduct, clearLocalData, importProject, restoreWorkspaceBackup, notify,
  }
})
