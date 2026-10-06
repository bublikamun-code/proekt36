import { assertValidProjectSchema, PROJECT_SCHEMA_VERSION, validateProjectSchema } from '../domain/projectSchema'
import { migrateProject } from '../domain/project'
import type { ModelMetadata, PanelProject } from '../domain/types'

export const PROJECTS_KEY = 'panel36.projects.v2'
export const LEGACY_PROJECTS_KEY = 'panel36.projects.v1'
export const MODELS_KEY = 'panel36.models.v1'
export const CURRENT_PROJECT_KEY = 'panel36.currentProjectId.v1'
export const PROJECTS_BACKUP_KEY = 'panel36.projects.backup.v1'
export const MODELS_BACKUP_KEY = 'panel36.models.backup.v1'
export const RECOVERY_KEY = 'panel36.storage.recovery.v1'
/** Holds the bytes a batch is about to overwrite, so an interrupted batch can be undone. */
export const JOURNAL_KEY = 'panel36.storage.journal.v1'

export interface StorageRecovery {
  sourceKey: string
  raw: string
  reason: string
  capturedAt: string
  preserved: boolean
}

export interface StorageBackupData {
  projects: PanelProject[] | null
  models: ModelMetadata[] | null
  currentProjectId: string | null
  rawProjects: string | null
  rawModels: string | null
}

export interface WorkspaceRepositorySnapshot {
  projects: PanelProject[]
  models: ModelMetadata[]
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

// Snapshots arrive from the store and may carry nested reactive proxies; the plain
// structuredClone path covers the common raw case, JSON absorbs the rest. Everything
// cloned here is schema-validated JSON data, so the fallback loses nothing.
const clone = <T>(value: T): T => {
  try {
    return structuredClone(value as object) as T
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

const isModelMetadata = (value: unknown): value is ModelMetadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<ModelMetadata>
  return typeof item.id === 'string' && Boolean(item.id.trim())
    && typeof item.name === 'string'
    && typeof item.category === 'string'
    && typeof item.fileType === 'string'
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
  // Compared against the constant rather than a literal: a hardcoded 2 would keep matching v2
  // records after the schema moves to 3, and they would be migrated as if they were current.
  if (candidate.schemaVersion === PROJECT_SCHEMA_VERSION) assertValidProjectSchema(candidate)
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

const normalizeModels = (raw: string): ModelMetadata[] => {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error('models: сохранённые данные должны быть массивом')
  if (!parsed.every(isModelMetadata)) throw new Error('models: обнаружена некорректная метаданные модели')
  const ids = new Set<string>()
  for (const model of parsed) {
    if (ids.has(model.id)) throw new Error(`models: повторяется идентификатор модели «${model.id}»`)
    ids.add(model.id)
  }
  return parsed
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
    this.replayWriteJournal()
  }

  /**
   * localStorage has no multi-key transaction. A snapshot spans three keys, so a failure halfway
   * through left `panel36.projects.v2` updated while `panel36.currentProjectId.v1` still named the
   * previous project — a set of keys that no write of this app ever produces.
   *
   * Each batch therefore stores the bytes it is about to overwrite in `JOURNAL_KEY` before touching
   * anything. A failure inside the batch restores them right away; a tab that dies mid-write leaves
   * the journal behind, and the next start replays it here. Without the journal a half-written
   * snapshot is discovered only when the stored data turns out to be inconsistent, by which point
   * the previous generation is already gone.
   */
  private replayWriteJournal() {
    if (!this.storage) return
    let raw: string | null
    try {
      raw = this.storage.getItem(JOURNAL_KEY)
    } catch {
      return
    }
    if (!raw) return
    try {
      const entries = JSON.parse(raw) as Array<{ key: string; value: string | null }>
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!entry || typeof entry.key !== 'string') continue
          if (entry.value === null) this.storage.removeItem(entry.key)
          else this.storage.setItem(entry.key, entry.value)
        }
      }
    } catch {
      // A journal we cannot read is worse than none: it only ever holds bytes this app wrote, so
      // dropping it leaves the current state in place instead of guessing at the previous one.
    }
    try {
      this.storage.removeItem(JOURNAL_KEY)
    } catch {
      // Nothing more to try; the next start will meet the same journal and skip it again.
    }
  }

  /** Runs `write` as one unit: journal first, roll back on any failure. */
  private writeAtomically(write: () => void) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    const previous: Array<{ key: string; value: string | null }> = []
    let journalled = false
    try {
      for (const key of [PROJECTS_KEY, PROJECTS_BACKUP_KEY, MODELS_KEY, MODELS_BACKUP_KEY, CURRENT_PROJECT_KEY]) {
        previous.push({ key, value: this.readRaw(key) })
      }
      this.writeRaw(JOURNAL_KEY, JSON.stringify(previous))
      journalled = true
      write()
      this.removeRaw(JOURNAL_KEY)
    } catch (error) {
      if (journalled) {
        for (const entry of previous) {
          try {
            if (entry.value === null) this.removeRaw(entry.key)
            else this.writeRaw(entry.key, entry.value)
          } catch {
            // Keep rolling back the rest: one unrecoverable key must not strand the others.
          }
        }
        try {
          this.removeRaw(JOURNAL_KEY)
        } catch {
          // The journal stays and the next start replays it, which is the same restoration.
        }
      }
      throw error
    }
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

  private parseModels(raw: string) {
    return normalizeModels(raw)
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

  private readModelsWithRecovery(fallback: ModelMetadata[]): ModelMetadata[] {
    const raw = this.readRaw(MODELS_KEY)
    if (raw !== null) {
      try {
        return this.parseModels(raw)
      } catch (error) {
        this.recordInvalid(MODELS_KEY, raw, error instanceof Error ? error.message : String(error))
      }
    }
    const backupRaw = this.readRaw(MODELS_BACKUP_KEY)
    if (backupRaw !== null) {
      try {
        const models = this.parseModels(backupRaw)
        this.backup.models = clone(models)
        this.backup.rawModels = backupRaw
        return models
      } catch (error) {
        this.recordInvalid(MODELS_BACKUP_KEY, backupRaw, error instanceof Error ? error.message : String(error))
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

  load(fallbackProjects: PanelProject[], fallbackModels: ModelMetadata[] = []): WorkspaceRepositorySnapshot {
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
            this.backup.models = this.parseModels(backupRaw)
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

  save(snapshot: { projects: PanelProject[]; models: ModelMetadata[]; currentProjectId: string }) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    for (const project of snapshot.projects) assertValidProjectSchema(project)
    if (snapshot.models.some((model) => !isModelMetadata(model))) throw new Error('Некорректные метаданные модели')
    this.persistRecovery()
    this.writeAtomically(() => {
      this.writeWithBackup(PROJECTS_KEY, PROJECTS_BACKUP_KEY, JSON.stringify(snapshot.projects), !this.recovery.some((item) => item.sourceKey === PROJECTS_KEY))
      this.writeWithBackup(MODELS_KEY, MODELS_BACKUP_KEY, JSON.stringify(snapshot.models), !this.recovery.some((item) => item.sourceKey === MODELS_KEY))
      this.writeRaw(CURRENT_PROJECT_KEY, snapshot.currentProjectId)
    })
    this.backup.projects = clone(snapshot.projects)
    this.backup.models = clone(snapshot.models)
    this.backup.currentProjectId = snapshot.currentProjectId
    this.backup.rawProjects = JSON.stringify(snapshot.projects)
    this.backup.rawModels = JSON.stringify(snapshot.models)
  }

  saveCurrentProjectId(id: string) {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    if (!id.trim()) throw new Error('Нельзя сохранить пустой идентификатор текущего проекта')
    this.writeRaw(CURRENT_PROJECT_KEY, id)
    this.backup.currentProjectId = id
  }

  clear() {
    if (!this.storage) throw new Error('Локальное хранилище недоступно')
    const keys = [PROJECTS_KEY, LEGACY_PROJECTS_KEY, PROJECTS_BACKUP_KEY, MODELS_KEY, MODELS_BACKUP_KEY, CURRENT_PROJECT_KEY, RECOVERY_KEY, JOURNAL_KEY]
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

export const validateStoredProjects = (value: unknown) => {
  const projects = Array.isArray(value) ? value : []
  return projects.map((project) => validateProjectSchema(project))
}
