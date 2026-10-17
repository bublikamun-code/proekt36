<script setup lang="ts">
import { computed } from 'vue'
import { buildSingleLine, formatAmperes, isEmptySingleLine, singleLineExtent, type SingleLineLoad } from '../../domain/singleLine'
import type { DeviceDefinition, PanelProject } from '../../domain/types'

/**
 * The single-line diagram, drawn from the model in `domain/singleLine.ts`.
 *
 * Geometry is computed, not styled: a print report is read on paper, where CSS media queries do
 * not apply, so the drawing is laid out in a fixed viewBox that scales to whatever width the
 * report is given. Coordinates therefore live in the script and the template only reads them.
 *
 * Each column is a spine: the bus drops into the protective device, the spine continues under it,
 * and every load hangs off the spine as a horizontal tick with its caption underneath. The first
 * published cut centred the box over its loads instead, and a one-circuit column — the common
 * case — drew the box on the same line as its own load, the label over the rating, and the load
 * caption over the device name. A spine cannot collide: box, ticks and captions sit on
 * predetermined rows.
 */
const props = defineProps<{
  project: PanelProject
  definitions: Map<string, DeviceDefinition>
}>()

const model = computed(() => buildSingleLine(props.project, props.definitions))
const empty = computed(() => isEmptySingleLine(model.value))

const COLUMN = 190
const ROW = 56
/** The bus line every column branches from. */
const HEADER = 72
/** Where the load grid starts: below the box (which ends at HEADER + 46) plus a bend. */
const LOAD_TOP = HEADER + 66
const LEFT = 150
const PADDING = 12

/** Vertical centre of the protective device box, the same row in every column. */
const BOX_Y = HEADER + 10
const BOX_HEIGHT = 36
/** Distance from the column's left edge to its spine. */
const SPINE = 40
/** How far a load tick reaches to the right of the spine. */
const TICK = 64

const extent = computed(() => singleLineExtent(model.value))
const width = computed(() => LEFT + extent.value.columns * COLUMN + PADDING * 2)
// Bottom room for the last row's caption plus a margin — not a full extra row of blank paper.
const height = computed(() => LOAD_TOP + (extent.value.rows - 1) * ROW + 36)

const loadY = (loadIndex: number) => LOAD_TOP + loadIndex * ROW

/** The spine carries the box and all of its loads, so it spans from the bus to the last tick. */
const spineEnd = (groupIndex: number) => {
  const loads = model.value.groups[groupIndex]?.loads.length ?? 1
  return loadY(loads - 1)
}

const trim = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/**
 * What the line under a load says. A three-phase load is 3~, a single-phase one names its phase,
 * and a line the migration could not classify says so rather than guessing — the caption is the
 * one place on the drawing where «не уточнено» costs nothing and a wrong L1 costs a rewire.
 */
const phaseMark = (load: SingleLineLoad) => {
  if (load.phaseCount === 3) return '3~'
  if (load.phaseAmbiguous) return 'фаза не уточнена'
  return `L${load.phase}`
}

/** A derived current keeps its «≈»: it is a guess from the power, not a measured or stated one. */
const loadCaption = (load: SingleLineLoad) => {
  const current = load.declaredCurrent ? `${formatAmperes(load.current)} А` : `≈ ${formatAmperes(load.current)} А`
  return `${phaseMark(load)} · ${current} · ${load.crossSection} мм²`
}

const columnX = (groupIndex: number) => LEFT + groupIndex * COLUMN
</script>

<template>
  <figure class="single-line" data-single-line>
    <figcaption>
      Однолинейная схема · предварительная. Показывает путь питания от ввода к защитным аппаратам и цепям;
      это не принципиальная схема и не монтажная документация.
    </figcaption>

    <p v-if="empty" class="single-line-empty">Цепи не заданы — схему питания построить не из чего.</p>

    <template v-else>
      <svg :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" role="img" aria-label="Однолинейная схема щита">
        <!-- Supply: the incoming rating comes from the panel settings, not from a device, because
             the project has no separate notion of a main breaker. -->
        <g class="sl-source">
          <rect :x="PADDING" :y="HEADER - 30" :width="LEFT - PADDING * 2" height="60" rx="4" />
          <text :x="LEFT / 2" :y="HEADER - 8" text-anchor="middle" class="sl-node-label">Ввод</text>
          <text :x="LEFT / 2" :y="HEADER + 8" text-anchor="middle" class="sl-node-sub">{{ model.source.label }} · {{ model.source.ratedCurrent }} А</text>
        </g>
        <path :d="`M ${LEFT - 2} ${HEADER} H ${width - PADDING - 2}`" class="sl-bus" />

        <g v-for="(group, groupIndex) in model.groups" :key="group.protection?.instanceId || `unprotected-${groupIndex}`">
          <path :d="`M ${columnX(groupIndex) + SPINE} ${HEADER} V ${spineEnd(groupIndex)}`" class="sl-branch" />
          <g :class="group.protection ? 'sl-device' : 'sl-device sl-unprotected'">
            <rect :x="columnX(groupIndex) + SPINE - 34" :y="BOX_Y" width="68" :height="BOX_HEIGHT" rx="3" />
            <template v-if="group.protection">
              <title>{{ group.protection.name }}</title>
              <text :x="columnX(groupIndex) + SPINE" :y="BOX_Y + 15" text-anchor="middle" class="sl-node-label">{{ trim(group.protection.label, 12) }}</text>
              <text :x="columnX(groupIndex) + SPINE" :y="BOX_Y + 28" text-anchor="middle" class="sl-node-sub">{{ group.protection.ratedCurrent ?? '—' }} А</text>
            </template>
            <text v-else :x="columnX(groupIndex) + SPINE" :y="BOX_Y + 22" text-anchor="middle" class="sl-node-label">нет защиты</text>
          </g>

          <g v-for="(load, loadIndex) in group.loads" :key="load.circuitId">
            <line
              :x1="columnX(groupIndex) + SPINE"
              :y1="loadY(loadIndex)"
              :x2="columnX(groupIndex) + SPINE + TICK"
              :y2="loadY(loadIndex)"
              class="sl-branch"
            />
            <circle :cx="columnX(groupIndex) + SPINE" :cy="loadY(loadIndex)" r="3.5" class="sl-node-dot" />
            <text
              :x="columnX(groupIndex) + SPINE + 4"
              :y="loadY(loadIndex) + 14"
              class="sl-load-label"
            >{{ trim(load.label, 26) }}</text>
            <text
              :x="columnX(groupIndex) + SPINE + 4"
              :y="loadY(loadIndex) + 25"
              class="sl-caption sl-load-caption"
            >{{ loadCaption(load) }}</text>
          </g>
        </g>
      </svg>

      <ul v-if="model.combs.length" class="single-line-notes">
        <li v-for="comb in model.combs" :key="`comb-${comb.row}-${comb.label}`">
          {{ comb.label }} (ряд {{ comb.row + 1 }}) питает {{ comb.fedAddresses.join(', ') }}.
        </li>
      </ul>
      <ul v-if="model.busbars.length" class="single-line-notes">
        <li v-for="bus in model.busbars" :key="bus.instanceId">
          Шина {{ bus.label }} ({{ bus.name || bus.bus }}, {{ bus.ratedCurrent ?? '—' }} А) питает подключённые аппараты.
        </li>
      </ul>
      <ul v-if="model.feeds.length" class="single-line-notes">
        <li v-for="feed in model.feeds" :key="`${feed.from.instanceId}-${feed.to.instanceId}-${feed.bus}`">
          {{ feed.from.label }} → {{ feed.to.label }} ({{ feed.bus }}): питание
          {{ feed.via === 'cascade' ? 'каскадом от другого аппарата' : feed.via === 'busbar' ? 'от шины аппарата' : feed.from.instanceId.startsWith('bus:') ? 'от шины щита' : 'от ввода' }}.
        </li>
      </ul>
      <ul v-if="model.unmodelled.length" class="single-line-notes">
        <li v-for="device in model.unmodelled" :key="device.instanceId">
          {{ device.address }} — {{ device.name }}: в схеме питания не участвует, цепь не заведена.
        </li>
      </ul>
    </template>
  </figure>
</template>
