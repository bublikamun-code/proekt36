import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { builtinCatalog, enmasSeriesCatalog, sampleCatalog } from '../data/catalog'
import {
  compactRow,
  evaluateCabinetMigration,
  getFootprintModules,
  getRowCapacity,
  placeProduct,
  resolveDeviceMove,
  type LayoutMigrationPlan,
} from '../domain/layout'
import { autoNumber, createProject, migrateProject, presetProducts, uid } from '../domain/project'
import type { RestoredWorkspaceBackup } from '../domain/projectBackup'
import { downloadJsonFile } from '../domain/projectBackup'
import { assertValidProjectSchema, PROJECT_LIMITS, PROJECT_SCHEMA_VERSION } from '../domain/projectSchema'
import type { Circuit, Connection, DeviceDefinition, ModelMetadata, PanelProject, PlacedDevice, ProjectSettings } from '../domain/types'
import { clearModelAssets, deleteModelAsset, putModelAsset } from '../storage/modelDb'
import { actionableStorageError, WorkspaceRepository, type StorageBackupData, type StorageRecovery } from '../storage/projectRepository'
import { usePreferencesStore } from './preferences'

const HISTORY_LIMIT = 50
const COALESCE_WINDOW_MS = 800
const PERSIST_DELAY_MS = 450
type ProjectHistory = { undo: PanelProject[]; redo: PanelProject[] }
type StorageStatus = 'saving' | 'saved' | 'save-failed' | 'storage-unavailable'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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
    ...builtinCatalog.map((item) => [item.id, item] as const),
    ...enmasSeriesCatalog.map((item) => [item.id, item] as const),
    ...sampleCatalog.map((item) => [item.id, item] as const),
    ...importedModels.value.map((model) => [model.id, {
      id: model.id, name: model.name, brand: model.brand, sku: model.sku, category: model.category,
      moduleWidth: model.moduleWidth, poles: model.poles, ratedCurrent: model.ratedCurrent,
      voltage: model.voltage, bus: model.bus, price: model.price, weight: model.weight,
      height: model.height, depth: model.depth, color: '#d9ded8', imported: true, modelAssetId: model.id,
    }] as const),
  ]))
  const selectedDevice = computed(() => currentProject.value.devices.find((item) => item.instanceId === selectedDeviceId.value) ?? null)
  const selectedProduct = computed(() => selectedDevice.value ? definitions.value.get(selectedDevice.value.productId) ?? null : null)

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
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { void flushPersistence() })

  watch([projects, importedModels], schedulePersistence, { deep: true })

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
    const result = placeProduct(currentProject.value.devices, product, row, slot, getRowCapacity(currentProject.value), uid, definitions.value)
    if (result.error) return notify(result.error, 'error')
    const previousIds = new Set(currentProject.value.devices.map((item) => item.instanceId))
    let linked = 0
    commit((project) => {
      project.devices = autoNumber(result.devices, definitions.value)
      linked = syncBusbarConnections(project, new Set(project.devices.filter((item) => !previousIds.has(item.instanceId)).map((item) => item.instanceId)))
    })
    selectedDeviceId.value = result.devices.find((item) => !previousIds.has(item.instanceId))?.instanceId ?? null
    if (linked) notify(`Аппарат добавлен и подключён к шине`)
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

  const autoNumberAll = () => commit((project) => { project.devices = autoNumber(project.devices, definitions.value) }, 'Адреса обновлены')

  const addBusbarConnection = (fromDeviceId: string, toDeviceId: string) => {
    const source = currentProject.value.devices.find((item) => item.instanceId === fromDeviceId)
    const target = currentProject.value.devices.find((item) => item.instanceId === toDeviceId)
    if (!source || source.mount !== 'busbar' || !target) return notify('Выберите шину Fork и аппарат назначения', 'error')
    if (currentProject.value.connections.some((item) => item.kind === 'busbar' && item.fromDeviceId === fromDeviceId && item.toDeviceId === toDeviceId)) return notify('Такое подключение уже есть', 'error')
    commit((project) => project.connections.push({ id: uid(), circuitId: '', fromBus: 'L', toDeviceId, color: '#aeb8b4', thickness: 2, label: `FORK → ${target.address || 'аппарат'}`, kind: 'busbar', fromDeviceId }), 'Шина подключена')
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


  const deleteConnection = (id: string) => commit((project) => {
    project.connections = project.connections.filter((item) => item.id !== id)
  }, 'Подключение удалено')

  const deleteCircuit = (id: string) => commit((project) => {
    project.circuits = project.circuits.filter((item) => item.id !== id)
    project.connections = project.connections.filter((item) => item.circuitId !== id)
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

  const addImportedModel = async (metadata: ModelMetadata, data: ArrayBuffer) => {
    try {
      await putModelAsset(metadata.id, data)
      importedModels.value.push(metadata)
      if (repository.available) await persistNow()
      notify('Модель добавлена в библиотеку')
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
    definitions, importedModels, undoStack, redoStack, storageStatus, storageError, storageRecovery, storageBackup,
    storageAlert, storageRecoveryNotice, hasStorageBackup, hasStorageRecovery, downloadStorageSnapshot, restoreStorageBackup, dismissStorageAlert,
    lastSavedAt, theme, toast, switchProject, newProject, duplicateProject, renameProject, deleteProject,
    applyPreset, updateSettings, selectCabinet, selectRail, stageCabinetMigration, stageRailMigration,
    commitCabinetMigration, cancelCabinetMigration, addDevice, moveSelected, nudgeSelectedDevice, deleteSelected, duplicateSelected,
    updateSelected, compactSelectedRow, compactAllRows, autoNumberAll, moveDeviceById, addCircuit, updateCircuit, addConnection,
    addBusbarConnection, updateConnection, deleteConnection, deleteCircuit, undo, redo, persistNow, flushPersistence,
    retryPersistence, addImportedModel, deleteImportedModel, clearLocalData, importProject, restoreWorkspaceBackup, notify,
  }
})
