import { unzipSync, zipSync, strToU8 } from 'fflate'
import { assertSafeZipDirectory, MODEL_MAX_ENTRIES, MODEL_MAX_UNPACKED_BYTES } from '../storage/modelImport'
import { stableHash } from './projectFile'
import { categoryLabels } from '../data/catalog'
import type { Category, ModelMetadata } from './types'

/**
 * A project archive that carries the CAD binaries with it.
 *
 * JSON export has always set `cad.binaryIncluded: false`, and a project that uses a locally
 * imported model therefore came back as a placeholder after a restore — the JSON has no room for
 * a GLB, and the runbook said so. That is a real risk of silent data loss: the user exports
 * "just in case", clears the browser, and the geometry is gone with it.
 *
 * The archive is the same envelope as before, in a ZIP next to the model files, so a file written
 * here is read by any build that reads the JSON, and the JSON is still the document of record.
 * The binaries are validated on the way back in by the same code that guards a manual import, so
 * an archive cannot become a way around that check.
 */

export const PROJECT_ENTRY = 'project.panel36.json'
export const BACKUP_ENTRY = 'backup.panel36.json'
export const CAD_MANIFEST_ENTRY = 'cad/manifest.json'
export const CAD_DIR = 'cad/models/'
const README_ENTRY = 'README.txt'
/** The archive is a transport, not a second storage: past this size it is refused. */
export const ARCHIVE_MAX_BYTES = 200 * 1024 * 1024
const MANIFEST_REVISION = 1

export interface ArchivedModel {
  metadata: ModelMetadata
  data: Uint8Array
}

export interface CadManifestEntry {
  id: string
  fileName: string
  bytes: number
}

export interface CadManifest {
  revision: number
  models: CadManifestEntry[]
}

export const isZipArchive = (data: ArrayBuffer | Uint8Array): boolean => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/**
 * Names a model file after its id, never after the name the user gave it: an id can be relied on
 * to be unique inside a project, while two files called `model.glb` in different folders are not,
 * and a name with a slash in it would write outside the models directory.
 */
/**
 * A file name that cannot lose information. Replacing the characters an id may not contain is not
 * enough on its own: ids `a/b` and `a_b` would both become `a_b.bin`, and the second model would
 * silently overwrite the first — or, on the way back, both entries would read the same file. The
 * hash is appended only when the id actually had to be changed, so ordinary ids keep a readable
 * name and the collision cannot happen.
 */
export const archiveModelPath = (id: string) => {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${CAD_DIR}${safe === id ? id : `${safe}~${stableHash(id)}`}.bin`
}

const readme = (entry: string, count: number) => [
  'Панель 36 — архив проекта с CAD-моделями',
  '',
  `${entry} — проект или резервная копия в том же формате, что и обычный JSON-экспорт.`,
  `cad/manifest.json — список моделей: идентификатор, имя файла и размер.`,
  `cad/models/*.bin — геометрия импортированных моделей (${count} шт.).`,
  '',
  'Импортируйте архив целиком через «Импорт архива»: модель вернётся в локальную библиотеку',
  'и снова станет доступна для 3D-превью. Расчёты, BOM и проверки предварительные и не являются',
  'проектной документацией.',
].join('\n')

export const createCadArchive = (
  json: unknown,
  entry: string,
  models: ArchivedModel[],
  exportedAt = new Date().toISOString(),
): Uint8Array => {
  if (entry !== PROJECT_ENTRY && entry !== BACKUP_ENTRY) throw new Error(`Неизвестная запись архива: ${entry}`)
  if (models.length > MODEL_MAX_ENTRIES) throw new Error(`Слишком много моделей для архива: ${models.length}`)

  const entries: Record<string, Uint8Array> = {
    [entry]: strToU8(JSON.stringify(json, null, 2)),
    [CAD_MANIFEST_ENTRY]: strToU8(JSON.stringify({
      revision: MANIFEST_REVISION,
      application: 'Panel36',
      exportedAt,
      // The full metadata travels with the bytes: a model that comes back as a bare file would
      // land in the library with a name nobody chose and a price of zero, which is exactly the
      // kind of quiet downgrade the archive exists to prevent.
      models: models.map((model) => ({ ...model.metadata, bytes: model.data.byteLength })),
    }, null, 2)),
    [README_ENTRY]: strToU8(readme(entry, models.length)),
  }
  const total = models.reduce((sum, model) => sum + model.data.byteLength, 0)
  if (total > MODEL_MAX_UNPACKED_BYTES) throw new Error('Модели не помещаются в архив: больше 100 МБ')
  for (const model of models) entries[archiveModelPath(model.metadata.id)] = model.data

  const archive = zipSync(entries, { level: 6 })
  if (archive.byteLength > ARCHIVE_MAX_BYTES) throw new Error('Архив больше 200 МБ')
  return archive
}

/** The readers take a `File`, so an archive's JSON entry is handed over under its own name. */
export const jsonFileFor = (entry: string, json: unknown) =>
  new File([JSON.stringify(json)], entry, { type: 'application/json' })

export interface ReadCadArchive {
  /** Parsed contents of the project or backup entry. */
  json: unknown
  entry: string
  models: ArchivedModel[]
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * Reads the archive back. The project or backup JSON is returned as parsed text and handed to the
 * reader that already exists for it, so a file cannot be accepted here and rejected there; the
 * models are returned as raw bytes for the same reason — they go through the import path.
 */
export const readCadArchive = (data: ArrayBuffer): ReadCadArchive => {
  if (!isZipArchive(data)) throw new Error('Это не ZIP-архив')
  // The directory is checked before anything is unpacked. A 123 KB archive can expand to 120 MB,
  // and `unzipSync` would spend the memory and a second of the user's time before the size check
  // in the lines below got to run.
  assertSafeZipDirectory(data)
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(data))
  } catch {
    throw new Error('Не удалось открыть архив')
  }
  const names = Object.keys(entries)
  if (names.some((name) => name.includes('..') || name.startsWith('/'))) throw new Error('Недопустимый путь в архиве')
  if (names.length > MODEL_MAX_ENTRIES + 3) throw new Error('Слишком много файлов в архиве')
  const unpacked = names.reduce((sum, name) => sum + entries[name]!.byteLength, 0)
  if (unpacked > MODEL_MAX_UNPACKED_BYTES) throw new Error('Распакованный архив больше 100 МБ')

  const entry = names.includes(PROJECT_ENTRY) ? PROJECT_ENTRY : names.includes(BACKUP_ENTRY) ? BACKUP_ENTRY : ''
  if (!entry) throw new Error('В архиве нет ни проекта, ни резервной копии')

  const manifestBytes = entries[CAD_MANIFEST_ENTRY]
  if (!manifestBytes) throw new Error('В архиве нет списка моделей')
  let manifest: unknown
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
  } catch {
    throw new Error('Повреждён список моделей архива')
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.models) || manifest.revision !== MANIFEST_REVISION) {
    throw new Error('Список моделей архива имеет неизвестный формат')
  }
  const categories = Object.keys(categoryLabels) as Category[]

  const models: ArchivedModel[] = []
  for (const value of manifest.models as CadManifestEntry[]) {
    if (!isRecord(value)) throw new Error('Некорректная запись в списке моделей')
    const id = text(value.id)
    const fileName = text(value.fileName)
    if (!id || !fileName) throw new Error('Модель в архиве без идентификатора или имени')
    const bytes = entries[archiveModelPath(id)]
    if (!bytes) throw new Error(`В архиве нет данных модели «${fileName}»`)
    const metadata: ModelMetadata = {
      id,
      name: text(value.name) || fileName.replace(/\.(glb|gltf|bin)$/i, ''),
      brand: text(value.brand),
      sku: text(value.sku),
      // An unknown category is not carried through as an arbitrary string: it would end up in the
      // catalogue and in the BOM as text no filter can match.
      category: (categories.includes(value.category as Category) ? value.category : 'MCB') as Category,
      moduleWidth: Number(value.moduleWidth) || 1,
      rows: Number(value.rows) || 1,
      height: Number(value.height) || 82,
      depth: Number(value.depth) || 70,
      poles: Number(value.poles) || 1,
      ratedCurrent: Number(value.ratedCurrent) || 0,
      voltage: value.voltage === 230 ? 230 : 400,
      bus: value.bus === 'N' || value.bus === 'PE' ? value.bus : 'L',
      price: Number(value.price) || 0,
      weight: Number(value.weight) || 0,
      fileName,
      // The bytes are carried as a single file, whatever the model originally was.
      fileType: value.fileType === 'gltf' ? 'gltf' : 'glb',
      createdAt: text(value.createdAt) || new Date().toISOString(),
    }
    models.push({ metadata, data: bytes })
  }

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(entries[entry]!))
  } catch {
    throw new Error('Не удалось прочитать проект из архива')
  }
  return { json, entry, models }
}

/** Ready for `putModelAsset`, which takes an `ArrayBuffer`. */
export const modelBytes = (model: ArchivedModel) => toArrayBuffer(model.data)

export const archiveBlob = (archive: Uint8Array) => new Blob([toArrayBuffer(archive)], { type: 'application/zip' })

export const downloadArchive = (archive: Uint8Array, fileName: string) => {
  const url = URL.createObjectURL(archiveBlob(archive))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const safeFileName = (name: string, extension: string) =>
  `${name.replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'panel36'}${extension}`

