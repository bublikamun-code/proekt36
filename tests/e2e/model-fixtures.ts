import { strToU8, zipSync } from 'fflate'

/** Reusable glTF/GLB/ZIP builders shared by model import and library specs. */

const positions = new Float32Array([
  -0.6, -0.5, 0,
  0.6, -0.5, 0,
  0, 0.6, 0,
])
const textureCoordinates = new Float32Array([
  0, 0,
  1, 0,
  0.5, 1,
])

const geometry = () => {
  const result = new Uint8Array(positions.byteLength + textureCoordinates.byteLength)
  result.set(new Uint8Array(positions.buffer), 0)
  result.set(new Uint8Array(textureCoordinates.buffer), positions.byteLength)
  return result
}

const dataUri = (bytes: Uint8Array, type: string) =>
  `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

const pixelPng = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

const gltf = (bufferUri: string, imageUri: string) => ({
  asset: { version: '2.0', generator: 'Panel36 import test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
  materials: [{
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0.2,
      roughnessFactor: 0.65,
    },
    doubleSided: true,
  }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987 }],
  images: [{ uri: imageUri }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.6, -0.5, 0], max: [0.6, 0.6, 0] },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
    { buffer: 0, byteOffset: positions.byteLength, byteLength: textureCoordinates.byteLength, target: 34962 },
  ],
  buffers: [{ uri: bufferUri, byteLength: geometry().byteLength }],
})

const pad = (bytes: Uint8Array, fill: number) => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
  padded.set(bytes)
  padded.fill(fill, bytes.length)
  return padded
}

export const glb = () => {
  const binary = pad(geometry(), 0)
  const json = pad(new TextEncoder().encode(JSON.stringify(gltf(
    dataUri(geometry(), 'application/octet-stream'),
    dataUri(pixelPng, 'image/png'),
  ))), 0x20)
  const total = 12 + 8 + json.length + 8 + binary.length
  const result = new Uint8Array(total)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, json.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  result.set(json, 20)
  view.setUint32(20 + json.length, binary.length, true)
  view.setUint32(24 + json.length, 0x004e4942, true)
  result.set(binary, 28 + json.length)
  return result
}

export const standaloneGltf = () => new TextEncoder().encode(JSON.stringify(gltf(
  dataUri(geometry(), 'application/octet-stream'),
  dataUri(pixelPng, 'image/png'),
)))

export const zipModel = () => zipSync({
  'assets/device.gltf': strToU8(JSON.stringify(gltf('geometry/device.bin', 'textures/pixel.png'))),
  'assets/geometry/device.bin': geometry(),
  'assets/textures/pixel.png': pixelPng,
})

