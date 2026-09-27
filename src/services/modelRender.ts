import { unzipSync } from 'fflate'
import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ModelAsset } from '../domain/types'
import { getModelAsset, putModelAsset } from '../storage/modelDb'

type GltfDocument = {
  buffers?: Array<{ uri?: string }>
  images?: Array<{ uri?: string }>
  [key: string]: unknown
}

const GLB_MAGIC = 0x46546c67
const ZIP_MAGIC = 0x04034b50
const THUMB_WIDTH = 120
const THUMB_HEIGHT = 180

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

const sourceKey = (asset: ModelAsset) => (asset.source === 'local' ? `asset:${asset.id}` : `url:${asset.url ?? ''}`)

/**
 * Parsing a GLB is the expensive step, and the same model can be requested by a board, a
 * catalogue list and the inspector at once. The cache is module-level on purpose: sharing it
 * per component instance made every preview re-download and re-parse the same bytes.
 */
const modelCache = new Map<string, Promise<Object3D>>()

export const loadModelObject = (asset: ModelAsset): Promise<Object3D> => {
  const key = sourceKey(asset)
  const existing = modelCache.get(key)
  if (existing) return existing
  const promise = (asset.source === 'local'
    ? getModelAsset(asset.id).then((record) => {
      if (!record) throw new Error('Локальный CAD-файл не найден в IndexedDB')
      return parseLocalModel(record.data)
    })
    : new GLTFLoader().loadAsync(asset.url!))
    .then((gltf) => gltf.scene)
  modelCache.set(key, promise)
  promise.catch(() => modelCache.delete(key))
  return promise
}

/** Bounding-box size in metres, before the asset transform is applied. */
export const measureModel = async (asset: ModelAsset): Promise<{ width: number; height: number; depth: number }> => {
  const model = await loadModelObject(asset)
  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  return { width: size.x, height: size.y, depth: size.z }
}

let thumbnailRenderer: WebGLRenderer | undefined
let thumbnailScene: Scene | undefined
let thumbnailCamera: PerspectiveCamera | undefined

/**
 * One offscreen renderer serves every thumbnail in the app; boards and catalogue lists must
 * not spawn a WebGL context per device, because browsers allow only a dozen or so per page.
 */
const ensureThumbnailStage = () => {
  if (thumbnailRenderer) return
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = THUMB_HEIGHT
  thumbnailRenderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  thumbnailRenderer.setPixelRatio(1)
  thumbnailRenderer.outputColorSpace = SRGBColorSpace
  thumbnailRenderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false)
  thumbnailScene = new Scene()
  thumbnailCamera = new PerspectiveCamera(28, THUMB_WIDTH / THUMB_HEIGHT, 0.01, 100)
  thumbnailScene.add(new HemisphereLight(0xfff8e8, 0x526159, 2.6))
  const key = new DirectionalLight(0xffffff, 3.2)
  key.position.set(2, 3, 4)
  thumbnailScene.add(key)
}

const thumbnailCache = new Map<string, Promise<string | null>>()

const renderThumbnail = async (asset: ModelAsset): Promise<string | null> => {
  const model = await loadModelObject(asset)
  ensureThumbnailStage()
  const stage = new Group()
  stage.rotation.y = asset.transform.rotationY
  stage.scale.setScalar(asset.transform.scale)
  stage.add(model.clone(true))
  const box = new Box3().setFromObject(stage)
  const center = box.getCenter(new Vector3())
  stage.position.set(-center.x, -center.y, -center.z)
  const fitted = new Box3().setFromObject(stage)
  const size = fitted.getSize(new Vector3())
  const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.78
  const distance = Math.max(1.1, radius / Math.tan((thumbnailCamera!.fov * Math.PI / 180) / 2))
  thumbnailCamera!.position.set(0, 0, distance)
  thumbnailCamera!.near = Math.max(0.01, distance / 100)
  thumbnailCamera!.far = distance * 100
  thumbnailCamera!.updateProjectionMatrix()
  thumbnailCamera!.lookAt(0, 0, 0)
  thumbnailScene!.add(stage)
  thumbnailRenderer!.render(thumbnailScene!, thumbnailCamera!)
  const dataUrl = thumbnailRenderer!.domElement.toDataURL('image/png')
  thumbnailScene!.remove(stage)
  return dataUrl
}

/** Persists a freshly rendered thumbnail next to the binary so later sessions skip WebGL. */
const persistThumbnail = async (asset: ModelAsset, dataUrl: string) => {
  if (asset.source !== 'local') return
  try {
    const record = await getModelAsset(asset.id)
    if (record && !record.thumbnail) await putModelAsset(asset.id, { data: record.data, thumbnail: dataUrl })
  } catch {
    // A missing thumbnail only costs one render per session; failing to save it must not fail the UI.
  }
}

/**
 * Resolves a raster preview for the asset: memory cache, then the thumbnail stored alongside
 * the binary, then one offscreen render. Returns null when the model cannot be loaded, so the
 * caller falls back to the procedural face instead of an error placeholder.
 */
export const getThumbnail = (asset: ModelAsset): Promise<string | null> => {
  const cached = thumbnailCache.get(asset.id)
  if (cached) return cached
  const promise = (async () => {
    if (asset.thumbnailDataUrl) return asset.thumbnailDataUrl
    try {
      const dataUrl = await renderThumbnail(asset)
      if (dataUrl) void persistThumbnail(asset, dataUrl)
      return dataUrl
    } catch {
      return null
    }
  })()
  thumbnailCache.set(asset.id, promise)
  return promise
}
