<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { getModelAsset } from '../../storage/modelDb'

type PreviewObject = Object3D
type GltfDocument = {
  buffers?: Array<{ uri?: string }>
  images?: Array<{ uri?: string }>
  [key: string]: unknown
}

const GLB_MAGIC = 0x46546c67
const ZIP_MAGIC = 0x04034b50

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

const props = withDefaults(defineProps<{
  url?: string
  assetId?: string
  width?: number
  height?: number
  label?: string
  rotationY?: number
}>(), { width: 42, height: 66, label: 'CAD-модель устройства', rotationY: 0 })

const canvas = ref<HTMLCanvasElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const loadCache = new Map<string, Promise<PreviewObject>>()
let renderer: WebGLRenderer | undefined
let scene: Scene | undefined
let camera: PerspectiveCamera | undefined
let root: Group | undefined
let resizeObserver: ResizeObserver | undefined
let disposed = false
let renderToken = 0

const loadModel = () => {
  const sourceKey = props.assetId ? `asset:${props.assetId}` : `url:${props.url ?? ''}`
  if (!props.assetId && !props.url) return Promise.reject(new Error('Источник CAD-модели не указан'))
  const existing = loadCache.get(sourceKey)
  if (existing) return existing
  const promise = props.assetId
    ? getModelAsset(props.assetId).then((data) => {
      if (!data) throw new Error('Локальный CAD-файл не найден в IndexedDB')
      return parseLocalModel(data)
    })
    : new GLTFLoader().loadAsync(props.url!)
  const modelPromise = promise.then((gltf) => gltf.scene)
  loadCache.set(sourceKey, modelPromise)
  modelPromise.catch(() => loadCache.delete(sourceKey))
  return modelPromise
}

const renderModel = (model: PreviewObject) => {
  if (!renderer || !scene || !camera) return
  root = new Group()
  root.rotation.y = props.rotationY
  root.add(model.clone(true))
  const box = new Box3().setFromObject(root)
  const center = box.getCenter(new Vector3())
  root.position.set(-center.x, -center.y, -center.z)
  const fittedBox = new Box3().setFromObject(root)
  const size = fittedBox.getSize(new Vector3())
  const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.78
  const distance = Math.max(1.1, radius / Math.tan((camera.fov * Math.PI / 180) / 2))
  camera.position.set(0, 0, distance)
  camera.near = Math.max(0.01, distance / 100)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  camera.lookAt(0, 0, 0)
  scene.add(root)
  renderer.render(scene, camera)
}

const render = async () => {
  const element = canvas.value
  if (!element) return
  const token = ++renderToken
  state.value = 'loading'
  errorMessage.value = ''
  if (scene && root) scene.remove(root)
  root = undefined
  try {
    const model = await loadModel()
    if (disposed || token !== renderToken) return
    if (!renderer) {
      renderer = new WebGLRenderer({ canvas: element, antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.outputColorSpace = SRGBColorSpace
      scene = new Scene()
      camera = new PerspectiveCamera(28, 1, 0.01, 100)
      scene.add(new HemisphereLight(0xfff8e8, 0x526159, 2.6))
      const key = new DirectionalLight(0xffffff, 3.2)
      key.position.set(2, 3, 4)
      scene.add(key)
      resizeObserver = new ResizeObserver(() => resize())
      resizeObserver.observe(element)
    }
    renderModel(model)
    resize()
    state.value = 'ready'
  } catch (error) {
    if (!disposed && token === renderToken) {
      errorMessage.value = error instanceof Error ? error.message : 'CAD-модель недоступна'
      state.value = 'error'
    }
  }
}

const resize = () => {
  const element = canvas.value
  if (!element || !renderer || !camera) return
  const width = Math.max(1, props.width)
  const height = Math.max(1, props.height)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (root) renderer.render(scene!, camera)
}

const dispose = () => {
  disposed = true
  resizeObserver?.disconnect()
  resizeObserver = undefined
  renderer?.dispose()
  renderer = undefined
  scene = undefined
  camera = undefined
  root = undefined
}

onMounted(() => { void render() })
watch([() => props.url, () => props.assetId], () => { if (!disposed) void render() })
onBeforeUnmount(dispose)
</script>

<template>
  <div class="model-preview" role="img" :class="`state-${state}`" :style="{ width: `${width}px`, height: `${height}px` }" :data-model-preview="assetId ? `asset:${assetId}` : url" :aria-label="label">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <span v-if="state === 'loading'" class="model-preview-status">загрузка CAD…</span>
    <span v-else-if="state === 'error'" class="model-preview-status error">{{ errorMessage || 'CAD недоступен' }}</span>
  </div>
</template>

<style scoped>
.model-preview {
  position: relative;
  display: inline-block;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(70, 83, 76, .22);
  border-radius: 3px;
  background: linear-gradient(145deg, #eef0e9, #d9ded7);
  box-shadow: inset 0 1px rgba(255, 255, 255, .8);
  vertical-align: middle;
}
.model-preview canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.model-preview-status {
  position: absolute;
  inset: auto 2px 2px;
  color: rgba(40, 54, 47, .68);
  font: 5px/1.2 var(--mono);
  text-align: center;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.model-preview-status.error {
  color: #a04432;
}
</style>
