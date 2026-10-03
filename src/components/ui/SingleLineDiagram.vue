<script setup lang="ts">
import { computed } from 'vue'
import { buildSingleLine, isEmptySingleLine, singleLineExtent, type SingleLineModel } from '../../domain/singleLine'
import type { DeviceDefinition, PanelProject } from '../../domain/types'

/**
 * The single-line diagram, drawn from the model in `domain/singleLine.ts`.
 *
 * Geometry is computed, not styled: a print report is read on paper, where CSS media queries do
 * not apply, so the drawing is laid out in a fixed viewBox that scales to whatever width the
 * report is given. Coordinates therefore live in the script and the template only reads them.
 */
const props = defineProps<{
  project: PanelProject
  definitions: Map<string, DeviceDefinition>
}>()

const model = computed<SingleLineModel>(() => buildSingleLine(props.project, props.definitions))
const empty = computed(() => isEmptySingleLine(model.value))

const COLUMN = 150
const ROW = 62
const HEADER = 96
const LEFT = 150
const PADDING = 12
const CAPTION = 8

const extent = computed(() => singleLineExtent(model.value))
const width = computed(() => LEFT + extent.value.columns * COLUMN + PADDING * 2)
const height = computed(() => HEADER + extent.value.rows * ROW + PADDING * 2)

/** Vertical middle of a group, so a column of one circuit and a column of five share a centre. */
const groupCenter = (groupIndex: number) => {
  const loads = model.value.groups[groupIndex]?.loads.length ?? 1
  return HEADER + (loads * ROW) / 2
}

/**
 * Every column starts at the same height, so load N sits on the same line in every column and the
 * diagram reads as a grid rather than as a set of unrelated stacks.
 */
const loadY = (loadIndex: number) => HEADER + loadIndex * ROW + ROW / 2

const trim = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/**
 * A load's caption sits under its own tick and is centred in the column, not beside it. Beside it,
 * a long name reached back over the protection block: the column is 150 wide, the block covers
 * 68 of that in the middle, and an 11-character name at 11 px is about 73 px — so the two
 * overlapped exactly in the common case of one circuit per group.
 */
const LOAD_LABEL = 20
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
          <rect :x="PADDING" :y="HEADER - 26" :width="LEFT - PADDING * 2" height="52" rx="4" />
          <text :x="LEFT / 2" :y="HEADER - 4" text-anchor="middle" class="sl-node-label">Ввод</text>
          <text :x="LEFT / 2" :y="HEADER + 10" text-anchor="middle" class="sl-node-sub">{{ model.source.label }} · {{ model.source.ratedCurrent }} А</text>
        </g>
        <path :d="`M ${LEFT - 2} ${HEADER} H ${width - PADDING - 2}`" class="sl-bus" />

        <g v-for="(group, groupIndex) in model.groups" :key="group.protection?.instanceId || `unprotected-${groupIndex}`">
          <line :x1="LEFT" :y1="HEADER" :x2="LEFT" :y2="groupCenter(groupIndex)" class="sl-branch" />
          <line
            :x1="LEFT"
            :y1="groupCenter(groupIndex)"
            :x2="LEFT + groupIndex * COLUMN + COLUMN / 2 - 34"
            :y2="groupCenter(groupIndex)"
            class="sl-branch"
          />
          <g v-if="group.protection" :transform="`translate(${LEFT + groupIndex * COLUMN + COLUMN / 2 - 34} ${groupCenter(groupIndex) - 13})`" class="sl-device">
            <rect width="68" height="26" rx="3" />
            <text x="34" y="12" text-anchor="middle" class="sl-node-label">{{ trim(group.protection.label, 12) }}</text>
            <text x="34" y="22" text-anchor="middle" class="sl-node-sub">{{ group.protection.ratedCurrent ?? '—' }} А</text>
          </g>
          <g v-else :transform="`translate(${LEFT + groupIndex * COLUMN + COLUMN / 2 - 34} ${groupCenter(groupIndex) - 13})`" class="sl-device sl-unprotected">
            <rect width="68" height="26" rx="3" />
            <text x="34" y="17" text-anchor="middle" class="sl-node-label">нет защиты</text>
          </g>
          <text
            v-if="group.protection?.name"
            :x="LEFT + groupIndex * COLUMN + COLUMN / 2"
            :y="groupCenter(groupIndex) + 26"
            text-anchor="middle"
            class="sl-caption"
          >{{ trim(group.protection.name, CAPTION * 3) }}</text>

          <g v-for="(load, loadIndex) in group.loads" :key="load.circuitId">
            <path
              :d="`M ${LEFT + groupIndex * COLUMN + COLUMN / 2 + 34} ${groupCenter(groupIndex)} H ${LEFT + groupIndex * COLUMN + COLUMN / 2 + 46} V ${loadY(loadIndex) - 12}`"
              class="sl-branch"
            />
            <line
              :x1="LEFT + groupIndex * COLUMN + COLUMN / 2 + 46"
              :y1="loadY(loadIndex)"
              :x2="LEFT + groupIndex * COLUMN + COLUMN - 4"
              :y2="loadY(loadIndex)"
              class="sl-branch"
            />
            <circle :cx="LEFT + groupIndex * COLUMN + COLUMN / 2 + 40" :cy="loadY(loadIndex)" r="4" class="sl-node-dot" />
            <text
              :x="LEFT + groupIndex * COLUMN + COLUMN / 2 + 20"
              :y="loadY(loadIndex) + 13"
              text-anchor="middle"
              class="sl-load-label"
            >{{ trim(load.label, LOAD_LABEL) }}</text>
            <text
              :x="LEFT + groupIndex * COLUMN + COLUMN / 2 + 20"
              :y="loadY(loadIndex) + 23"
              text-anchor="middle"
              class="sl-caption sl-load-caption"
            >{{ load.current }} А · {{ load.crossSection }} мм²</text>
          </g>
        </g>
      </svg>

      <ul v-if="model.busbars.length" class="single-line-notes">
        <li v-for="bus in model.busbars" :key="bus.instanceId">
          Шина {{ bus.label }} ({{ bus.name || bus.bus }}, {{ bus.ratedCurrent ?? '—' }} А) питает подключённые аппараты.
        </li>
      </ul>
      <ul v-if="model.feeds.length" class="single-line-notes">
        <li v-for="feed in model.feeds" :key="`${feed.from.instanceId}-${feed.to.instanceId}-${feed.bus}`">
          {{ feed.from.label }} → {{ feed.to.label }} ({{ feed.bus }}): питание
          {{ feed.via === 'cascade' ? 'каскадом от другого аппарата' : feed.via === 'busbar' ? 'от шины аппарата' : 'от шины щита' }}.
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
