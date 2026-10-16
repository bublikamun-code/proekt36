import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { getModelAsset, putModelAsset } from '../src/storage/modelDb'
import { getThumbnail, invalidateModelCaches, loadModelObject, measureModel, measureModelBytes } from '../src/services/modelRender'
import type { ModelAsset } from '../src/domain/types'
import { createFakeIndexedDB, installBrowserEnv, resetFakeIndexedDB } from './support/browser-env'
import type { BrowserEnv } from './support/browser-env'

let env: BrowserEnv | null = null

// three's loading manager builds a ProgressEvent for every item it tracks, and a node process has
// none. Without it a parse that would succeed in the browser dies on a missing global.
class ProgressEventStub {
  readonly type: string
  readonly lengthComputable: boolean
  readonly loaded: number
  readonly total: number
  constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
    this.type = type
    this.lengthComputable = init.lengthComputable ?? false
    this.loaded = init.loaded ?? 0
    this.total = init.total ?? 0
  }
}
if (typeof globalThis.ProgressEvent === 'undefined') {
  Object.defineProperty(globalThis, 'ProgressEvent', { value: ProgressEventStub, configurable: true, writable: true })
}

afterEach(() => {
  env?.restore()
  env = null
  resetFakeIndexedDB()
})

/** Eight corners of a box, the smallest mesh a glTF can carry and still be a real scene. */
const BOX_CORNERS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]

const boxBuffer = (scale = 1) => {
  const floats = new Float32Array(BOX_CORNERS.map((value) => value * scale))
  return Buffer.from(floats.buffer)
}

/** A glTF 2.0 document for a 1 × 2 × 3 box, with its geometry inlined as a data URI. */
const boxGltf = (bufferName?: string) => ({
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 3] }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 96 }],
  buffers: [bufferName ? { byteLength: 96, uri: bufferName } : { byteLength: 96, uri: `data:application/octet-stream;base64,${boxBuffer().toString('base64')}` }],
})

const encode = (text: string) => new TextEncoder().encode(text)

const asArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(data.byteLength)
  new Uint8Array(copy).set(data)
  return copy
}

/** A GLB container: magic, version, total length, then a padded JSON chunk. */
const boxGlb = () => {
  const json = encode(JSON.stringify(boxGltf()))
  const jsonPad = (4 - (json.byteLength % 4)) % 4
  const total = 12 + 8 + json.byteLength + jsonPad
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, json.byteLength + jsonPad, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  // The JSON chunk is padded with spaces to a 4-byte boundary, or the loader reads past the
  // declaration into NUL bytes and the document stops being JSON.
  for (let index = 0; index < jsonPad; index += 1) bytes[20 + json.byteLength + index] = 0x20
  return bytes
}

const localAsset = (id: string, extra: Partial<ModelAsset> = {}): ModelAsset => ({
  id,
  name: id,
  source: 'local',
  format: 'glb',
  transform: { rotationY: 0, scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0 },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

const useModelDb = () => {
  env = installBrowserEnv()
  Object.defineProperty(globalThis, 'indexedDB', { value: createFakeIndexedDB(), configurable: true, writable: true })
}

describe('измерение импортированной модели', () => {
  it('измеряет габарит по вершинам, а не по имени файла', async () => {
    const size = await measureModelBytes(asArrayBuffer(encode(JSON.stringify(boxGltf()))))

    expect(size.width).toBeCloseTo(1, 5)
    expect(size.height).toBeCloseTo(2, 5)
    expect(size.depth).toBeCloseTo(3, 5)
  })

  it('читает GLB-контейнер так же, как открытый glTF', async () => {
    const size = await measureModelBytes(asArrayBuffer(boxGlb()))

    expect(size.height).toBeCloseTo(2, 5)
  })

  it('подставляет буфер из zip-архива рядом со сценой', async () => {
    const archive = zipSync({
      'model/scene.gltf': encode(JSON.stringify(boxGltf('geometry.bin'))),
      'model/geometry.bin': boxBuffer(),
    })

    const size = await measureModelBytes(asArrayBuffer(archive))

    expect(size.depth).toBeCloseTo(3, 5)
  })

  it('не принимает короткий файл за контейнер по первым четырём байтам', async () => {
    // Fewer than four bytes cannot carry a magic number, so the file has to be read as text and
    // rejected there — reading past the end would either throw a range error or invent a size.
    await expect(measureModelBytes(asArrayBuffer(encode('glT')))).rejects.toThrow()
  })

  it('объясняет, чего не хватает в архиве', async () => {
    const withoutScene = zipSync({ 'model/readme.txt': encode('no scene here') })
    const danglingReference = zipSync({ 'model/scene.gltf': encode(JSON.stringify(boxGltf('missing.bin'))) })

    await expect(measureModelBytes(asArrayBuffer(withoutScene))).rejects.toThrow('нет glTF-сцены')
    await expect(measureModelBytes(asArrayBuffer(danglingReference))).rejects.toThrow('Не найден ресурс')
  })
})

describe('кэш моделей', () => {
  it('разбирает локальный файл один раз на всех, кто его просит', async () => {
    useModelDb()
    const asset = localAsset('cache-1')
    await putModelAsset(asset.id, { data: asArrayBuffer(boxGlb()) })

    const first = loadModelObject(asset)
    const second = loadModelObject(asset)

    // Same promise, not merely an equally-shaped result: the second caller must not re-parse.
    expect(second).toBe(first)
    expect((await first).isObject3D).toBe(true)
  })

  it('не держит неудачу: следующий запрос после ошибки разбирает файл заново', async () => {
    useModelDb()
    const asset = localAsset('cache-2')

    await expect(loadModelObject(asset)).rejects.toThrow('не найден в IndexedDB')
    await putModelAsset(asset.id, { data: asArrayBuffer(boxGlb()) })

    const model = await loadModelObject(asset)
    expect(model.isObject3D).toBe(true)
  })

  it('забывает модель, которую переимпортировали', async () => {
    useModelDb()
    const asset = localAsset('cache-3')
    await putModelAsset(asset.id, { data: asArrayBuffer(boxGlb()) })
    const first = await loadModelObject(asset)

    invalidateModelCaches(asset.id)
    await putModelAsset(asset.id, { data: asArrayBuffer(boxGlb()) })
    const second = await loadModelObject(asset)

    expect(second).not.toBe(first)
    expect(second.isObject3D).toBe(true)
  })

  it('измеряет сохранённую модель через тот же кэш', async () => {
    useModelDb()
    const asset = localAsset('cache-4')
    await putModelAsset(asset.id, { data: asArrayBuffer(boxGlb()) })

    const size = await measureModel(asset)

    expect(size.width).toBeCloseTo(1, 5)
    expect(size.height).toBeCloseTo(2, 5)
  })
})

describe('миниатюры', () => {
  it('отдаёт сохранённую картинку, не поднимая WebGL', async () => {
    useModelDb()
    const asset = localAsset('thumb-1', { thumbnailDataUrl: 'data:image/png;base64,AAAA' })

    await expect(getThumbnail(asset)).resolves.toBe('data:image/png;base64,AAAA')
    // There is no WebGL context in a node process, so a render attempt would throw rather than
    // quietly return a blank frame.
    await expect(loadModelAssetIsUntouched(asset)).resolves.toBe(true)
  })

  it('показывает поле процедурной отрисовки, а не ошибку, когда модель не читается', async () => {
    useModelDb()
    const asset = localAsset('thumb-2')

    await expect(getThumbnail(asset)).resolves.toBeNull()
  })

  it('запоминает неудачу на время сеанса, чтобы не перерисовывать её для каждой ячейки', async () => {
    useModelDb()
    const asset = localAsset('thumb-3')

    const first = getThumbnail(asset)
    const second = getThumbnail(asset)

    expect(second).toBe(first)
    await expect(first).resolves.toBeNull()
  })

  it('рисует заново после переимпорта модели', async () => {
    useModelDb()
    const asset = localAsset('thumb-4')
    const first = getThumbnail(asset)
    await first

    invalidateModelCaches(asset.id)

    expect(getThumbnail(asset)).not.toBe(first)
  })
})

/** True while the asset has never been rendered — the stored-thumbnail path must not touch it. */
const loadModelAssetIsUntouched = async (asset: ModelAsset) => {
  const record = await getModelAsset(asset.id)
  return !record?.thumbnail
}
