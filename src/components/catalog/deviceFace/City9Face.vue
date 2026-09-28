<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDefinition } from '../../../domain/types'
import { faceDetailFor, fitFaceText } from './metrics'

/**
 * Face of the City9 modular breaker, drawn 1:1 from the manufacturer's 2D front drawing
 * (City9 MCB 1P/2P). All constants are millimetres measured off that drawing, so the
 * board shows the device the way it actually looks: top terminal mouth with the nose
 * walls, centre rib, dome-topped paddle with the notched grip bar, bottom screw zone.
 */
const props = defineProps<{ product: DeviceDefinition }>()

const MODULE_MM = 17.7

const poles = computed(() => Math.max(1, Math.round(props.product.poles || props.product.moduleWidth || 1)))
const widthMm = computed(() => poles.value * MODULE_MM)
const detail = computed(() => faceDetailFor(widthMm.value))

/** Pole-local coordinates from the drawing; the template translates each pole into place. */
const pole = computed(() => ({
  // top terminal mouth
  mouth: { wallX0: 3.0, wallX1: 14.5, wallY: 2.0, slotX0: 5.0, slotX1: 12.5, ledgeY: 2.2, stepY: 3.0, chamferY: 3.5, chamferX0: 1.9, chamferX1: 15.8, faceTopY: 4.0 },
  screwTop: 12.3,
  seamTop: 22.0,
  rib: { x: 8.85, w: 0.4, segs: [[3.5, 8.8], [15.7, 21.9], [41.7, 45.4], [67.0, 73.3], [80.2, 85.5]] },
  lever: {
    shoulderY: 26.5, shoulderX0: 4.3, shoulderX1: 13.4,
    recessTopY: 27.5, recessBottomY: 41.7, recessX0: 3.9, recessX1: 13.8,
    barY: 31.7, notchY: 30.7, barL: 5.2, notchL: 7.8, notchR: 9.9, barR: 12.6,
    flareY: 31.2, waistX0: 4.9, waistX1: 12.8, waistY: 27.3,
    innerY: 33.6, innerY0: 29.6, innerX0: 5.2, innerX1: 12.6,
    ledgeY: 43.1, ledgeX0: 4.8, ledgeX1: 12.8,
  },
  seamBottom: 67.0,
  screwBottom: 76.9,
  bottom: { edgeY: 85.0, chamferY: 85.5, chamferX0: 1.9, chamferX1: 15.8 },
}))

const handlePath = computed(() => {
  const m = pole.value.lever
  const cx = MODULE_MM / 2
  return [
    `M ${m.waistX0} ${m.waistY - 1.1}`,
    `Q ${cx - 2.1} 24.35 ${cx} 24.45`,
    `Q ${cx + 2.1} 24.35 ${m.waistX1} ${m.waistY - 1.2}`,
    `L ${m.waistX1} ${m.waistY}`,
    `L ${m.shoulderX1 + 0.2} ${m.flareY}`,
    `L ${m.barR} ${m.barY}`,
    `L ${m.notchR} ${m.barY}`,
    `L ${m.notchR} ${m.notchY}`,
    `L ${m.notchL} ${m.notchY}`,
    `L ${m.notchL} ${m.barY}`,
    `L ${m.barL} ${m.barY}`,
    `L ${m.shoulderX0 - 0.2} ${m.flareY}`,
    `L ${m.waistX0} ${m.waistY}`,
    'Z',
  ].join(' ')
})

const recessPath = computed(() => {
  const m = pole.value.lever
  const cx = MODULE_MM / 2
  return [
    `M ${m.shoulderX0} ${m.shoulderY}`,
    `Q ${cx - 2.35} 24.0 ${cx} 24.2`,
    `Q ${cx + 2.35} 24.0 ${m.shoulderX1} ${m.shoulderY}`,
    `L ${m.recessX1} 29.0`,
    `V ${m.recessBottomY}`,
    `H ${m.recessX0}`,
    'V 29.0',
    'Z',
  ].join(' ')
})

const labels = computed(() => {
  const brand = (props.product.brand || '').replace('· тестовый образец', '').trim()
  const series = (props.product.series || '').replace('CITY9-', '').trim()
  const rating = props.product.ratedCurrent > 0 ? `${props.product.tripCurve || ''}${props.product.ratedCurrent}`.trim() : ''
  const items: Array<{ text: string; x: number; y: number; size: number; weight: 400 | 600 | 700; anchor: 'start' | 'middle'; muted?: boolean }> = []
  const cx = MODULE_MM / 2
  if (detail.value !== 'minimal' && brand) items.push({ text: fitFaceText(brand, 14.5, 2.2), x: 1.7, y: 49.8, size: 2.2, weight: 600, anchor: 'start' })
  if (detail.value !== 'minimal' && series) items.push({ text: series, x: 1.7, y: 53.2, size: 2.8, weight: 700, anchor: 'start' })
  if (rating) items.push({ text: fitFaceText(rating, 13, 6), x: cx, y: 61.5, size: 6, weight: 700, anchor: 'middle' })
  if (detail.value === 'full') items.push({ text: `~${props.product.voltage}V`, x: cx, y: 65.6, size: 2.2, weight: 400, anchor: 'middle', muted: true })
  return items
})

const seams = computed(() => Array.from({ length: poles.value - 1 }, (_, index) => (index + 1) * MODULE_MM))
const poleIndexes = computed(() => Array.from({ length: poles.value }, (_, index) => index))
</script>

<template>
  <g class="c9-face">
    <g v-for="index in poleIndexes" :key="`pole-${index}`" :transform="`translate(${index * MODULE_MM} 0)`">
      <!-- shell with the drawing's corner chamfers -->
      <path class="c9-shell" :d="`M 0 ${pole.mouth.faceTopY} L ${pole.mouth.chamferX0} ${pole.mouth.chamferY} H ${pole.mouth.chamferX1} L ${MODULE_MM} ${pole.mouth.faceTopY} V ${pole.bottom.edgeY} L ${pole.mouth.chamferX1} ${pole.bottom.chamferY} H ${pole.mouth.chamferX0} L 0 ${pole.bottom.edgeY} Z`" />

      <!-- top terminal mouth: recessed walls, deep slot, ledge steps -->
      <rect class="c9-mouth-recess" :x="pole.mouth.wallX0" :y="pole.mouth.wallY" :width="pole.mouth.wallX1 - pole.mouth.wallX0" :height="pole.mouth.chamferY - pole.mouth.wallY" />
      <rect class="c9-mouth-slot" :x="pole.mouth.slotX0" y="0" :width="pole.mouth.slotX1 - pole.mouth.slotX0" :height="pole.mouth.ledgeY" />
      <path class="c9-mouth-ledge" :d="`M ${pole.mouth.slotX0} ${pole.mouth.ledgeY} H ${pole.mouth.slotX0 + 2.1} M ${pole.mouth.slotX1 - 2.2} ${pole.mouth.ledgeY} H ${pole.mouth.slotX1}`" />

      <!-- terminal screws show through the pocket shadow -->
      <g class="c9-screw" :transform="`translate(${MODULE_MM / 2} ${pole.screwTop})`">
        <circle r="2.25" /><path d="M -1.5 -1.5 L 1.5 1.5 M 1.5 -1.5 L -1.5 1.5" />
      </g>
      <g class="c9-screw" :transform="`translate(${MODULE_MM / 2} ${pole.screwBottom})`">
        <circle r="2.25" /><path d="M -1.5 -1.5 L 1.5 1.5 M 1.5 -1.5 L -1.5 1.5" />
      </g>

      <!-- centre rib runs around the screw zones -->
      <rect v-for="(seg, i) in pole.rib.segs" :key="`rib-${i}`" class="c9-rib" :x="pole.rib.x - pole.rib.w / 2" :y="seg[0]" :width="pole.rib.w" :height="seg[1] - seg[0]" />

      <path class="c9-seam" :d="`M 0 ${pole.seamTop} H ${MODULE_MM}`" />
      <path class="c9-seam" :d="`M 0 ${pole.seamBottom} H ${MODULE_MM}`" />

      <!-- lever zone: recess, paddle with notched grip bar, seat lines -->
      <path class="c9-lever-recess" :d="recessPath" />
      <path class="c9-lever-inner" :d="`M ${pole.lever.innerX0} ${pole.lever.innerY} V ${pole.lever.innerY0} H ${pole.lever.innerX1} V ${pole.lever.innerY}`" />
      <path class="c9-handle" :d="handlePath" />
      <path class="c9-handle-shine" :d="`M ${pole.lever.waistX0 + 0.7} ${pole.lever.waistY - 1.5} Q ${MODULE_MM / 2 - 1.6} 24.85 ${MODULE_MM / 2} 24.9`" />
      <path class="c9-seam soft" :d="`M 0 ${pole.lever.shoulderY} H ${pole.lever.shoulderX0} M ${pole.lever.shoulderX1} ${pole.lever.shoulderY} H ${MODULE_MM}`" />
      <path class="c9-lever-ledge" :d="`M ${pole.lever.shoulderX0} ${pole.lever.recessBottomY} H ${pole.lever.shoulderX1}`" />
      <path class="c9-lever-ledge" :d="`M ${pole.lever.ledgeX0} ${pole.lever.ledgeY} H ${pole.lever.ledgeX1}`" />
      <text class="c9-state" x="2.7" y="30.6">I</text>
      <text class="c9-state" x="14.6" y="30.6">O</text>

      <!-- printed markings in the free field below the lever -->
      <text v-for="(label, i) in labels" :key="`label-${i}`" class="c9-label" :class="{ 'c9-label-muted': label.muted }" :x="label.x" :y="label.y" :font-size="label.size" :font-weight="label.weight" :text-anchor="label.anchor">{{ label.text }}</text>
    </g>
    <path v-for="(x, i) in seams" :key="`seam-${i}`" class="c9-seam" :d="`M ${x} ${pole.mouth.faceTopY} V ${pole.bottom.edgeY}`" />
  </g>
</template>

<style scoped>
.c9-shell {
  fill: url(#dv-shell) var(--dv-shell-2, #f2f4ee);
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.3;
}
.c9-mouth-recess {
  fill: url(#dv-pocket) #2b312c;
}
.c9-mouth-slot {
  fill: #151915;
}
.c9-mouth-ledge {
  fill: none;
  stroke: rgba(255, 255, 255, 0.28);
  stroke-width: 0.3;
}
.c9-screw {
  opacity: 0.5;
}
.c9-screw circle {
  fill: #79837b;
  stroke: rgba(15, 19, 16, 0.6);
  stroke-width: 0.25;
}
.c9-screw path {
  fill: none;
  stroke: #1d221e;
  stroke-width: 0.4;
  stroke-linecap: round;
}
.c9-rib {
  fill: var(--dv-line, #77817a);
  opacity: 0.3;
}
.c9-seam {
  fill: none;
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.25;
  opacity: 0.4;
}
.c9-seam.soft {
  opacity: 0.55;
}
.c9-lever-recess {
  fill: var(--dv-pocket-2, #3f4740);
  opacity: 0.5;
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.22;
}
.c9-lever-inner {
  fill: none;
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 0.3;
}
.c9-handle {
  fill: url(#dv-toggle) #2a312b;
  stroke: rgba(12, 16, 13, 0.5);
  stroke-width: 0.28;
}
.c9-handle-shine {
  fill: none;
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 0.4;
  stroke-linecap: round;
}
.c9-lever-ledge {
  fill: none;
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.25;
  opacity: 0.5;
}
.c9-state {
  fill: var(--dv-ink, #2f3831);
  font: 600 1.8px sans-serif;
  text-anchor: middle;
  opacity: 0.75;
}
.c9-label {
  fill: var(--dv-ink, #2f3831);
  font-family: sans-serif;
}
.c9-label-muted {
  fill: var(--dv-ink-soft, #69726b);
}
</style>
