import { allCatalog, CATALOG_REVISION } from '../data/catalog'
import { migrateProject } from './project'
import { APPLICATION_REVISION, CATALOG_REVISION as DOMAIN_CATALOG_REVISION, PROJECT_SCHEMA_VERSION, VALIDATION_REVISION, assertValidProjectSchema, isFutureRevision, isKnownRevision, validateProjectSchema } from './projectSchema'
import type { PanelProject } from './types'

const MAX_PROJECT_FILE_SIZE = 5 * 1024 * 1024
const APPLICATION_NAME = 'Panel36'
const CAD_MODEL_REVISION = '1'
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const stableHash = (value: unknown) => {
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
  /** The single copy of the catalogue snapshot; legacy files also carry flat fields. */
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

const expectedEnvelopeSchema = () => `panel36.project.v${PROJECT_SCHEMA_VERSION}`

const validateEnvelope = (value: unknown): string[] => {
  const errors: string[] = []
  if (!isRecord(value)) return ['ожидается объект конверта']
  const schema = text(value.schema)
  const expectedSchema = `panel36.project.v${PROJECT_SCHEMA_VERSION}`
  const schemaVersion = Number(schema.match(/v(\d+)$/)?.[1] ?? Number.NaN)
  // v1 and v2 envelopes stay readable: both are migrated on import instead of being rejected.
  const legacySchema = schema === 'panel36.project.v1' || schema === 'panel36.project.v2'
  if (schema !== expectedSchema && !legacySchema) {
    if (Number.isFinite(schemaVersion) && schemaVersion > PROJECT_SCHEMA_VERSION) errors.push(`схема файла версии ${schemaVersion} новее поддерживаемой версии ${PROJECT_SCHEMA_VERSION}`)
    else errors.push(`ожидается schema «${expectedSchema}»`)
  }
  if (!isRecord(value.application) || text(value.application.name) !== APPLICATION_NAME || !isKnownRevision(value.application.revision)) errors.push('отсутствует или неверна ревизия приложения')
  else if (isFutureRevision(value.application.revision, APPLICATION_REVISION)) errors.push(`приложение в файле новее установленного (${text(value.application.revision)} > ${APPLICATION_REVISION})`)
  // The flat copy is optional: files written before it existed carry the revision only inside
  // `application`, so only a value that is present and wrong is worth reporting.
  if (value.applicationRevision !== undefined) {
    if (!isKnownRevision(value.applicationRevision)) errors.push('неверна applicationRevision')
    else if (isFutureRevision(value.applicationRevision, APPLICATION_REVISION)) errors.push(`applicationRevision новее установленного (${text(value.applicationRevision)} > ${APPLICATION_REVISION})`)
  }
  if (value.schemaRevision !== (legacySchema ? schemaVersion : PROJECT_SCHEMA_VERSION)) errors.push(`ожидается schemaRevision ${legacySchema ? schemaVersion : PROJECT_SCHEMA_VERSION}`)
  // A file written against an older catalogue is still readable; a newer or unreadable
  // revision is not. Comparing for plain equality would retire every export on each release.
  // Readability is asked before recency: `isFutureRevision` calls anything it cannot parse
  // «newer», so checking it first would file a mangled revision under a version comparison it
  // never took part in and leave the honest «неверна ревизия» unreachable.
  if (!isKnownRevision(value.catalogRevision)) errors.push('неверна ревизия каталога')
  else if (isFutureRevision(value.catalogRevision, CATALOG_REVISION)) errors.push(`каталог в файле новее установленного (${text(value.catalogRevision)} > ${CATALOG_REVISION})`)
  if (!isKnownRevision(value.validationRevision)) errors.push('неверна revision проверок')
  else if (isFutureRevision(value.validationRevision, VALIDATION_REVISION)) errors.push(`validationRevision новее установленного (${String(value.validationRevision)} > ${VALIDATION_REVISION})`)
  if (!isRecord(value.validation)) errors.push('отсутствует вложенная ревизия валидации')
  else if (!isKnownRevision(value.validation.revision)) errors.push('неверна вложенная ревизия валидации')
  else if (isFutureRevision(value.validation.revision, VALIDATION_REVISION)) errors.push(`вложенная ревизия валидации новее установленной (${String(value.validation.revision)} > ${VALIDATION_REVISION})`)
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) errors.push('ожидается корректная дата exportedAt')
  // New files carry the snapshot only inside `catalog`; older ones also had flat top-level
  // copies. Either shape reads, and when both are present they have to agree.
  const nested = isRecord(value.catalog) ? value.catalog : undefined
  const snapshot = nested && Array.isArray(nested.snapshot) ? nested.snapshot : value.catalogSnapshot
  const manifest = nested && isRecord(nested.manifest) ? nested.manifest : value.catalogManifest
  if (nested) {
    if (!isKnownRevision(nested.revision)) errors.push('неверна вложенная ревизия каталога')
    else if (isFutureRevision(nested.revision, DOMAIN_CATALOG_REVISION)) errors.push(`вложенная ревизия каталога новее установленной (${String(nested.revision)} > ${DOMAIN_CATALOG_REVISION})`)
    if (Array.isArray(value.catalogSnapshot) && JSON.stringify(nested.snapshot) !== JSON.stringify(value.catalogSnapshot)) errors.push('вложенный snapshot каталога не совпадает с catalogSnapshot')
    if (isRecord(value.catalogManifest) && JSON.stringify(nested.manifest) !== JSON.stringify(value.catalogManifest)) errors.push('вложенный manifest каталога не совпадает с catalogManifest')
  }
  if (!Array.isArray(snapshot)) errors.push('отсутствует catalogSnapshot')
  else if (!isRecord(manifest)) errors.push('отсутствует catalogManifest')
  else {
    const ids = snapshot.map((item) => isRecord(item) ? text(item.id) : '').filter(Boolean)
    if (!isKnownRevision(manifest.revision)) errors.push('неверна ревизия manifest каталога')
    else if (isFutureRevision(manifest.revision, DOMAIN_CATALOG_REVISION)) errors.push(`ревизия manifest каталога новее установленной (${String(manifest.revision)} > ${DOMAIN_CATALOG_REVISION})`)
    if (manifest.count !== snapshot.length) errors.push('count каталога не совпадает со snapshot')
    if (JSON.stringify(manifest.productIds) !== JSON.stringify(ids)) errors.push('productIds manifest не совпадают со snapshot')
    if (manifest.hash !== stableHash(snapshot)) errors.push('hash каталога не совпадает со snapshot')
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
    // v1 and v2 envelopes predate the current project shape and remain readable, but are
    // migrated and checked before entering the application.
    const strictEnvelope = 'application' in parsed || 'catalogSnapshot' in parsed || 'catalogManifest' in parsed || 'cadModelManifest' in parsed
    const envelopeSchema = text(parsed.schema)
    const legacyEnvelope = envelopeSchema === 'panel36.project.v1' || envelopeSchema === 'panel36.project.v2'
    if (strictEnvelope) {
      const errors = validateEnvelope(parsed)
      if (errors.length) throw new Error(`Некорректный файл проекта: ${errors.join('; ')}`)
      return legacyEnvelope
        ? assertValidProjectSchema(migrateProject(parsed.project as Partial<PanelProject>))
        : assertValidProjectSchema(parsed.project)
    }
    if (envelopeSchema === expectedEnvelopeSchema() || legacyEnvelope) {
      return assertValidProjectSchema(migrateProject(parsed.project as Partial<PanelProject>))
    }
    throw new Error('Некорректный файл проекта: неизвестный формат конверта')
  }

  // A raw current-schema project is strict; a raw v1/legacy project is migrated.
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion === PROJECT_SCHEMA_VERSION) return assertValidProjectSchema(parsed)
  return assertValidProjectSchema(migrateProject(parsed as Partial<PanelProject>))
}
