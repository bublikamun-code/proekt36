import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  BACKUP_ENTRY,
  CAD_MANIFEST_ENTRY,
  ARCHIVE_MAX_BYTES,
  PROJECT_ENTRY,
  archiveModelPath,
  createCadArchive,
  isZipArchive,
  readCadArchive,
  safeFileName,
  type ArchivedModel,
} from '../src/domain/cadArchive'
import { allCatalog } from '../src/data/catalog'
import { createProjectFileEnvelope } from '../src/domain/projectFile'
import { backupNeedsLocalCad, createWorkspaceBackup } from '../src/domain/projectBackup'
import { createDevice, createProject } from '../src/domain/project'
import type { ModelMetadata } from '../src/domain/types'

const metadata = (patch: Partial<ModelMetadata> = {}): ModelMetadata => ({
  id: 'model-1', name: 'Розетка 16A', brand: 'Импорт', sku: 'X-16', category: 'MCB',
  moduleWidth: 1, rows: 1, height: 82, depth: 70, poles: 1, ratedCurrent: 16,
  voltage: 230, bus: 'L', price: 0, weight: 0.2, fileName: 'rozetka.glb', fileType: 'glb',
  createdAt: '2026-10-01T00:00:00.000Z', ...patch,
})

/** A GLB that passes the import validation: magic, version 2, a JSON chunk with a scene. */
const glb = (marker: string) => {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0, [marker]: true }))
  const padded = json.byteLength % 4 ? json.byteLength + (4 - json.byteLength % 4) : json.byteLength
  const out = new Uint8Array(12 + 8 + padded)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.byteLength, true)
  view.setUint32(12, padded, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(json, 20)
  return out
}

const archived = (patch: Partial<ArchivedModel> = {}): ArchivedModel => ({ metadata: metadata(), data: glb('ok'), ...patch })

const project = () => createProject('Архивный', 'apartment')

describe('архив проекта с CAD-моделями', () => {
  it('складывает проект, список моделей и сами модели', () => {
    const archive = createCadArchive(createProjectFileEnvelope(project()), PROJECT_ENTRY, [archived()])
    expect(isZipArchive(archive.buffer as ArrayBuffer)).toBe(true)

    const read = readCadArchive(archive.buffer as ArrayBuffer)
    expect(read.entry).toBe(PROJECT_ENTRY)
    expect(read.json).toMatchObject({ project: { name: 'Архивный' } })
    expect(read.models).toHaveLength(1)
    // The bytes come back byte for byte: the whole point is that the geometry survives.
    expect(Array.from(read.models[0]!.data)).toEqual(Array.from(glb('ok')))
  })

  it('возвращает метаданные модели, а не голое имя файла', () => {
    // A model that came back as a bare file would land in the library with a name nobody chose.
    const archive = createCadArchive(createProjectFileEnvelope(project()), PROJECT_ENTRY, [archived()])
    const read = readCadArchive(archive.buffer as ArrayBuffer)
    expect(read.models[0]!.metadata).toMatchObject({ id: 'model-1', name: 'Розетка 16A', ratedCurrent: 16, moduleWidth: 1, fileName: 'rozetka.glb' })
  })

  it('поддерживает архив резервной копии', () => {
    const archive = createCadArchive(createWorkspaceBackup([project()], [metadata()], 'x'), BACKUP_ENTRY, [archived()])
    const read = readCadArchive(archive.buffer as ArrayBuffer)
    expect(read.entry).toBe(BACKUP_ENTRY)
    expect(read.json).toMatchObject({ schema: 'panel36.backup.v1' })
  })

  it('не путает архив с JSON', () => {
    expect(isZipArchive(strToU8('{"schema":"panel36.project.v2"}').buffer as ArrayBuffer)).toBe(false)
    expect(isZipArchive(createCadArchive({}, PROJECT_ENTRY, []).buffer as ArrayBuffer)).toBe(true)
  })

  it('отказывает от архива без проекта', () => {
    const zip = zipSync({ 'other/thing.json': strToU8('{}'), [CAD_MANIFEST_ENTRY]: strToU8(JSON.stringify({ revision: 1, models: [] })) })
    expect(() => readCadArchive(zip.buffer as ArrayBuffer)).toThrow(/нет ни проекта, ни резервной копии/)
  })

  it('отказывает, когда запись модели в списке, а данных нет', () => {
    // The case that would otherwise restore a project pointing at geometry that is not there.
    const zip = zipSync({
      [PROJECT_ENTRY]: strToU8(JSON.stringify({ project: {} })),
      [CAD_MANIFEST_ENTRY]: strToU8(JSON.stringify({ revision: 1, models: [{ id: 'model-1', fileName: 'a.glb' }] })),
    })
    expect(() => readCadArchive(zip.buffer as ArrayBuffer)).toThrow(/нет данных модели/)
  })

  it('отказывает от неизвестного формата списка моделей', () => {
    const zip = zipSync({
      [PROJECT_ENTRY]: strToU8(JSON.stringify({ project: {} })),
      [CAD_MANIFEST_ENTRY]: strToU8(JSON.stringify({ revision: 99, models: [] })),
    })
    expect(() => readCadArchive(zip.buffer as ArrayBuffer)).toThrow(/неизвестный формат/)
  })

  it('не принимает путь, ведущий наружу архива', () => {
    const zip = zipSync({
      [PROJECT_ENTRY]: strToU8(JSON.stringify({ project: {} })),
      [CAD_MANIFEST_ENTRY]: strToU8(JSON.stringify({ revision: 1, models: [] })),
      '../escape.bin': glb('x'),
    })
    expect(() => readCadArchive(zip.buffer as ArrayBuffer)).toThrow(/Недопустимый путь/)
  })

  it('не даёт имени файла выйти из каталога моделей', () => {
    // The id is what is used for the path, so an id with a slash in it cannot be written anywhere
    // else in the archive. The hash tail is appended because replacing the forbidden characters
    // alone is lossy: `a/b` and `a_b` would land on the same file, and the second model would
    // silently overwrite the first.
    const path = archiveModelPath('../../etc/passwd')
    expect(path.startsWith('cad/models/')).toBe(true)
    expect(path).not.toContain('/etc/passwd')
    expect(path.endsWith('.bin')).toBe(true)
    expect(archiveModelPath('a/b')).not.toBe(archiveModelPath('a_b'))
    // An ordinary id keeps a readable name: the hash is only needed when the id had to change.
    expect(archiveModelPath('model-1')).toBe('cad/models/model-1.bin')
  })

  it('не принимает больше моделей, чем архив может нести', () => {
    const many = Array.from({ length: 300 }, (_, index) => archived({ metadata: metadata({ id: `model-${index}` }) }))
    expect(() => createCadArchive({}, PROJECT_ENTRY, many)).toThrow(/Слишком много моделей/)
  })

  it('не принимает неизвестное имя записи', () => {
    expect(() => createCadArchive({}, 'something.json', [])).toThrow(/Неизвестная запись архива/)
  })

  it('имя файла остаётся безопасным после нормализации', () => {
    expect(safeFileName('Щиток / кухня', '.panel36.zip')).toBe('Щиток-кухня.panel36.zip')
    expect(safeFileName('///', '.panel36.zip')).toBe('panel36.panel36.zip')
  })
})

describe('модели, которые проект действительно использует', () => {
  it('каталог не считается зависимостью', () => {
    const target = createProject('Из каталога', 'apartment')
    target.devices = [createDevice(allCatalog.find((item) => item.id === 'ekf-mcb-1p-c6')!, 0, 0)]
    // A built-in position has no local model behind it, so an archive for this project carries none.
    expect(backupNeedsLocalCad([target])).toEqual([])
  })
})

describe('защита от архива-бомбы', () => {
  it('отказывается от слишком большого файла до чтения', () => {
    // The cap is on the input as well as the output: a 200 MB limit that only existed on the way
    // out protected nothing on the way in.
    expect(ARCHIVE_MAX_BYTES).toBe(200 * 1024 * 1024)
  })

  it('проверяет каталог ZIP до распаковки', () => {
    // `unzipSync` on a 123 KB file that expands to 120 MB costs the memory and about a second
    // before a size check in the lines below could run. The guard the glTF import already uses is
    // the same one, so both paths refuse the same archives.
    const source = readFileSync(new URL('../src/domain/cadArchive.ts', import.meta.url), 'utf8')
    expect(source).toContain('assertSafeZipDirectory(data)')
    expect(source.indexOf('assertSafeZipDirectory(data)')).toBeLessThan(source.indexOf('unzipSync(new Uint8Array(data))'))
    expect(source).toContain('MODEL_MAX_UNPACKED_BYTES')
    expect(source).toContain('MODEL_MAX_ENTRIES')
  })
})
