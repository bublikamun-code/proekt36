import { unzipSync } from 'fflate'
import type { PreparedModel } from '../domain/types'

export type { PreparedModel } from '../domain/types'

export const MODEL_MAX_BYTES = 50 * 1024 * 1024
export const MODEL_MAX_ENTRIES = 256
export const MODEL_MAX_UNPACKED_BYTES = 100 * 1024 * 1024
const MODEL_MAX_COMPRESSION_RATIO = 1000
const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50

const textEncoder = new TextEncoder()

export async function validateModelFile(file: File): Promise<PreparedModel> {
  if (file.size === 0) throw new Error('Файл пуст')
  if (file.size > MODEL_MAX_BYTES) throw new Error('Файл больше 50 МБ')
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'glb' && extension !== 'gltf') throw new Error('Поддерживаются только .glb и .gltf/.zip')
  const raw = await file.arrayBuffer()
  if (extension === 'glb') return validateGlb(raw, file)
  if (file.name.toLowerCase().endsWith('.zip')) throw new Error('Переименуйте .gltf-архив в .zip и загрузите архив')
  return validateGltfJson(raw, file)
}

async function validateGlb(data: ArrayBuffer, file: File): Promise<PreparedModel> {
  const view = new DataView(data)
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('Некорректный заголовок GLB v2')
  if (view.getUint32(8, true) !== view.byteLength) throw new Error('Повреждён GLB: неверная длина')
  let offset = 12
  let json: Record<string, unknown> | undefined
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (length > view.byteLength - start) throw new Error('Повреждён GLB: секция за границами файла')
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, start, length)).replace(/\0+$/g, '')) as Record<string, unknown>
    offset = start + length
    if (offset % 4 && offset < view.byteLength) offset += 4 - (offset % 4)
  }
  assertScene(json)
  return { metadata: baseMetadata(file, 'glb'), data, mimeType: 'model/gltf-binary', fileName: file.name }
}

async function validateGltfJson(data: ArrayBuffer, file: File): Promise<PreparedModel> {
  const json = parseGltf(data)
  assertScene(json)
  const resources = [
    ...(Array.isArray(json.buffers) ? json.buffers : []),
    ...(Array.isArray(json.images) ? json.images : []),
  ]
  const external = resources
    .map((resource) => resource && typeof resource === 'object' && 'uri' in resource ? (resource as { uri?: string }).uri : undefined)
    .find((uri) => uri && !uri.startsWith('data:'))
  if (external) throw new Error('glTF использует внешние ресурсы. Упакуйте .gltf, .bin и текстуры в .zip')
  return { metadata: baseMetadata(file, 'gltf'), data, mimeType: 'model/gltf+json', fileName: file.name }
}

/**
 * Checks the archive's central directory before anything is unpacked: entry count, total
 * uncompressed size, and the compression ratio. Exported because the project archive unpacks a ZIP
 * too, and unpacking first is how a 123 KB file turns into 120 MB of memory before the size check
 * gets a chance to run.
 */
export const assertSafeZipDirectory = (data: ArrayBuffer) => {
  const view = new DataView(data)
  const eocd = findEocd(view)
  if (eocd < 0) throw new Error('Не удалось открыть ZIP-архив')

  const entries = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64-архивы не поддерживаются')
  }
  if (entries > MODEL_MAX_ENTRIES) throw new Error('В архиве слишком много файлов')
  const centralEnd = centralOffset + centralSize
  if (centralEnd > data.byteLength || centralOffset < 0) throw new Error('Повреждён ZIP: неверный каталог архива')

  let offset = centralOffset
  let unpacked = 0
  let count = 0
  while (offset < centralEnd) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('Повреждён ZIP: неверная запись каталога')
    }
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength
    if (recordEnd > centralEnd) throw new Error('Повреждён ZIP: запись каталога обрезана')

    if (uncompressedSize > MODEL_MAX_UNPACKED_BYTES - unpacked) {
      throw new Error('Распакованный архив больше 100 МБ')
    }
    if (uncompressedSize > 1024 * 1024 && (compressedSize === 0 || uncompressedSize / compressedSize > MODEL_MAX_COMPRESSION_RATIO)) {
      throw new Error('Слишком высокий коэффициент сжатия архива')
    }
    unpacked += uncompressedSize
    offset = recordEnd
    count += 1
  }
  if (count !== entries || offset !== centralEnd) throw new Error('Повреждён ZIP: неполный каталог архива')
}

const findEocd = (view: DataView) => {
  const start = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset
  }
  return -1
}

export function validateGltfZip(data: ArrayBuffer, file: File): PreparedModel {
  if (file.size > MODEL_MAX_BYTES) throw new Error('Файл больше 50 МБ')
  assertSafeZipDirectory(data)
  let entries: Record<string, Uint8Array>
  try { entries = unzipSync(new Uint8Array(data)) } catch { throw new Error('Не удалось открыть ZIP-архив') }
  const names = Object.keys(entries)
  if (names.length > MODEL_MAX_ENTRIES) throw new Error('В архиве слишком много файлов')
  if (names.some((name) => name.includes('..') || name.startsWith('/'))) throw new Error('Недопустимый путь в архиве')
  const unpacked = names.reduce((sum, name) => sum + entries[name]!.byteLength, 0)
  if (unpacked > MODEL_MAX_UNPACKED_BYTES) throw new Error('Распакованный архив больше 100 МБ')
  const gltfName = names.find((name) => name.toLowerCase().endsWith('.gltf'))
  if (!gltfName) throw new Error('В ZIP нет файла .gltf')
  const gltfBytes = entries[gltfName]!
  const gltfBuffer = new ArrayBuffer(gltfBytes.byteLength)
  new Uint8Array(gltfBuffer).set(gltfBytes)
  const json = parseGltf(gltfBuffer)
  assertScene(json)
  const basePath = gltfName.includes('/') ? gltfName.slice(0, gltfName.lastIndexOf('/') + 1) : ''
  const buffers = (json.buffers ?? []) as Array<{ uri?: string }>
  const images = (json.images ?? []) as Array<{ uri?: string }>
  for (const resource of [...buffers, ...images]) {
    if (!resource.uri) continue
    if (resource.uri.startsWith('data:')) continue
    const decoded = decodeURIComponent(resource.uri.split(/[?#]/)[0]!)
    if (decoded.split('/').includes('..')) throw new Error('Недопустимый путь к ресурсу glTF')
    if (!names.includes(basePath + decoded)) throw new Error(`Не найден ресурс архива: ${decoded}`)
  }
  return { metadata: baseMetadata(file, 'gltf'), data, mimeType: 'application/zip', fileName: file.name }
}

const parseGltf = (data: ArrayBuffer) => {
  try { return JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown> } catch { throw new Error('Некорректный JSON glTF') }
}

const assertScene = (json?: Record<string, unknown>) => {
  if (!json) throw new Error('В glTF нет JSON-сцены')
  const version = json.asset && typeof json.asset === 'object' ? (json.asset as { version?: string }).version : undefined
  if (!version?.startsWith('2.')) throw new Error('Поддерживается только glTF 2.x')
  if (!Array.isArray(json.scenes) || json.scenes.length === 0) throw new Error('В модели не найдена сцена')
}

const baseMetadata = (file: File, fileType: 'glb' | 'gltf') => ({
  name: file.name.replace(/\.(glb|gltf|zip)$/i, ''), brand: '', sku: '', category: 'MCB' as const,
  moduleWidth: 1, rows: 1, height: 82, depth: 70, poles: 1, ratedCurrent: 16,
  voltage: 230 as const, bus: 'L' as const, price: 0, weight: 0, fileName: file.name, fileType,
})

export function detectImportKind(file: File) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) return 'zip'
  if (name.endsWith('.glb')) return 'glb'
  if (name.endsWith('.gltf')) return 'gltf'
  return 'invalid'
}

export const utf8Size = (value: string) => textEncoder.encode(value).byteLength
