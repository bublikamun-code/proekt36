<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDefinition } from '../../../domain/types'
import type { DeviceFaceMetrics } from './metrics'
import { closedPolylinePath } from './path'

const props = defineProps<{ product: DeviceDefinition; metrics: DeviceFaceMetrics }>()

const columnWidth = computed(() => props.metrics.widthMm / Math.max(1, props.metrics.columns || props.metrics.moduleWidth))
const seams = computed(() => Array.from({ length: Math.max(0, props.metrics.columns - 1) }, (_, index) => columnWidth.value * (index + 1)))
// An SVG path has to start with a moveto command. Joining the points with " L " produced
// "0.7 2.8 L ..." , which browsers reject outright, so the body outline never drew at all.
const outlinePath = computed(() => closedPolylinePath(props.metrics.outline))
const panel = computed(() => props.metrics.panel)
const panelTopLight = computed(() => `M ${panel.value.x + 0.8} ${panel.value.y + 0.5} H ${panel.value.x + panel.value.width - 0.8}`)
const panelBottomShade = computed(() => `M ${panel.value.x + 0.8} ${panel.value.y + panel.value.height - 0.4} H ${panel.value.x + panel.value.width - 0.8}`)
</script>

<template>
  <g class="dv-chassis">
    <path class="dv-body" :d="outlinePath" />
    <rect v-for="(wall, index) in metrics.sidewalls" :key="`wall-${index}`" class="dv-sidewall" :x="wall.x" :y="wall.y" :width="wall.width" :height="wall.height" />
    <path class="dv-panel" :d="`M ${panel.x} ${panel.y} H ${panel.x + panel.width} V ${panel.y + panel.height} H ${panel.x} Z`" />
    <path class="dv-panel-light" :d="panelTopLight" />
    <path class="dv-panel-shade" :d="panelBottomShade" />
    <path v-for="(seam, index) in seams" :key="`seam-${index}`" class="dv-seam" :d="`M ${seam} ${metrics.body.y + 4.4} V ${metrics.body.y + metrics.body.height - 3.4}`" />
    <rect class="dv-clip" :x="metrics.clip.x" :y="metrics.clip.y" :width="metrics.clip.width" :height="metrics.clip.height" rx="0.6" />
    <rect class="dv-clip-hook" :x="metrics.clipHook.x" :y="metrics.clipHook.y" :width="metrics.clipHook.width" :height="metrics.clipHook.height" rx="0.6" />
    <g v-for="pocket in metrics.pockets" :key="`${pocket.column}-${pocket.y}`" class="dv-pocket-group">
      <rect class="dv-pocket-rim" :x="pocket.x - 0.5" :y="pocket.y - 0.5" :width="pocket.width + 1" :height="pocket.height + 1" rx="1.4" />
      <rect class="dv-pocket" :x="pocket.well.x" :y="pocket.well.y" :width="pocket.well.width" :height="pocket.well.height" rx="0.9" />
      <path class="dv-pocket-depth" :d="`M ${pocket.well.x + 0.5} ${pocket.well.y + 0.5} H ${pocket.well.x + pocket.well.width - 0.5}`" />
      <path class="dv-pocket-floor" :d="`M ${pocket.well.x + 0.5} ${pocket.well.y + pocket.well.height - 0.4} H ${pocket.well.x + pocket.well.width - 0.5}`" />
      <text class="dv-pocket-label" :x="pocket.well.x + pocket.well.width / 2" :y="pocket.well.y + pocket.well.height * 0.32" text-anchor="middle">{{ pocket.y > metrics.heightMm / 2 ? pocket.bottomLabel : pocket.topLabel }}</text>
      <circle class="dv-screw" :cx="pocket.screw.cx" :cy="pocket.screw.cy" :r="pocket.screw.r" />
      <path class="dv-screw-slot" :d="`M ${pocket.screw.cx - pocket.screw.r * 0.78} ${pocket.screw.cy} H ${pocket.screw.cx + pocket.screw.r * 0.78}`" />
    </g>
  </g>
</template>
