import { unzipSync } from 'fflate'
import { Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getModelAsset } from '../../storage/modelDb'

/**
 * Shared cache of parsed CAD previews, deliberately outside the component.
 *
 * `loadCache` used to live in `<script setup>`, which makes one Map per preview instance: scrolling
 * the catalogue re-read the same file from IndexedDB and built a second WebGL scene for a model that
 * was already on screen, and every one of those scenes kept its geometry for as long as the page
 * lived. Hoisting the Map to module scope makes the total GPU footprint a function of how many
 * distinct models exist rather than of how many times they were displayed.
 *
 * Entries are not evicted on purpose. Each preview draws `model.clone(true)`, and a clone shares
 * the geometry and materials of the cached original — disposing an evicted entry would blank the
 * previews that are still using it. The cache is page-scoped instead: a reload or a navigation drops
 * it together with its GPU resources, which is the safe trade against cross-talk between previews.
 */

const GLB_MAGIC = 0x46546c67
const ZIP_MAGIC = 0x04034b50

type GltfDocument = {
  buffers?: Array<{ uri?: string }>
  images?: Array<{ uri?: string }>
  [key: string]: unknown
}

const cache = new Map<string, Promise<Object3D>>()

const isGlb = (data: ArrayBuffer) => data.byteLength >= 4 && new DataView(data).getUint32(0, true) === GLB_MAGIC
const isZip = (data: ArrayBuffer) => data.byteLength >= 4 && new DataView(data).getUint32(0, true) === ZIP_MAGIC

const resourceMimeType = (name: string) => {
  const extension = name.toLowerCase().split('.').pop()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'ktx2') return 'image/ktx2'
  return 'application/octet-stream'
}

const parseZippedGltf = async (data: ArrayBuffer, loader: GLTFLoader) => {
  const entries = unzipSync(new Uint8Array(data))
  const gltfName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.gltf'))
  if (!gltfName) throw new Error('В локальном CAD-архиве нет glTF-сцены')

  const document = JSON.parse(new TextDecoder().decode(entries[gltfName]!)) as GltfDocument
  const basePath = gltfName.includes('/') ? gltfName.slice(0, gltfName.lastIndexOf('/') + 1) : ''
  const objectUrls: string[] = []
  const resolveResource = (uri: string | undefined) => {
    if (!uri || uri.startsWith('data:')) return uri
    const decoded = decodeURIComponent(uri.split(/[?#]/)[0]!)
    const resourceName = `${basePath}${decoded}`
    const bytes = entries[resourceName]
    if (!bytes) throw new Error(`Не найден ресурс локальной CAD-модели: ${decoded}`)
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: resourceMimeType(resourceName) }))
    objectUrls.push(objectUrl)
    return objectUrl
  }

  const rewritten: GltfDocument = {
    ...document,
    buffers: document.buffers?.map((resource) => ({ ...resource, uri: resolveResource(resource.uri) })),
    images: document.images?.map((resource) => ({ ...resource, uri: resolveResource(resource.uri) })),
  }
  try {
    return await loader.parseAsync(JSON.stringify(rewritten), '')
  } finally {
    objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
  }
}

const parseLocalModel = async (data: ArrayBuffer) => {
  const loader = new GLTFLoader()
  if (isGlb(data)) return loader.parseAsync(data, '')
  if (isZip(data)) return parseZippedGltf(data, loader)
  return loader.parseAsync(new TextDecoder().decode(data), '')
}

/**
 * Resolves a preview to a parsed scene. A failed load is dropped from the cache so a later attempt
 * can try again instead of replaying the same rejection forever.
 */
export const loadPreviewModel = (source: { assetId?: string; url?: string }): Promise<Object3D> => {
  const { assetId, url } = source
  if (!assetId && !url) return Promise.reject(new Error('Источник CAD-модели не указан'))
  const key = assetId ? `asset:${assetId}` : `url:${url}`
  const cached = cache.get(key)
  if (cached) return cached
  const promise = (assetId
    ? getModelAsset(assetId).then((data) => {
      if (!data) throw new Error('Локальный CAD-файл не найден в IndexedDB')
      return parseLocalModel(data)
    })
    : new GLTFLoader().loadAsync(url!)).then((gltf) => gltf.scene)
  cache.set(key, promise)
  promise.catch(() => cache.delete(key))
  return promise
}