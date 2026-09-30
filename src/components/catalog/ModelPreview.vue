<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { loadPreviewModel } from './modelCache'

type PreviewObject = Object3D

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
let renderer: WebGLRenderer | undefined
let scene: Scene | undefined
let camera: PerspectiveCamera | undefined
let root: Group | undefined
let resizeObserver: ResizeObserver | undefined
let disposed = false
let renderToken = 0

const loadModel = () => loadPreviewModel({ assetId: props.assetId, url: props.url })

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

/**
 * Frees this preview's own WebGL context and observer. The parsed scene it drew is owned by
 * `modelCache` and shared with every other preview of the same model, so it is deliberately not
 * disposed here — see the note in that module.
 */
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
