<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDefinition } from '../../../domain/types'
import { faceLabels, faceSocketGrid, type DeviceFaceMetrics } from '../../../domain/faceMetrics'
import { closedPolylinePath, polylinePath } from './path'

const props = defineProps<{ product: DeviceDefinition; metrics: DeviceFaceMetrics }>()

const category = computed(() => props.product.category)
const isProtection = computed(() => ['MCB', 'RCCB', 'RCBO'].includes(category.value))
const isResidual = computed(() => category.value === 'RCCB' || category.value === 'RCBO')
const isNgu = computed(() => props.product.series === 'NGU')
const labels = computed(() => faceLabels(props.product, props.metrics))

const serviceWindow = computed(() => ({
  x: props.metrics.body.x + 1.8,
  y: props.metrics.heightMm * 0.16,
  width: props.metrics.body.width - 3.6,
  height: props.metrics.heightMm * 0.3,
}))
const testButton = computed(() => ({
  x: props.metrics.widthMm - 6.8,
  y: props.metrics.heightMm * 0.42,
  width: 4.6,
  height: 3.6,
}))
const led = computed(() => ({ cx: props.metrics.body.x + 3.2, cy: props.metrics.heightMm * 0.74, r: 0.9 }))
const statusDots = computed(() => Array.from({ length: Math.max(2, Math.min(props.metrics.columns, 4)) }, (_, index) => ({
  cx: props.metrics.body.x + 2.6 + index * 2.4,
  cy: serviceWindow.value.y + serviceWindow.value.height - 2.4,
  r: 0.8,
})))
// The screws come from the domain now, so the wire tool and the drawing read one fact. Same
// numbers as before this moved — the picture did not change.
const sockets = computed(() => faceSocketGrid(props.product, props.metrics))
/** An SVG path must open with a moveto command; without it the browser drops the path entirely. */
const points = polylinePath
const leverPath = (toggle: typeof props.metrics.toggles[number]) => closedPolylinePath(toggle.points)
</script>

<template>
  <g class="dv-face">
    <g v-if="isProtection || category === 'SPD'" class="dv-levers">
      <g v-for="toggle in metrics.toggles" :key="`toggle-${toggle.column}`">
        <path class="dv-toggle-seat" :d="`M ${toggle.seat.x + 1.2} ${toggle.seat.y} H ${toggle.seat.x + toggle.seat.width - 1.2} L ${toggle.seat.x + toggle.seat.width} ${toggle.seat.y + 1.2} V ${toggle.seat.y + toggle.seat.height - 1.2} L ${toggle.seat.x + toggle.seat.width - 1.2} ${toggle.seat.y + toggle.seat.height} H ${toggle.seat.x + 1.2} L ${toggle.seat.x} ${toggle.seat.y + toggle.seat.height - 1.2} V ${toggle.seat.y + 1.2} Z`" />
        <path class="dv-toggle" :d="leverPath(toggle)" />
        <path v-for="(grip, index) in toggle.grips" :key="`grip-${index}`" class="dv-toggle-grip" :d="points(grip)" />
        <path class="dv-toggle-shine" :d="points(toggle.shine)" />
        <path class="dv-toggle-foot" :d="`M ${toggle.x + 0.6} ${toggle.y + toggle.height - 0.5} H ${toggle.x + toggle.width - 0.6}`" />
        <text v-if="!toggle.shared" class="dv-state-mark" :x="toggle.x + toggle.width / 2" :y="toggle.y - 1.3" text-anchor="middle">I</text>
        <text v-if="!toggle.shared" class="dv-state-mark" :x="toggle.x + toggle.width / 2" :y="toggle.y + toggle.height + 2.6" text-anchor="middle">O</text>
      </g>
    </g>

    <g v-if="isResidual" class="dv-test">
      <rect class="dv-test-button" :x="testButton.x" :y="testButton.y" :width="testButton.width" :height="testButton.height" rx="0.9" />
      <text class="dv-test-label" :x="testButton.x + testButton.width / 2" :y="testButton.y + testButton.height * 0.78" text-anchor="middle">T</text>
      <text v-if="metrics.detail === 'full'" class="dv-caption" :x="testButton.x + testButton.width / 2" :y="testButton.y - 1.2" text-anchor="middle">Test</text>
    </g>

    <g v-if="category === 'SPD'" class="dv-status">
      <rect class="dv-window dv-window-spd" :x="serviceWindow.x" :y="serviceWindow.y" :width="serviceWindow.width" :height="serviceWindow.height" rx="0.8" />
      <rect class="dv-status-bar" :x="serviceWindow.x + 1" :y="serviceWindow.y + 1.2" :width="serviceWindow.width - 2" height="2.2" rx="0.6" />
      <circle v-for="dot in statusDots" :key="`dot-${dot.cx}`" class="dv-status-dot" :cx="dot.cx" :cy="dot.cy" :r="dot.r" />
      <text v-if="metrics.detail !== 'minimal'" class="dv-caption" :x="metrics.widthMm / 2" :y="serviceWindow.y + serviceWindow.height * 0.62" text-anchor="middle">Uc {{ product.voltage }}V</text>
    </g>

    <g v-else-if="category === 'relay'" class="dv-relay">
      <rect class="dv-window" :x="serviceWindow.x" :y="serviceWindow.y" :width="serviceWindow.width" :height="serviceWindow.height" rx="0.8" />
      <path class="dv-symbol" :d="`M ${serviceWindow.x + 1.8} ${serviceWindow.y + serviceWindow.height - 2.4} h ${serviceWindow.width * 0.34} l -1.6 -${serviceWindow.height * 0.32} l 2.4 -${serviceWindow.height * 0.3}`" />
      <path class="dv-symbol" :d="`M ${serviceWindow.x + serviceWindow.width - 1.8} ${serviceWindow.y + 2.4} h -${serviceWindow.width * 0.34} l 1.6 ${serviceWindow.height * 0.32} l -2.4 ${serviceWindow.height * 0.3}`" />
      <circle class="dv-led" :cx="led.cx" :cy="led.cy" :r="led.r" />
    </g>

    <g v-else-if="category === 'PSU'" class="dv-psu">
      <rect class="dv-window" :x="serviceWindow.x" :y="serviceWindow.y" :width="serviceWindow.width" :height="serviceWindow.height" rx="0.8" />
      <path class="dv-symbol" :d="`M ${serviceWindow.x + 2} ${serviceWindow.y + serviceWindow.height * 0.66} h 2 l 1.4 -${serviceWindow.height * 0.3} l 1.8 ${serviceWindow.height * 0.56} l 1.4 -${serviceWindow.height * 0.26} h 2`" />
      <text v-if="metrics.detail !== 'minimal'" class="dv-caption" :x="metrics.widthMm / 2" :y="serviceWindow.y + 2.4" text-anchor="middle">24V DC</text>
      <circle class="dv-led" :cx="led.cx" :cy="led.cy" :r="led.r" />
    </g>

    <g v-else-if="category === 'meter'" class="dv-meter">
      <rect class="dv-window dv-window-meter" :x="serviceWindow.x" :y="serviceWindow.y" :width="serviceWindow.width" :height="serviceWindow.height" rx="0.8" />
      <text v-if="metrics.detail !== 'minimal'" class="dv-display" :x="metrics.widthMm / 2" :y="serviceWindow.y + serviceWindow.height * 0.68" text-anchor="middle">220.4</text>
      <rect class="dv-meter-key" :x="serviceWindow.x + 1.4" :y="serviceWindow.y + serviceWindow.height + 1.8" width="3.4" height="1.6" rx="0.5" />
      <rect class="dv-meter-key" :x="serviceWindow.x + 5.4" :y="serviceWindow.y + serviceWindow.height + 1.8" width="3.4" height="1.6" rx="0.5" />
    </g>

    <g v-if="category === 'terminals'" class="dv-terminals">
      <rect v-if="isNgu" class="dv-insulator" :x="metrics.body.x + 2" :y="metrics.heightMm * 0.16" :width="metrics.body.width - 4" :height="metrics.heightMm * 0.62" rx="1.6" />
      <g v-for="(socket, index) in sockets" :key="`socket-${index}`">
        <circle class="dv-socket" :cx="socket.cx" :cy="socket.cy" :r="socket.r" />
        <path class="dv-screw-slot" :d="`M ${socket.cx - socket.r * 0.7} ${socket.cy} H ${socket.cx + socket.r * 0.7}`" />
      </g>
      <text v-if="!isNgu && metrics.detail !== 'minimal'" class="dv-caption" :x="metrics.widthMm / 2" :y="metrics.heightMm * 0.88" text-anchor="middle">PE</text>
    </g>

    <g class="dv-marking">
      <text
        v-for="(label, index) in labels"
        :key="`label-${index}`"
        class="dv-label"
        :class="{ 'dv-label-muted': label.muted }"
        :x="label.x"
        :y="label.y"
        :font-size="label.size"
        :font-weight="label.weight"
        :text-anchor="label.anchor"
        :transform="label.vertical ? `rotate(-90 ${label.x} ${label.y})` : undefined"
      >{{ label.text }}</text>
    </g>
  </g>
</template>
