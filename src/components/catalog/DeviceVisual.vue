<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DeviceDefinition, ModelAsset } from '../../domain/types'
import { getThumbnail } from '../../services/modelRender'
import DeviceChassis from './deviceFace/DeviceChassis.vue'
import DeviceFace from './deviceFace/DeviceFace.vue'
import { getDeviceFaceMetrics, faceShellFamily } from './deviceFace/metrics'

const props = defineProps<{ product: DeviceDefinition; model?: ModelAsset | null; width?: number; height?: number }>()

const face = computed(() => getDeviceFaceMetrics(props.product))
const isBusbar = computed(() => props.product.category === 'busbar')
const busbarLabel = computed(() => (props.product.series === 'FORK' ? 'FORK' : 'BUS'))
const busbarTicks = computed(() => Array.from({ length: Math.max(1, face.value.moduleWidth) }, (_, index) => face.value.body.x + 1.2 + (index * (face.value.body.width - 2.4)) / face.value.moduleWidth))
const pxWidth = computed(() => Math.max(14, props.width ?? face.value.widthMm))
const pxHeight = computed(() => Math.max(20, props.height ?? face.value.heightMm))

// The raster preview arrives asynchronously; until it does (or forever, when the CAD file
// is gone) the procedural face stays on screen, so a list never shows error placeholders.
const thumbUrl = ref<string | null>(null)
watch(() => props.model, (asset) => {
  thumbUrl.value = null
  if (asset) void getThumbnail(asset).then((url) => { thumbUrl.value = url })
}, { immediate: true })
</script>

<template>
  <span
    v-if="model && thumbUrl"
    class="model-thumb"
    :data-model-preview="model.source === 'local' ? `asset:${model.id}` : model.url"
    :style="{ width: `${pxWidth}px`, height: `${pxHeight}px` }"
    role="img"
    :aria-label="`Реальная модель: ${product.name}`"
  ><img :src="thumbUrl" alt="" draggable="false" /></span>
  <svg
    v-else
    class="device-visual"
    :class="[`category-${product.category}`, `family-${faceShellFamily(product)}`]"
    :viewBox="`0 0 ${face.widthMm} ${face.heightMm}`"
    :style="{ width: `${pxWidth}px`, height: `${pxHeight}px` }"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :aria-label="`Схематичное изображение: ${product.name}`"
  >
    <g v-if="isBusbar" class="dv-busbar">
      <rect class="dv-body" :x="face.body.x" :y="face.body.y" :width="face.body.width" :height="face.body.height" rx="1.4" />
      <rect class="dv-busbar-bar" :x="face.body.x + 1.2" :y="face.body.y + face.body.height * 0.28" :width="face.body.width - 2.4" :height="face.body.height * 0.44" rx="0.8" />
      <path class="dv-busbar-tick" :d="busbarTicks.map((x) => `M ${x} ${face.body.y + face.body.height * 0.3} V ${face.body.y + face.body.height * 0.7}`).join(' ')" />
      <text v-if="face.detail !== 'minimal'" class="dv-label" :x="face.widthMm / 2" :y="face.body.y + face.body.height * 0.88" font-size="2.4" font-weight="700" text-anchor="middle">{{ busbarLabel }}</text>
    </g>
    <template v-else>
      <DeviceChassis :product="product" :metrics="face" />
      <DeviceFace :product="product" :metrics="face" />
    </template>
  </svg>
</template>

<style scoped>
.model-thumb {
  display: inline-block;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(70, 83, 76, .22);
  border-radius: 3px;
  background: linear-gradient(145deg, #eef0e9, #d9ded7);
  box-shadow: inset 0 1px rgba(255, 255, 255, .8);
}

.model-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
