<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDefinition } from '../../../domain/types'
import { CHINT_FACE_HEIGHTS, CHINT_TERMINAL_SCREWS, chintFaceKind, faceDetailFor, fitFaceText } from './metrics'
import type { ChintKind } from './metrics'

/**
 * Face of the CHINT NB/NL modular platform (NB1-63, NBH8-40, NB1L, NB1L-40/63, NB2LE,
 * NB310L, NBH8LE, NL1-63), drawn 1:1 from the manufacturer's 2D front drawings that
 * ship with the series. Every constant below is a millimetre measured off those
 * drawings: terminal windows with their screw bosses, the offset lever of the
 * differential families with the T button, the side flute groups and the print rows.
 * The MCB families repeat a full cell per pole because the poles are physically
 * separate 1P units; the differential families carry one lever group on the left
 * block and the label field to its right, exactly like the drawings.
 */
const props = defineProps<{ product: DeviceDefinition }>()

const MODULE_MM = 18

type Kind = ChintKind

interface FaceSpec {
  kind: Kind
  /** Terminal screw radius; the centre's y comes from the shared terminal table in the domain. */
  screw: { r: number; cross: boolean; perPole: 1 | 2; pairSpacing: number }
  /** Terminal window outer frame and inner slot, [y0, y1] from the face centre. */
  window: { top: [number, number]; topInner: [number, number] }
  /** Side flute groups: [y0, y1] measured from the face centre. */
  flutes: Array<[number, number]>
  lever: 'cell' | 'offset'
}

/** Per-family constants taken off the drawings (NB1-63 1P, NL1-63 2P, NB1L 36/54, NB1L-40 3P, NB2LE, NB310L 3P+N, NBH8-40, NBH8LE-40). */
const SPECS: Record<Kind, FaceSpec> = {
  nb1: {
    kind: 'nb1',
    screw: { r: 4, cross: false, perPole: 1, pairSpacing: 0 },
    window: { top: [26.9, 42.2], topInner: [28.7, 40.0] },
    flutes: [[25.2, 30.6], [33.5, 39], [3.1, 7.5], [-34, -21.6]],
    lever: 'cell',
  },
  nbh8: {
    kind: 'nbh8',
    screw: { r: 3, cross: false, perPole: 1, pairSpacing: 0 },
    window: { top: [26.8, 42.4], topInner: [28.5, 40.3] },
    flutes: [[29.5, 40], [4, 13], [-22, -14]],
    lever: 'cell',
  },
  nl1: {
    kind: 'nl1',
    screw: { r: 4, cross: false, perPole: 1, pairSpacing: 0 },
    window: { top: [26.9, 41.4], topInner: [28.8, 39.4] },
    flutes: [[27, 34], [7, 12], [-30, -10]],
    lever: 'offset',
  },
  nb1l: {
    kind: 'nb1l',
    screw: { r: 2.75, cross: true, perPole: 1, pairSpacing: 0 },
    window: { top: [27, 41], topInner: [29, 39.5] },
    flutes: [[28, 36], [6, 12], [-30, -14]],
    lever: 'offset',
  },
  nb1l40: {
    kind: 'nb1l40',
    screw: { r: 2.75, cross: true, perPole: 2, pairSpacing: 16.15 },
    window: { top: [28, 42.5], topInner: [30, 41] },
    flutes: [[29, 38], [5, 12], [-32, -15]],
    lever: 'offset',
  },
  nb2le: {
    kind: 'nb2le',
    screw: { r: 2.5, cross: true, perPole: 1, pairSpacing: 0 },
    window: { top: [31, 42.7], topInner: [32.8, 41] },
    flutes: [[35, 41], [26, 31], [-26, -4]],
    lever: 'offset',
  },
  nb310l: {
    kind: 'nb310l',
    screw: { r: 4, cross: false, perPole: 1, pairSpacing: 0 },
    window: { top: [26, 41.3], topInner: [27.8, 39.6] },
    flutes: [[27, 35], [6, 12], [-30, -12]],
    lever: 'offset',
  },
  nbh8le: {
    kind: 'nbh8le',
    screw: { r: 2.3, cross: true, perPole: 1, pairSpacing: 0 },
    window: { top: [24.5, 38], topInner: [26, 36.5] },
    flutes: [[27, 35], [5, 12], [-28, -12]],
    lever: 'offset',
  },
}

const kind = computed<Kind>(() => chintFaceKind(props.product))

const spec = computed(() => SPECS[kind.value])
const modules = computed(() => Math.max(1, Math.round(props.product.moduleWidth || 1)))
const poles = computed(() => Math.max(1, Math.round(props.product.poles || modules.value)))
const widthMm = computed(() => modules.value * MODULE_MM)
const heightMm = computed(() => CHINT_FACE_HEIGHTS[kind.value])
const detail = computed(() => faceDetailFor(widthMm.value))

/** Drawing coords have y up with the origin at the face centre; the viewBox has y down. */
const toY = (drawingY: number) => heightMm.value / 2 - drawingY

const outlinePath = computed(() => {
  const w = widthMm.value
  const h = heightMm.value
  const c = 1.2
  return `M 0 ${c} L ${c} 0 H ${w - c} L ${w} ${c} V ${h - c} L ${w - c} ${h} H ${c} L 0 ${h - c} Z`
})

/** Terminal windows span the whole face; screws sit at pole centres, wide poles carry a pair. */
interface ScrewMark { cx: number; cy: number; r: number; cross: boolean }
const screws = computed(() => {
  const { r, cross, perPole, pairSpacing } = spec.value.screw
  // The terminal table is the same one the wire router anchors to, in millimetres from the
  // face top; the drawing works in millimetres up from the face centre.
  const band = CHINT_TERMINAL_SCREWS[kind.value]
  const topY = heightMm.value / 2 - band.topMm
  const bottomY = heightMm.value / 2 - band.bottomMm
  const pitch = widthMm.value / poles.value
  const marks: ScrewMark[] = []
  for (let i = 0; i < poles.value; i++) {
    const center = (i + 0.5) * pitch
    const xs = perPole === 1 ? [center] : [center - pairSpacing / 2, center + pairSpacing / 2]
    for (const cx of xs) {
      marks.push({ cx, cy: toY(topY), r, cross })
      marks.push({ cx, cy: toY(bottomY), r, cross })
    }
  }
  return marks
})

const windows = computed(() => {
  const [t0, t1] = spec.value.window.top
  const [ti0, ti1] = spec.value.window.topInner
  const insetX = 1
  return {
    top: { x: insetX, y: toY(t1), width: widthMm.value - insetX * 2, height: t1 - t0 },
    topInner: { x: insetX + 2, y: toY(ti1), width: widthMm.value - (insetX + 2) * 2, height: ti1 - ti0 },
    bottom: { x: insetX, y: toY(-t0), width: widthMm.value - insetX * 2, height: t1 - t0 },
    bottomInner: { x: insetX + 2, y: toY(-ti0), width: widthMm.value - (insetX + 2) * 2, height: ti1 - ti0 },
  }
})

/** Side flutes: short vertical grooves on the 3 mm side strips, in the drawing's groups. */
const flutes = computed(() => {
  const w = widthMm.value
  const strip = 1.6
  const out: Array<{ x: number; y: number; h: number }> = []
  for (const [y0, y1] of spec.value.flutes) {
    const top = toY(y1)
    const h = y1 - y0
    out.push({ x: strip, y: top, h })
    out.push({ x: w - strip - 0.7, y: top, h })
  }
  return out
})

/** MCB: one lever cell per module with its own I/O and print rows. */
const cells = computed(() => {
  if (spec.value.lever !== 'cell') return []
  return Array.from({ length: modules.value }, (_, i) => ({ x: i * MODULE_MM }))
})

/** Differential families: lever group with the T button, laid out per the family drawing. */
const leverGroup = computed(() => {
  if (spec.value.lever !== 'offset') return null
  const k = kind.value
  const w = widthMm.value
  if (k === 'nl1') {
    // NL1: short wide lever on the left pole, T button right above it.
    return {
      recess: { x: 5, y: toY(8), width: 15, height: 9 },
      paddles: [{ x: 6.2, y: toY(7), width: 12.6, height: 7 }],
      t: { x: 5, y: toY(16), width: 10, height: 4, label: 'T' },
      io: { left: 3.4, right: 21, y: toY(3.5) },
    }
  }
  if (k === 'nb1l') {
    // NB1L 36/54: ganged pair of paddles in the left block, T button to their right.
    return {
      recess: { x: 3, y: toY(1), width: 18.5, height: 18 },
      paddles: [
        { x: 3.9, y: toY(0.5), width: 8.1, height: 16.5 },
        { x: 14.5, y: toY(0.5), width: 5.1, height: 16.5 },
      ],
      t: { x: 24.5, y: toY(16), width: 6, height: 6, label: 'T' },
      io: { left: 1.4, right: 22, y: toY(3.7) },
    }
  }
  if (k === 'nb2le') {
    // Single module: big centred paddle, the small T button recessed to its right.
    return {
      recess: { x: 0.6, y: toY(2), width: 16.8, height: 16 },
      paddles: [{ x: 2.3, y: toY(1.2), width: 13.4, height: 15.2 }],
      t: { x: w - 5.8, y: toY(12), width: 3, height: 3.5, label: 'T' },
      io: { left: 1.2, right: 15.5, y: toY(3.5) },
    }
  }
  if (k === 'nbh8le') {
    // Compact RCBO: NBH8-style wide paddle with the T square to its left.
    return {
      recess: { x: 3.3, y: toY(1), width: 13.2, height: 15 },
      paddles: [{ x: 4.3, y: toY(0.5), width: 11.2, height: 14.5 }],
      t: { x: w - 7.5, y: toY(14), width: 5, height: 5, label: 'T' },
      io: null as null | { left: number; right: number; y: number },
    }
  }
  // Wide frames (NB1L-40/63, NB310L): one handle over the leftmost pole, T on the right end.
  return {
    recess: { x: 5, y: toY(1), width: 14, height: 17 },
    paddles: [{ x: 6.5, y: toY(0.5), width: k === 'nb310l' ? 12 : 11, height: 16.5 }],
    t: { x: w - 11, y: toY(17), width: 6, height: 6, label: 'T' },
    io: { left: 3.4, right: 19, y: toY(3.7) },
  }
})

/** Grip ridges of a paddle: the NB1-63 drawing shows 9 ridges at ~0.9 mm pitch. */
const gripLines = (x: number, y: number, w: number) => {
  const lines: string[] = []
  for (let i = 0; i < 9; i++) lines.push(`M ${x + 1} ${y + 2.6 + i * 0.9} H ${x + w - 1}`)
  return lines.join(' ')
}

const ioRow = computed(() => (kind.value === 'nb1' ? { iX: MODULE_MM / 2 - 5.6, oX: MODULE_MM / 2 - 0.5, y: toY(11.8) } : null))

interface FaceLabel { text: string; x: number; y: number; size: number; weight: 400 | 600 | 700; anchor: 'start' | 'middle' | 'end'; muted?: boolean }

const labels = computed(() => {
  const items: FaceLabel[] = []
  const w = widthMm.value
  const series = (props.product.series || '').replace('NB1-63H', 'NB1-63').trim()
  const rating = props.product.ratedCurrent > 0 ? `${props.product.tripCurve || ''}${props.product.ratedCurrent}`.trim() : ''
  const residual = props.product.residualCurrentMa ? `${props.product.residualCurrentMa}mA` : ''
  if (spec.value.lever === 'cell') {
    if (kind.value === 'nbh8') {
      if (detail.value !== 'minimal') items.push({ text: 'CHINT', x: w / 2, y: toY(15.6), size: 2.2, weight: 700, anchor: 'middle' })
      if (detail.value !== 'minimal') items.push({ text: fitFaceText(series, w - 4, 2.2), x: w / 2, y: toY(9.6), size: 2.2, weight: 600, anchor: 'middle' })
      if (rating) items.push({ text: fitFaceText(rating, w - 4, 3), x: w / 2, y: toY(4.4), size: 3, weight: 700, anchor: 'middle' })
      return items
    }
    // NB1-63: print per pole, straight off the 1P drawing rows.
    if (detail.value !== 'minimal') items.push({ text: 'CHINT', x: MODULE_MM / 2, y: toY(16.2), size: 2, weight: 700, anchor: 'middle' })
    if (detail.value === 'full') items.push({ text: fitFaceText(series, MODULE_MM - 5, 2), x: MODULE_MM / 2, y: toY(-19), size: 2, weight: 600, anchor: 'middle' })
    if (rating) items.push({ text: fitFaceText(rating, MODULE_MM - 4, 3.2), x: MODULE_MM / 2, y: toY(-23), size: 3.2, weight: 700, anchor: 'middle' })
    if (detail.value === 'full' && props.product.voltage) items.push({ text: `~${props.product.voltage}V`, x: MODULE_MM / 2, y: toY(-25.6), size: 1.6, weight: 400, anchor: 'middle', muted: true })
    return items
  }
  // Differential families: every drawing prints the brand over the lever block and the
  // ratings in the free field; the T button keeps its own column on the right.
  const k = kind.value
  if (k === 'nb2le') {
    if (detail.value !== 'minimal') items.push({ text: 'CHINT', x: 1.4, y: toY(14.6), size: 2, weight: 700, anchor: 'start' })
    if (detail.value !== 'minimal') items.push({ text: fitFaceText(series, 9, 2), x: 1.4, y: toY(8.5), size: 2, weight: 600, anchor: 'start' })
    if (rating) items.push({ text: fitFaceText(rating, 12, 4), x: 6, y: toY(-8), size: 4, weight: 700, anchor: 'middle' })
    if (residual) items.push({ text: `IΔn ${residual}`, x: 6, y: toY(-12.5), size: 2.2, weight: 600, anchor: 'middle' })
    return items
  }
  if (k === 'nbh8le') {
    if (detail.value !== 'minimal') items.push({ text: 'CHINT', x: 1.4, y: toY(7.5), size: 2, weight: 700, anchor: 'start' })
    if (detail.value !== 'minimal') items.push({ text: fitFaceText(series, 14, 2), x: 1.4, y: toY(2.5), size: 2, weight: 600, anchor: 'start' })
    if (rating) items.push({ text: fitFaceText(rating, 14, 3.4), x: w / 2, y: toY(-18.5), size: 3.4, weight: 700, anchor: 'middle' })
    if (residual) items.push({ text: `IΔn ${residual}`, x: w / 2, y: toY(-22.3), size: 2, weight: 600, anchor: 'middle' })
    return items
  }
  if (k === 'nl1') {
    // The NL1 drawing carries a marked label window to the right of the T button.
    const lx = 17
    if (detail.value !== 'minimal') items.push({ text: 'CHINT', x: lx, y: toY(24.5), size: 2.2, weight: 700, anchor: 'start' })
    if (detail.value !== 'minimal') items.push({ text: fitFaceText(series, w - lx - 2, 3), x: lx, y: toY(20.5), size: 3, weight: 700, anchor: 'start' })
    if (rating) items.push({ text: fitFaceText(rating, 10, 3.6), x: (16 + w) / 2, y: toY(4), size: 3.6, weight: 700, anchor: 'middle' })
    if (residual && detail.value !== 'minimal') items.push({ text: `IΔn ${residual}`, x: (16 + w) / 2, y: toY(-0.5), size: 2.2, weight: 600, anchor: 'middle' })
    if (detail.value === 'full' && props.product.voltage) items.push({ text: `~${props.product.voltage}V`, x: (16 + w) / 2, y: toY(-5), size: 1.8, weight: 400, anchor: 'middle', muted: true })
    return items
  }
  const wide = k === 'nb1l40' || k === 'nb310l'
  const lx = wide ? 24 : 2
  const tx = wide ? w - 13 : 22
  const cx = (lx + w - 2) / 2
  if (detail.value !== 'minimal') items.push({ text: 'CHINT', x: lx, y: toY(15.4), size: 2.4, weight: 700, anchor: 'start' })
  if (detail.value !== 'minimal') items.push({ text: fitFaceText(series, tx - lx, 3), x: lx, y: toY(11.4), size: 3, weight: 700, anchor: 'start' })
  if (rating) items.push({ text: fitFaceText(rating, 14, 4), x: cx, y: toY(3.5), size: 4, weight: 700, anchor: 'middle' })
  if (residual && detail.value !== 'minimal') items.push({ text: `IΔn ${residual}`, x: cx, y: toY(-1.5), size: 2.2, weight: 600, anchor: 'middle' })
  if (detail.value === 'full' && props.product.voltage) items.push({ text: `~${props.product.voltage}V`, x: cx, y: toY(-6), size: 1.8, weight: 400, anchor: 'middle', muted: true })
  return items
})

const seams = computed(() => Array.from({ length: modules.value - 1 }, (_, i) => (i + 1) * MODULE_MM))
</script>

<template>
  <g class="ch-face">
    <path class="ch-shell" :d="outlinePath" />

    <!-- terminal windows with the wire slot and the screw bosses -->
    <rect class="ch-window" :x="windows.top.x" :y="windows.top.y" :width="windows.top.width" :height="windows.top.height" rx="0.8" />
    <rect class="ch-window-slot" :x="windows.topInner.x" :y="windows.topInner.y" :width="windows.topInner.width" :height="windows.topInner.height" />
    <rect class="ch-window" :x="windows.bottom.x" :y="windows.bottom.y" :width="windows.bottom.width" :height="windows.bottom.height" rx="0.8" />
    <rect class="ch-window-slot" :x="windows.bottomInner.x" :y="windows.bottomInner.y" :width="windows.bottomInner.width" :height="windows.bottomInner.height" />
    <g v-for="(s, i) in screws" :key="`scr-${i}`" class="ch-screw" :transform="`translate(${s.cx} ${s.cy})`">
      <circle :r="s.r" />
      <path v-if="!s.cross" class="ch-screw-slot" :d="`M ${-s.r * 0.62} 0 H ${s.r * 0.62}`" />
      <path v-else class="ch-screw-slot" :d="`M ${-s.r * 0.55} 0 H ${s.r * 0.55} M 0 ${-s.r * 0.55} V ${s.r * 0.55}`" />
    </g>

    <!-- side flute groups -->
    <rect v-for="(f, i) in flutes" :key="`fl-${i}`" class="ch-flute" :x="f.x" :y="f.y" width="0.7" :height="f.h" rx="0.35" />

    <!-- MCB: one lever cell per pole -->
    <g v-for="(cell, ci) in cells" :key="`cell-${ci}`" :transform="`translate(${cell.x} 0)`">
      <rect class="ch-lever-recess" x="1.3" :y="toY(2)" :width="MODULE_MM - 2.6" height="17.5" rx="0.6" />
      <rect class="ch-lever-inner" x="2.5" :y="toY(1.2)" :width="MODULE_MM - 5" height="16" />
      <path class="ch-handle" :d="`M 2.5 ${toY(1.2) + 0.6} Q ${MODULE_MM / 2} ${toY(1.2) - 0.4} ${MODULE_MM - 2.5} ${toY(1.2) + 0.6} V ${toY(-14.8)} H 2.5 Z`" />
      <path class="ch-grips" :d="gripLines(2.5, toY(-14.8), MODULE_MM - 5)" />
      <text v-if="ioRow" class="ch-io" :x="ioRow.iX" :y="ioRow.y">I</text>
      <text v-if="ioRow" class="ch-io" :x="ioRow.oX" :y="ioRow.y">O</text>
    </g>

    <!-- differential families: offset lever group with T button -->
    <g v-if="leverGroup">
      <rect class="ch-lever-recess" :x="leverGroup.recess.x" :y="leverGroup.recess.y" :width="leverGroup.recess.width" :height="leverGroup.recess.height" rx="0.6" />
      <rect v-for="(p, pi) in leverGroup.paddles" :key="`pad-${pi}`" class="ch-handle" :x="p.x" :y="p.y" :width="p.width" :height="p.height" rx="0.5" />
      <path v-for="(p, pi) in leverGroup.paddles" :key="`gr-${pi}`" class="ch-grips" :d="gripLines(p.x, p.y, p.width)" />
      <g class="ch-t">
        <rect :x="leverGroup.t.x" :y="leverGroup.t.y" :width="leverGroup.t.width" :height="leverGroup.t.height" rx="0.6" />
        <text :x="leverGroup.t.x + leverGroup.t.width / 2" :y="leverGroup.t.y + leverGroup.t.height - 1.2">{{ leverGroup.t.label }}</text>
      </g>
      <template v-if="leverGroup.io">
        <text class="ch-io" :x="leverGroup.io.left" :y="leverGroup.io.y">I</text>
        <text class="ch-io" :x="leverGroup.io.right" :y="leverGroup.io.y">O</text>
      </template>
    </g>

    <!-- print rows -->
    <text v-for="(label, i) in labels" :key="`lb-${i}`" class="ch-label" :class="{ 'ch-label-muted': label.muted }" :x="label.x" :y="label.y" :font-size="label.size" :font-weight="label.weight" :text-anchor="label.anchor">{{ label.text }}</text>

    <!-- pole seams of multi-unit assemblies -->
    <path v-for="(x, i) in seams" :key="`seam-${i}`" class="ch-seam" :d="`M ${x} 1.2 V ${heightMm - 1.2}`" />
  </g>
</template>

<style scoped>
.ch-shell {
  fill: url(#dv-shell) var(--dv-shell-2, #f4f5f2);
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.3;
}
.ch-window {
  fill: url(#dv-pocket) #2b312c;
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.25;
}
.ch-window-slot {
  fill: #171b17;
}
.ch-screw circle {
  fill: #79837b;
  stroke: rgba(15, 19, 16, 0.6);
  stroke-width: 0.25;
}
.ch-screw-slot {
  fill: none;
  stroke: #1d221e;
  stroke-width: 0.45;
  stroke-linecap: round;
}
.ch-flute {
  fill: var(--dv-line, #77817a);
  opacity: 0.3;
}
.ch-lever-recess {
  fill: var(--dv-pocket-2, #3f4740);
  opacity: 0.45;
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.22;
}
.ch-lever-inner {
  fill: none;
  stroke: rgba(255, 255, 255, 0.25);
  stroke-width: 0.25;
}
.ch-handle {
  fill: url(#dv-toggle) #2a312b;
  stroke: rgba(12, 16, 13, 0.5);
  stroke-width: 0.28;
}
.ch-grips {
  fill: none;
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 0.3;
  stroke-linecap: round;
}
.ch-t rect {
  fill: #d84b3a;
  stroke: rgba(12, 16, 13, 0.5);
  stroke-width: 0.25;
  opacity: 0.92;
}
.ch-t text {
  fill: #fff;
  font: 700 2.6px sans-serif;
  text-anchor: middle;
}
.ch-io {
  fill: var(--dv-ink, #2f3831);
  font: 700 2.3px sans-serif;
  text-anchor: middle;
  opacity: 0.95;
}
.ch-label {
  fill: var(--dv-ink, #2f3831);
  font-family: sans-serif;
}
.ch-label-muted {
  fill: var(--dv-ink-soft, #69726b);
}
.ch-seam {
  fill: none;
  stroke: var(--dv-line, #77817a);
  stroke-width: 0.25;
  opacity: 0.4;
}
</style>
