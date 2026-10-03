import { allCatalog, CATALOG_REVISION } from '../data/catalog'
import { migrateProject } from './project'
import { APPLICATION_REVISION, CATALOG_REVISION as DOMAIN_CATALOG_REVISION, PROJECT_SCHEMA_VERSION, VALIDATION_REVISION, assertValidProjectSchema, isFutureRevision, isKnownRevision, validateProjectSchema } from './projectSchema'
import type { PanelProject } from './types'

const MAX_PROJECT_FILE_SIZE = 5 * 1024 * 1024
const APPLICATION_NAME = 'Panel36'
const CAD_MODEL_REVISION = '1'
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
/**
 * Short, stable FNV-1a hash of a JSON value. Exported so a file name derived from an identifier
 * can use the same hash everywhere instead of growing a second one.
 */
export const stableHash = (value: unknown) => {
  const source = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export interface ProjectFileEnvelope {
  schema: string
  application: { name: string; revision: string }
  applicationRevision: string
  schemaRevision: number
  catalogRevision: string
  validationRevision: number
  validation: { revision: number }
  exportedAt: string
  catalogSnapshot: unknown[]
  catalogManifest: { revision: string; count: number; productIds: string[]; hash: string }
  catalog: { revision: string; snapshot: unknown[]; manifest: { revision: string; count: number; productIds: string[]; hash: string } }
  cadModelManifest: { revision: string; count: number; modelIds: string[] }
  cad: { revision: string; binaryIncluded: false; modelManifest: { revision: string; count: number; modelIds: string[] } }
  project: PanelProject
}

export const createProjectFileEnvelope = (project: PanelProject, exportedAt = new Date().toISOString()): ProjectFileEnvelope => {
  const catalogSnapshot = allCatalog.map((item) => ({ ...item }))
  const catalogIds = new Set(catalogSnapshot.map((item) => (isRecord(item) ? text(item.id) : '')).filter(Boolean))
  const cadModelIds = [...new Set(project.devices.map((device) => device.productId).filter((id) => !catalogIds.has(id)))]
  const cadModelManifest = { revision: CAD_MODEL_REVISION, count: cadModelIds.length, modelIds: cadModelIds }
  return {
    schema: `panel36.project.v${PROJECT_SCHEMA_VERSION}`,
    application: { name: APPLICATION_NAME, revision: APPLICATION_REVISION },
    applicationRevision: APPLICATION_REVISION,
    schemaRevision: PROJECT_SCHEMA_VERSION,
    catalogRevision: DOMAIN_CATALOG_REVISION,
    validationRevision: VALIDATION_REVISION,
    validation: { revision: VALIDATION_REVISION },
    exportedAt,
    catalogSnapshot,
    catalogManifest: {
      revision: DOMAIN_CATALOG_REVISION,
      count: catalogSnapshot.length,
      productIds: catalogSnapshot.map((item) => (isRecord(item) ? text(item.id) : '')).filter(Boolean),
      hash: stableHash(catalogSnapshot),
    },
    catalog: {
      revision: DOMAIN_CATALOG_REVISION,
      snapshot: catalogSnapshot,
      manifest: {
        revision: DOMAIN_CATALOG_REVISION,
        count: catalogSnapshot.length,
        productIds: catalogSnapshot.map((item) => (isRecord(item) ? text(item.id) : '')).filter(Boolean),
        hash: stableHash(catalogSnapshot),
      },
    },
    cadModelManifest,
    cad: { revision: CAD_MODEL_REVISION, binaryIncluded: false, modelManifest: cadModelManifest },
    project,
  }
}

const validateEnvelope = (value: unknown): string[] => {
  const errors: string[] = []
  if (!isRecord(value)) return ['ожидается объект конверта']
  const schema = text(value.schema)
  const expectedSchema = `panel36.project.v${PROJECT_SCHEMA_VERSION}`
  const schemaVersion = Number(schema.match(/v(\d+)$/)?.[1] ?? Number.NaN)
  if (schema !== expectedSchema && schema !== 'panel36.project.v1') {
    if (Number.isFinite(schemaVersion) && schemaVersion > PROJECT_SCHEMA_VERSION) errors.push(`схема файла версии ${schemaVersion} новее поддерживаемой версии ${PROJECT_SCHEMA_VERSION}`)
    else errors.push(`ожидается schema «${expectedSchema}»`)
  }
  if (!isRecord(value.application) || text(value.application.name) !== APPLICATION_NAME || !isKnownRevision(value.application.revision)) errors.push('отсутствует или неверна ревизия приложения')
  else if (isFutureRevision(value.application.revision, APPLICATION_REVISION)) errors.push(`приложение в файле новее установленного (${text(value.application.revision)} > ${APPLICATION_REVISION})`)
  if (isFutureRevision(value.applicationRevision, APPLICATION_REVISION)) errors.push(`applicationRevision новее установленного (${text(value.applicationRevision)} > ${APPLICATION_REVISION})`)
  if (value.schemaRevision !== (schemaVersion === 1 ? 1 : PROJECT_SCHEMA_VERSION)) errors.push(`ожидается schemaRevision ${schemaVersion === 1 ? 1 : PROJECT_SCHEMA_VERSION}`)
  // A file whose catalogue revision differs from the installed one is refused outright, even when
  // it is older. The envelope carries a `catalogSnapshot`, but import reads only `project` and
  // resolves every product against the catalogue this build ships: a snapshot taken from another
  // revision would be discarded anyway, and positions could then point at products that no longer
  // exist. Refusing keeps the file intact for a build that can still read it. See also
  // `projectBackup.ts`, which compares the same revision only for the "not from the future" side.
  if (isFutureRevision(value.catalogRevision, CATALOG_REVISION)) errors.push(`каталог в файле новее установленного (${text(value.catalogRevision)} > ${CATALOG_REVISION})`)
  else if (!isKnownRevision(value.catalogRevision) || text(value.catalogRevision) !== DOMAIN_CATALOG_REVISION) errors.push('неверна ревизия каталога')
  if (isFutureRevision(value.validationRevision, VALIDATION_REVISION)) errors.push(`validationRevision новее установленного (${String(value.validationRevision)} > ${VALIDATION_REVISION})`)
  if (!isRecord(value.validation)) errors.push('отсутствует вложенная ревизия валидации')
  else if (isFutureRevision(value.validation.revision, VALIDATION_REVISION)) errors.push(`вложенная ревизия валидации новее установленной (${String(value.validation.revision)} > ${VALIDATION_REVISION})`)
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) errors.push('ожидается корректная дата exportedAt')
  if (!isRecord(value.catalog)) errors.push('отсутствует вложенная ревизия каталога')
  else if (isFutureRevision(value.catalog.revision, DOMAIN_CATALOG_REVISION)) errors.push(`вложенная ревизия каталога новее установленной (${String(value.catalog.revision)} > ${DOMAIN_CATALOG_REVISION})`)
  else if (!isKnownRevision(value.catalog.revision) || text(value.catalog.revision) !== DOMAIN_CATALOG_REVISION) errors.push('неверна вложенная ревизия каталога')
  if (isRecord(value.catalog) && JSON.stringify(value.catalog.snapshot) !== JSON.stringify(value.catalogSnapshot)) errors.push('вложенный snapshot каталога не совпадает с catalogSnapshot')
  if (isRecord(value.catalog) && JSON.stringify(value.catalog.manifest) !== JSON.stringify(value.catalogManifest)) errors.push('вложенный manifest каталога не совпадает с catalogManifest')
  if (!Array.isArray(value.catalogSnapshot)) errors.push('отсутствует catalogSnapshot')
  if (!isRecord(value.catalogManifest)) errors.push('отсутствует catalogManifest')
  if (Array.isArray(value.catalogSnapshot) && isRecord(value.catalogManifest)) {
    const ids = value.catalogSnapshot.map((item) => isRecord(item) ? text(item.id) : '').filter(Boolean)
    if (isFutureRevision(value.catalogManifest.revision, DOMAIN_CATALOG_REVISION)) errors.push(`ревизия manifest каталога новее установленной (${String(value.catalogManifest.revision)} > ${DOMAIN_CATALOG_REVISION})`)
    else if (!isKnownRevision(value.catalogManifest.revision) || text(value.catalogManifest.revision) !== DOMAIN_CATALOG_REVISION) errors.push('неверна ревизия manifest каталога')
    if (value.catalogManifest.count !== value.catalogSnapshot.length) errors.push('count каталога не совпадает со snapshot')
    if (JSON.stringify(value.catalogManifest.productIds) !== JSON.stringify(ids)) errors.push('productIds manifest не совпадают со snapshot')
    if (value.catalogManifest.hash !== stableHash(value.catalogSnapshot)) errors.push('hash каталога не совпадает со snapshot')
  }
  if (!isRecord(value.cadModelManifest) || text(value.cadModelManifest.revision) !== CAD_MODEL_REVISION) errors.push('отсутствует или неверна manifest CAD-моделей')
  if (isRecord(value.cadModelManifest) && (!Number.isInteger(value.cadModelManifest.count) || (value.cadModelManifest.count as number) < 0 || !Array.isArray(value.cadModelManifest.modelIds))) errors.push('некорректна manifest CAD-моделей')
  if (!isRecord(value.cad) || text(value.cad.revision) !== CAD_MODEL_REVISION || (value.cad.binaryIncluded !== undefined && value.cad.binaryIncluded !== false) || JSON.stringify(value.cad.modelManifest) !== JSON.stringify(value.cadModelManifest)) errors.push('вложенная manifest CAD-моделей не совпадает с manifest')
  if (!isRecord(value.project)) errors.push('отсутствует project')
  else {
    const result = validateProjectSchema(value.project)
    if (!result.valid) errors.push(...result.errors.slice(0, 8).map((item) => `project.${item}`))
  }
  return errors
}

export const downloadProject = (project: PanelProject) => {
  const envelope = createProjectFileEnvelope(project)
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${project.name.replace(/[^a-zа-яё0-9]+/gi, '-') || 'panel36'}.panel36.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const readProjectFile = async (file: File): Promise<PanelProject> => {
  if (file.size > MAX_PROJECT_FILE_SIZE) throw new Error('Файл проекта больше 5 МБ')

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('Не удалось прочитать JSON проекта')
  }

  if (!isRecord(parsed)) throw new Error('В файле нет корректного проекта')
  const isEnvelope = 'project' in parsed
  if (isEnvelope) {
    // v1 envelopes predate the revision manifest and remain readable, but are
    // migrated and checked before entering the application.
    const strictEnvelope = 'application' in parsed || 'catalogSnapshot' in parsed || 'catalogManifest' in parsed || 'cadModelManifest' in parsed
    if (strictEnvelope) {
      const errors = validateEnvelope(parsed)
      if (errors.length) throw new Error(`Некорректный файл проекта: ${errors.join('; ')}`)
      return text(parsed.schema) === 'panel36.project.v1'
        ? assertValidProjectSchema(migrateProject(parsed.project as Partial<PanelProject>))
        : assertValidProjectSchema(parsed.project)
    }
    if (text(parsed.schema) === `panel36.project.v${PROJECT_SCHEMA_VERSION}` || text(parsed.schema) === 'panel36.project.v1') {
      return assertValidProjectSchema(migrateProject(parsed.project as Partial<PanelProject>))
    }
    throw new Error('Некорректный файл проекта: неизвестный формат конверта')
  }

  // A raw current-schema project is strict; a raw v1/legacy project is migrated.
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion === PROJECT_SCHEMA_VERSION) return assertValidProjectSchema(parsed)
  return assertValidProjectSchema(migrateProject(parsed as Partial<PanelProject>))
}
