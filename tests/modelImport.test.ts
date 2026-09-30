import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { MODEL_MAX_BYTES, MODEL_MAX_UNPACKED_BYTES, detectImportKind, validateGltfZip, validateModelFile } from '../src/storage/modelImport'

const gltfJson = JSON.stringify({
  asset: { version: '2.0' },
  scenes: [{ nodes: [] }],
  scene: 0,
  buffers: [{ uri: 'device.bin', byteLength: 4 }],
})

/** `new Uint8Array(bytes)` copies onto a plain ArrayBuffer, which is what a Blob part accepts. */
const file = (name: string, bytes: Uint8Array) => new File([new Uint8Array(bytes)], name)

const makeGlb = () => {
  const json = new TextEncoder().encode(gltfJson)
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4)
  padded.set(json)
  padded.fill(0x20, json.length)
  const total = 12 + 8 + padded.length
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true)
  view.setUint32(12, padded.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(padded, 20)
  return bytes
}

const findEocd = (view: DataView) => {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  return -1
}

const mutateCentralDirectory = (archive: Uint8Array, mutate: (view: DataView, offset: number) => void) => {
  const copy = archive.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  const eocd = findEocd(view)
  if (eocd < 0) throw new Error('test archive has no EOCD')
  const centralOffset = view.getUint32(eocd + 16, true)
  mutate(view, centralOffset)
  return copy
}

describe('model import validation', () => {
  it('accepts a valid GLB v2 container', async () => {
    const prepared = await validateModelFile(file('device.glb', makeGlb()))
    expect(prepared.metadata.fileType).toBe('glb')
    expect(prepared.mimeType).toBe('model/gltf-binary')
  })

  it('rejects a broken GLB header', async () => {
    await expect(validateModelFile(file('bad.glb', new Uint8Array([1, 2, 3, 4])))).rejects.toThrow('GLB')
  })

  it('accepts standalone glTF only with embedded resources', async () => {
    const embedded = JSON.stringify({
      asset: { version: '2.0' },
      scenes: [{ nodes: [] }],
      scene: 0,
      buffers: [{ byteLength: 4, uri: 'data:application/octet-stream;base64,AAAAAA==' }],
    })
    await expect(validateModelFile(file('device.gltf', new TextEncoder().encode(embedded)))).resolves.toMatchObject({ mimeType: 'model/gltf+json' })
    const external = JSON.stringify({ ...JSON.parse(embedded), buffers: [{ byteLength: 4, uri: 'device.bin' }] })
    await expect(validateModelFile(file('external.gltf', new TextEncoder().encode(external)))).rejects.toThrow('в .zip')
  })

  it('validates ZIP resources referenced by glTF', () => {
    const archive = zipSync({ 'device.gltf': strToU8(gltfJson), 'device.bin': new Uint8Array([0, 0, 0, 0]) })
    expect(() => validateGltfZip(archive.buffer, file('model.zip', archive))).not.toThrow()
    const broken = zipSync({ 'device.gltf': strToU8(gltfJson) })
    expect(() => validateGltfZip(broken.buffer, file('broken.zip', broken))).toThrow('Не найден ресурс')
  })

  it('rejects an oversized uncompressed size from the ZIP directory before extraction', () => {
    const archive = zipSync({ 'device.gltf': strToU8(gltfJson), 'device.bin': new Uint8Array([0, 0, 0, 0]) })
    const oversized = mutateCentralDirectory(archive, (view, offset) => {
      view.setUint32(offset + 24, MODEL_MAX_UNPACKED_BYTES + 1, true)
    })
    expect(() => validateGltfZip(oversized.buffer, file('oversized.zip', oversized))).toThrow('100 МБ')
  })

  it('rejects suspicious ZIP compression ratios before extraction', () => {
    const archive = zipSync({ 'large.bin': new Uint8Array(8 * 1024 * 1024) })
    expect(() => validateGltfZip(archive.buffer, file('compressed.zip', archive))).toThrow('коэффициент сжатия')
  })

  it('enforces extension and 50 MB limit', async () => {
    expect(detectImportKind(file('thing.obj', new Uint8Array(1)))).toBe('invalid')
    const large = new File([new Uint8Array(MODEL_MAX_BYTES + 1)], 'large.glb')
    await expect(validateModelFile(large)).rejects.toThrow('50 МБ')
  })
})
