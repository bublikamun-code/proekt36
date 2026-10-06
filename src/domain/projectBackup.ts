import { allCatalog, CATALOG_REVISION } from '../data/catalog'
import { migrateProject } from './project'
import { APPLICATION_REVISION, assertValidProjectSchema, isFutureRevision, isKnownRevision, PROJECT_SCHEMA_VERSION } from './projectSchema'
import { modelWord, projectWord } from './plural'
import type { ModelMetadata, PanelProject } from './types'

const BACKUP_SCHEMA = 'panel36.backup.v1'
const MAX_BACKUP_FILE_SIZE = 10 * 1024 * 1024
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const clone = <T>(value: T): T => structuredClone(value as object) as T

export interface WorkspaceBackup {
  schema: typeof BACKUP_SCHEMA
  application: { name: 'Panel36'; revision: string }
  exportedAt: string
  catalogRevision: string
  cad: {
    binaryIncluded: false
    modelManifest: { modelIds: string[] }
  }
  currentProjectId: string | null
  projects: PanelProject[]
}

export interface RestoredWorkspaceBackup {
  projects: PanelProject[]
  currentProjectId: string | null
  /** Products whose CAD model has to be imported again before it renders. */
  pendingLocalCad: string[]
}

export const createWorkspaceBackup = (
  projects: PanelProject[],
  importedModels: ModelMetadata[],
  currentProjectId: string | null,
  exportedAt = new Date().toISOString(),
): WorkspaceBackup => ({
  schema: BACKUP_SCHEMA,
  application: { name: 'Panel36', revision: APPLICATION_REVISION },
  exportedAt,
  catalogRevision: CATALOG_REVISION,
  cad: { binaryIncluded: false, modelManifest: { modelIds: importedModels.map((model) => model.id) } },
  currentProjectId: projects.some((project) => project.id === currentProjectId) ? currentProjectId : null,
  projects: clone(projects),
})

export const downloadJsonFile = (payload: unknown, fileName: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadWorkspaceBackup = (
  projects: PanelProject[],
  importedModels: ModelMetadata[],
  currentProjectId: string | null,
) => {
  const backup = createWorkspaceBackup(projects, importedModels, currentProjectId)
  downloadJsonFile(backup, `panel36-backup-${new Date().toISOString().slice(0, 10)}.json`)
}

/**
 * Projects that reference a product outside the built-in catalogue depend on a locally
 * imported CAD model. Binaries are never part of the archive, so such a file can only be
 * restored once the same model has been imported again in the same browser.
 */
export const backupNeedsLocalCad = (projects: PanelProject[]): string[] => {
  const knownProducts = new Set(allCatalog.map((product) => product.id))
  const unresolved = projects.flatMap((project) => project.devices.map((device) => device.productId))
  return [...new Set(unresolved.filter((id) => !knownProducts.has(id)))]
}

export const readWorkspaceBackup = async (file: File): Promise<RestoredWorkspaceBackup> => {
  if (file.size > MAX_BACKUP_FILE_SIZE) throw new Error('Файл резервной копии больше 10 МБ')

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('Не удалось прочитать JSON резервной копии')
  }

  if (!isRecord(parsed)) throw new Error('Резервная копия должна быть JSON-объектом')
  if (parsed.schema !== BACKUP_SCHEMA) throw new Error(`Ожидается формат резервной копии «${BACKUP_SCHEMA}»`)
  if (!isRecord(parsed.application) || parsed.application.name !== 'Panel36' || !isKnownRevision(parsed.application.revision)) {
    throw new Error('Резервная копия создана другой версией приложения')
  }
  if (isFutureRevision(parsed.application.revision, APPLICATION_REVISION)) {
    throw new Error(`Резервная копия создана более новой версией приложения (${parsed.application.revision}), чем установленная (${APPLICATION_REVISION}). Обновите Panel36 и повторите импорт.`)
  }
  if (typeof parsed.exportedAt !== 'string' || Number.isNaN(Date.parse(parsed.exportedAt))) throw new Error('Неверна дата экспорта резервной копии')
  if (!isKnownRevision(parsed.catalogRevision)) throw new Error('Резервная копия создана для другой ревизии каталога')
  if (isFutureRevision(parsed.catalogRevision, CATALOG_REVISION)) {
    throw new Error(`Резервная копия создана для более новой ревизии каталога (${String(parsed.catalogRevision)}), чем установленная (${CATALOG_REVISION}). Обновите Panel36 и повторите импорт.`)
  }
  if (!isRecord(parsed.cad) || parsed.cad.binaryIncluded !== false || !isRecord(parsed.cad.modelManifest) || !Array.isArray(parsed.cad.modelManifest.modelIds)) {
    throw new Error('Повреждена manifest локальных CAD-моделей')
  }
  if (!Array.isArray(parsed.projects) || !parsed.projects.length) throw new Error('В резервной копии нет проектов')
  if (parsed.projects.length > 5000) throw new Error('В резервной копии слишком много проектов')

  const projects = parsed.projects.map((value, index) => {
    try {
      const candidate = isRecord(value) && value.schemaVersion === PROJECT_SCHEMA_VERSION
        ? assertValidProjectSchema(value)
        : assertValidProjectSchema(migrateProject(value as Partial<PanelProject>))
      return clone(candidate)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка схемы'
      throw new Error(`projects[${index}]: ${message}`)
    }
  })

  const ids = new Set<string>()
  for (const project of projects) {
    if (ids.has(project.id)) throw new Error(`В резервной копии повторяется проект «${project.id}»`)
    ids.add(project.id)
  }

  // A project referencing a locally imported CAD model restores as a labelled placeholder
  // until that model is imported again, so this is reported to the caller rather than
  // refused — refusing would make the whole archive unusable after the models are gone.
  const pendingLocalCad = backupNeedsLocalCad(projects)

  const currentProjectId = typeof parsed.currentProjectId === 'string' && ids.has(parsed.currentProjectId)
    ? parsed.currentProjectId
    : projects[0]!.id
  return { projects, currentProjectId, pendingLocalCad }
}

/** Joins the first few names and counts the rest, so a long list does not fill the dialog. */
const sampleNames = (names: string[]) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` и ещё ${names.length - 3}` : ''}`

/**
 * What the restore dialog tells the user, and why the two shapes of file are not described the
 * same way: a JSON copy really does not carry the geometry, an archive does. Telling an archive
 * "the files are not in the copy" was wrong in both directions — it lost the point of the archive
 * and contradicted the message shown right after the restore.
 *
 * `carriedIds` are the models inside the archive. Positions that need a model the archive does not
 * carry are still called out separately, because those are the ones that will come back as
 * "нет в каталоге".
 */
export const describeBackupRestore = (backup: RestoredWorkspaceBackup, carriedIds: string[]): string => {
  const base = `Копия содержит ${backup.projects.length} ${projectWord(backup.projects.length)}. Текущий список проектов будет заменён; локальная библиотека CAD-моделей останется доступна.`
  const carried = new Set(carriedIds)
  const stillPending = backup.pendingLocalCad.filter((id) => !carried.has(id))
  const lead = carried.size ? ` Архив вернёт ${carried.size} ${modelWord(carried.size)} в локальную библиотеку.` : ''
  if (!stillPending.length) return `${base}${lead}`
  const pending = stillPending.length
  const plural = pending === 1 ? 'позиция опирается' : 'позиций опираются'
  return `${base}${lead} ${pending} ${plural} на локально импортированные CAD-модели (${sampleNames(stillPending)}), файлы которых в копию не входят: они появятся как «нет в каталоге», пока модели не будут импортированы заново.`
}
