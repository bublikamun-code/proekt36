import { assertValidProjectSchema, PROJECT_SCHEMA_VERSION } from '../domain/projectSchema'
import { migrateProject } from '../domain/project'
import { DEVICE_CATEGORIES } from '../domain/types'
import type { DeviceDefinition, ModelFormat, PanelProject, StoredModelAsset, StoredModelLibrary } from '../domain/types'

export const PROJECTS_KEY = 'panel36.projects.v2'
export const LEGACY_PROJECTS_KEY = 'panel36.projects.v1'
export const MODELS_KEY = 'panel36.models.v2'
export const LEGACY_MODELS_KEY = 'panel36.models.v1'
export const CURRENT_PROJECT_KEY = 'panel36.currentProjectId.v1'
export const PROJECTS_BACKUP_KEY = 'panel36.projects.backup.v1'
export const MODELS_BACKUP_KEY = 'panel36.models.backup.v2'
export const LEGACY_MODELS_BACKUP_KEY = 'panel36.models.backup.v1'
export const RECOVERY_KEY = 'panel36.storage.recovery.v1'

export interface StorageRecovery {
  sourceKey: string
  raw: string
  reason: string
  capturedAt: string
  preserved: boolean
}

export interface StorageBackupData {
  projects: PanelProject[] | null
  models: StoredModelLibrary | null
  currentProjectId: string | null
  rawProjects: string | null
  rawModels: string | null
}

export interface WorkspaceRepositorySnapshot {
  projects: PanelProject[]
  models: StoredModelLibrary
  currentProjectId: string | null
  available: boolean
  recovery: StorageRecovery[]
  backup: StorageBackupData
}

interface LocalStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface RecoveryRecord {
  sourceKey: string
  raw: string
  reason: string
  capturedAt: string
}

const getDefaultStorage = (): LocalStorageLike | null => {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const MODEL_FORMATS: readonly ModelFormat[] = ['glb', 'gltf', 'gltf-zip']
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isStoredModelAsset = (value: unknown): value is StoredModelAsset => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<StoredModelAsset> & { transform?: Partial<StoredModelAsset['transform']> }
  return typeof item.id === 'string' && Boolean(item.id.trim())
    && typeof item.name === 'string'
    && item.source === 'local'
    && MODEL_FORMATS.includes(item.format as ModelFormat)
    && Boolean(item.transform && isFiniteNumber(item.transform.scale) && item.transform.scale > 0 && isFiniteNumber(item.transform.rotationY))
    && (item.thumbnailDataUrl === undefined || typeof item.thumbnailDataUrl === 'string')
    && (item.fileName === undefined || typeof item.fileName === 'string')
    && (item.missing === undefined || typeof item.missing === 'boolean')
    && typeof item.createdAt === 'string'
}

/** Product stubs enter definitions and board geometry, so every number must survive a reload. */
export const isImportedProduct = (value: unknown): value is DeviceDefinition => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<DeviceDefinition>
  return typeof item.id === 'string' && Boolean(item.id.trim())
    && typeof item.name === 'string' && Boolean(item.name.trim())
    && typeof item.brand === 'string'
    && typeof item.sku === 'string'
    && (DEVICE_CATEGORIES as readonly string[]).includes(String(item.category))
    && isFiniteNumber(item.moduleWidth) && item.moduleWidth > 0 && item.moduleWidth <= 24
    && isFiniteNumber(item.poles) && item.poles >= 1 && item.poles <= 12
    && isFiniteNumber(item.ratedCurrent) && item.ratedCurrent > 0
    && (item.voltage === 230 || item.voltage === 400)
    && (item.bus === 'L' || item.bus === 'N' || item.bus === 'PE')
    && isFiniteNumber(item.price) && item.price >= 0
    && isFiniteNumber(item.weight) && item.weight >= 0
    && isFiniteNumber(item.height) && item.height >= 1
    && isFiniteNumber(item.depth) && item.depth >= 1
    && item.imported === true
    && (item.modelId === undefined || typeof item.modelId === 'string')
}

/** One record of the pre-split library: a model that also was a product. */
interface LegacyModelMetadata {
  id: string
  name: string
  brand: string
  sku: string
  category: string
  moduleWidth: number
  poles: number
  ratedCurrent: number
  voltage: 230 | 400
  bus: string
  price: number
  weight: number
  height: number
  depth: number
  fileName: string
  fileType: 'glb' | 'gltf'
  createdAt: string
}

const asLegacyModelMetadata = (value: unknown): LegacyModelMetadata | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Partial<LegacyModelMetadata>
  if (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || typeof item.fileType !== 'string') return null
  const numbers = [item.moduleWidth, item.poles, item.ratedCurrent, item.price, item.weight, item.height, item.depth]
  return numbers.every(isFiniteNumber)
    && typeof item.brand === 'string' && typeof item.sku === 'string' && typeof item.category === 'string'
    && typeof item.bus === 'string' && typeof item.fileName === 'string' && typeof item.createdAt === 'string'
    ? value as LegacyModelMetadata
    : null
}

/**
 * v1 stored one record per import where the asset and the product shared an id. The split keeps
 * that id on both sides, so every PlacedDevice.productId written before the migration still
 * resolves to the migrated product stub.
 */
export const migrateLegacyModels = (items: unknown[]): StoredModelLibrary => {
  const library: StoredModelLibrary = { assets: [], products: [], bindings: {} }
  for (const entry of items) {
    const legacy = asLegacyModelMetadata(entry)
    if (!legacy) continue
    library.assets.push({
      id: legacy.id,
      name: legacy.name,
      source: 'local',
      format: legacy.fileType === 'glb' ? 'glb' : 'gltf',
      transform: { scale: 1, rotationY: 0 },
      fileName: legacy.fileName,
      createdAt: legacy.createdAt,
    })
    library.products.push({
      id: legacy.id,
      name: legacy.name,
      brand: legacy.brand,
      sku: legacy.sku,
      category: (DEVICE_CATEGORIES as readonly string[]).includes(legacy.category) ? legacy.category as DeviceDefinition['category'] : 'MCB',
      moduleWidth: legacy.moduleWidth,
      poles: legacy.poles,
      ratedCurrent: legacy.ratedCurrent,
      voltage: legacy.voltage === 400 ? 400 : 230,
      bus: legacy.bus === 'N' ? 'N' : legacy.bus === 'PE' ? 'PE' : 'L',
      price: legacy.price,
      weight: legacy.weight,
      height: legacy.height,
      depth: legacy.depth,
      imported: true,
      modelId: legacy.id,
    })
  }
  return library
}

const normalizeProject = (value: unknown, strict: boolean): PanelProject => {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (strict) {
    // A record read from a current-schema key is data this app itself wrote, so anything
    // else means the record is damaged. Repairing it here would be silent data loss: the
    // user would get an empty panel with a new id and a fresh timestamp, with no record
    // that anything had been thrown away. Refusing it hands the raw text to the caller
    // instead, which preserves it as a recovery snapshot.
    if (candidate.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      throw new Error(`ожидается schemaVersion ${PROJECT_SCHEMA_VERSION}, получено ${JSON.stringify(candidate.schemaVersion ?? null)}`)
    }
    return assertValidProjectSchema(candidate)
  }
  if (candidate.schemaVersion === 2) assertValidProjectSchema(candidate)
  return assertValidProjectSchema(migrateProject(candidate as Partial<PanelProject>))
}

const normalizeProjects = (raw: string, strict: boolean): PanelProject[] => {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error('projects: сохранённые данные должны быть массивом')
  const projects: PanelProject[] = []
  const errors: string[] = []
  parsed.forEach((value, index) => {
    try {
      projects.push(normalizeProject(value, strict))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка схемы'
      errors.push(`projects[${index}]: ${message}`)
    }
  })
  if (parsed.length && errors.length === parsed.length) throw new Error(errors.join('; '))
  if (errors.length) throw new Error(`Часть проектов повреждена: ${errors.join('; ')}`)
  const ids = new Set<string>()
  for (const project of projects) {
    if (ids.has(project.id)) throw new Error(`projects: повторяется идентификатор проекта «${project.id}»`)
    ids.add(project.id)
  }
  return projects
}

const normalizeModelLibrary = (raw: string): StoredModelLibrary => {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('models: ожидается объект библиотеки моделей')
  const record = parsed as Partial<StoredModelLibrary> & { assets?: unknown; products?: unknown; bindings?: unknown }
  if (!Array.isArray(record.assets) || !Array.isArray(record.products)) throw new Error('models: assets и products должны быть массивами')
  if (record.bindings === undefined || record.bindings === null || typeof record.bindings !== 'object' || Array.isArray(record.bindings)) {
    throw new Error('models: bindings должен быть объектом')
  }
  if (!record.assets.every(isStoredModelAsset)) throw new Error('models: обнаружен некорректный ассет модели')
  if (!record.products.every(isImportedProduct)) throw new Error('models: обнаружен некорректный товар импорта')
  const bindings: Record<string, string> = {}
  for (const [productId, modelId] of Object.entries(record.bindings)) {
    if (typeof modelId !== 'string' || !modelId.trim()) throw new Error(`models: некорректная привязка модели для «${productId}»`)
    bindings[productId] = modelId
  }
  const assetIds = new Set<string>()
  for (const asset of record.assets) {
    if (assetIds.has(asset.id)) throw new Error(`models: повторяется идентификатор ассета «${asset.id}»`)
    assetIds.add(asset.id)
  }
  const productIds = new Set<string>()
  for (const product of record.products) {
    if (productIds.has(product.id)) throw new Error(`models: повторяется идентификатор товара «${product.id}»`)
    productIds.add(product.id)
  }
  return { assets: clone(record.assets), products: clone(record.products), bindings }
}

const errorName = (error: unknown) => error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const actionableStorageError = (error: unknown, subject = 'данные') => {
  const name = errorName(error)
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(errorMessage(error))) {
    return `Не удалось сохранить ${subject}: хранилище браузера переполнено. Экспортируйте проект в JSON, затем удалите лишние проекты или модели.`
  }
  if (name === 'SecurityError' || name === 'NotAllowedError' || /security|denied|blocked/i.test(errorMessage(error))) {
    return `Не удалось сохранить ${subject}: браузер запретил доступ к локальному хранилищу. Разрешите сохранение сайта и повторите.`
  }
  return `Не удалось сохранить ${subject}: ${errorMessage(error)}`
}

export class WorkspaceRepository {
  private readonly storage: LocalStorageLike | null
  private recovery: StorageRecovery[] = []
  private backup: StorageBackupData = { projects: null, models: null, currentProjectId: null, rawProjects: null, rawModels: null }
  private storageAvailable: boolean

  constructor(storage: LocalStorageLike | null = getDefaultStorage()) {
    this.storage = storage
    this.storageAvailable = Boolean(storage)
  }

  get available() {
    return this.storageAvailable
  }

  get recoveryData() {
    return this.recovery.map((item) => ({ ...item }))
  }

  get backupData() {
    return {
      ...this.backup,
      projects: this.backup.projects ? clone(this.backup.projects) : null,
      models: this.backup.models ? clone(this.backup.models) : null,
    }
  }

  private readRaw(key: string): string | null {
    if (!this.storage) return null
    try {
      return this.storage.getItem(key)
    } catch (error) {
      this.storageAvailable = false
      throw error
    }
  }

  private writeRaw(key: string, value: string) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    try {
      this.storage.setItem(key, value)
    } catch (error) {
      if (errorName(error) === 'SecurityError' || errorName(error) === 'NotAllowedError') this.storageAvailable = false
      throw error
    }
  }

  private removeRaw(key: string) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    try {
      this.storage.removeItem(key)
    } catch (error) {
      if (errorName(error) === 'SecurityError' || errorName(error) === 'NotAllowedError') this.storageAvailable = false
      throw error
    }
  }

  private parseProjects(raw: string, strict = true) {
    return normalizeProjects(raw, strict)
  }

  private parseModels(raw: string, legacy: boolean) {
    if (!legacy) return normalizeModelLibrary(raw)
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('models: сохранённые данные должны быть массивом')
    return migrateLegacyModels(parsed)
  }

  private recordInvalid(sourceKey: string, raw: string, reason: string) {
    const existing = this.recovery.find((item) => item.sourceKey === sourceKey)
    if (existing) {
      existing.raw = raw
      existing.reason = reason
      existing.capturedAt = new Date().toISOString()
      existing.preserved = false
      return
    }
    this.recovery.push({ sourceKey, raw, reason, capturedAt: new Date().toISOString(), preserved: false })
  }

  private readProjectsWithRecovery(primaryKeys: string[], fallback: PanelProject[]): PanelProject[] {
    for (const key of primaryKeys) {
      const raw = this.readRaw(key)
      if (raw === null) continue
      try {
        // Only the v1 key is allowed to be migrated; the current key holds records this
        // app wrote, so a mismatch there is damage and not an old format.
        return this.parseProjects(raw, key !== LEGACY_PROJECTS_KEY)
      } catch (error) {
        this.recordInvalid(key, raw, error instanceof Error ? error.message : String(error))
      }
    }
    const backupRaw = this.readRaw(PROJECTS_BACKUP_KEY)
    if (backupRaw !== null) {
      try {
        const projects = this.parseProjects(backupRaw)
        this.backup.projects = clone(projects)
        this.backup.rawProjects = backupRaw
        return projects
      } catch (error) {
        this.recordInvalid(PROJECTS_BACKUP_KEY, backupRaw, error instanceof Error ? error.message : String(error))
      }
    }
    return fallback
  }

  private readModelsWithRecovery(fallback: StoredModelLibrary): StoredModelLibrary {
    const raw = this.readRaw(MODELS_KEY)
    if (raw !== null) {
      try {
        return this.parseModels(raw, false)
      } catch (error) {
        this.recordInvalid(MODELS_KEY, raw, error instanceof Error ? error.message : String(error))
      }
    }
    const backupRaw = this.readRaw(MODELS_BACKUP_KEY)
    if (backupRaw !== null) {
      try {
        const models = this.parseModels(backupRaw, false)
        this.backup.models = clone(models)
        this.backup.rawModels = backupRaw
        return models
      } catch (error) {
        this.recordInvalid(MODELS_BACKUP_KEY, backupRaw, error instanceof Error ? error.message : String(error))
      }
    }
    // The pre-split library kept one array where an asset doubled as a product; both v1 keys
    // (primary and backup) migrate the same lossless way, preserving every id.
    for (const legacyKey of [LEGACY_MODELS_KEY, LEGACY_MODELS_BACKUP_KEY]) {
      const legacyRaw = this.readRaw(legacyKey)
      if (legacyRaw === null) continue
      try {
        return this.parseModels(legacyRaw, true)
      } catch (error) {
        this.recordInvalid(legacyKey, legacyRaw, error instanceof Error ? error.message : String(error))
      }
    }
    return fallback
  }

  private restoreRecoveryRecord(): StorageRecovery[] {
    const raw = this.readRaw(RECOVERY_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { records?: unknown }).records)) return []
      return (parsed as { records: RecoveryRecord[] }).records
        .filter((item) => item && typeof item.sourceKey === 'string' && typeof item.raw === 'string')
        .map((item) => ({ ...item, preserved: true }))
    } catch {
      return []
    }
  }

  private persistRecovery() {
    if (!this.recovery.length || this.recovery.every((item) => item.preserved)) return
    const existing = this.restoreRecoveryRecord()
    const byKey = new Map(existing.map((item) => [item.sourceKey, item]))
    for (const item of this.recovery) byKey.set(item.sourceKey, { sourceKey: item.sourceKey, raw: item.raw, reason: item.reason, capturedAt: item.capturedAt, preserved: true })
    const records = [...byKey.values()]
    this.writeRaw(RECOVERY_KEY, JSON.stringify({ schema: 'panel36.storage-recovery.v1', records }))
    for (const item of this.recovery) {
      const saved = records.find((record) => record.sourceKey === item.sourceKey)
      if (saved?.raw === item.raw) item.preserved = true
    }
  }

  load(fallbackProjects: PanelProject[], fallbackModels: StoredModelLibrary = { assets: [], products: [], bindings: {} }): WorkspaceRepositorySnapshot {
    this.recovery = []
    this.backup = { projects: null, models: null, currentProjectId: null, rawProjects: null, rawModels: null }
    if (!this.storage) {
      this.storageAvailable = false
      return { projects: clone(fallbackProjects), models: clone(fallbackModels), currentProjectId: null, available: false, recovery: [], backup: this.backupData }
    }
    try {
      this.storage.getItem(PROJECTS_KEY)
      this.storageAvailable = true
    } catch {
      this.storageAvailable = false
      return { projects: clone(fallbackProjects), models: clone(fallbackModels), currentProjectId: null, available: false, recovery: [], backup: this.backupData }
    }
    try {
      const projects = this.readProjectsWithRecovery([PROJECTS_KEY, LEGACY_PROJECTS_KEY], fallbackProjects)
      const models = this.readModelsWithRecovery(fallbackModels)
      if (!this.backup.projects) {
        const backupRaw = this.readRaw(PROJECTS_BACKUP_KEY)
        if (backupRaw !== null) {
          try {
            this.backup.projects = this.parseProjects(backupRaw)
            this.backup.rawProjects = backupRaw
          } catch {
            // The primary snapshot is healthy; an invalid old backup is replaced on the next safe write.
          }
        }
      }
      if (!this.backup.models) {
        const backupRaw = this.readRaw(MODELS_BACKUP_KEY)
        if (backupRaw !== null) {
          try {
            this.backup.models = this.parseModels(backupRaw, false)
            this.backup.rawModels = backupRaw
          } catch {
            // The primary snapshot is healthy; an invalid old backup is replaced on the next safe write.
          }
        }
      }
      const currentRaw = this.readRaw(CURRENT_PROJECT_KEY)
      const currentProjectId = currentRaw && projects.some((project) => project.id === currentRaw) ? currentRaw : null
      const previousRecovery = this.restoreRecoveryRecord()
      for (const item of previousRecovery) {
        if (!this.recovery.some((current) => current.sourceKey === item.sourceKey)) this.recovery.push(item)
      }
      try {
        this.persistRecovery()
      } catch {
        // Recovery remains exposed in memory; a later save refuses to overwrite it until preservation succeeds.
      }
      return { projects, models, currentProjectId, available: true, recovery: this.recoveryData, backup: this.backupData }
    } catch (error) {
      this.storageAvailable = false
      return { projects: clone(fallbackProjects), models: clone(fallbackModels), currentProjectId: null, available: false, recovery: this.recoveryData, backup: this.backupData }
    }
  }

  private writeWithBackup(key: string, backupKey: string, value: string, preserveExistingBackup: boolean) {
    if (preserveExistingBackup) {
      const previous = this.readRaw(key)
      if (previous !== null) this.writeRaw(backupKey, previous)
    }
    this.writeRaw(key, value)
  }

  /**
   * @param options.modelsDirty the model library changed since the last write; without it the
   * models key (and its backup copy) is skipped unless it has never been written at all, so a
   * project-only autosave stops re-serializing the library on every keystroke.
   */
  save(snapshot: { projects: PanelProject[]; models: StoredModelLibrary; currentProjectId: string }, options: { modelsDirty?: boolean } = {}) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    for (const project of snapshot.projects) assertValidProjectSchema(project)
    const library = snapshot.models
    if (!library.assets.every(isStoredModelAsset) || !library.products.every(isImportedProduct)) {
      throw new Error('Некорректная библиотека моделей')
    }
    this.persistRecovery()
    this.writeWithBackup(PROJECTS_KEY, PROJECTS_BACKUP_KEY, JSON.stringify(snapshot.projects), !this.recovery.some((item) => item.sourceKey === PROJECTS_KEY))
    const modelsRaw = JSON.stringify(library)
    if (options.modelsDirty || this.readRaw(MODELS_KEY) === null) {
      this.writeWithBackup(MODELS_KEY, MODELS_BACKUP_KEY, modelsRaw, !this.recovery.some((item) => item.sourceKey === MODELS_KEY))
    }
    this.writeRaw(CURRENT_PROJECT_KEY, snapshot.currentProjectId)
    this.backup.projects = clone(snapshot.projects)
    this.backup.models = clone(library)
    this.backup.currentProjectId = snapshot.currentProjectId
    this.backup.rawProjects = JSON.stringify(snapshot.projects)
    this.backup.rawModels = modelsRaw
    // The v2 record is durable now, so the pre-split keys go; a failed removal only leaves
    // stale data that migrates again harmlessly on the next load.
    for (const legacyKey of [LEGACY_MODELS_KEY, LEGACY_MODELS_BACKUP_KEY]) {
      try {
        this.removeRaw(legacyKey)
      } catch {
        // Ignored on purpose: removal retries on every later save.
      }
    }
  }

  saveCurrentProjectId(id: string) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    if (!id.trim()) throw new Error('Нельзя сохранить пустой идентификатор текущего проекта')
    this.writeRaw(CURRENT_PROJECT_KEY, id)
    this.backup.currentProjectId = id
  }

  clear() {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    const keys = [PROJECTS_KEY, LEGACY_PROJECTS_KEY, PROJECTS_BACKUP_KEY, MODELS_KEY, MODELS_BACKUP_KEY, LEGACY_MODELS_KEY, LEGACY_MODELS_BACKUP_KEY, CURRENT_PROJECT_KEY, RECOVERY_KEY]
    const errors: unknown[] = []
    for (const key of keys) {
      try {
        this.removeRaw(key)
      } catch (error) {
        errors.push(error)
      }
    }
    this.recovery = []
    this.backup = { projects: null, models: null, currentProjectId: null, rawProjects: null, rawModels: null }
    if (errors.length) throw new Error(errors.map((error) => errorMessage(error)).join('; '))
  }
}
