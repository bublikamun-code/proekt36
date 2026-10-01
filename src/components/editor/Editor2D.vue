<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getRowUsage, isDinDevice, placeProduct, resolveDeviceMove, resolveLayout } from '../../domain/layout'
import { getPanelGeometry } from '../../domain/panelGeometry'
import { useProjectStore } from '../../stores/project'
import { BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, usePreferencesStore } from '../../stores/preferences'
import { beginBoardDrag, cancelBoardDrag, dragPointer, dragSource, isDragging, setBoardDropHandler } from '../../composables/useBoardDrag'
import DeviceVisual from '../catalog/DeviceVisual.vue'
import type { PlacedDevice } from '../../domain/types'

const props = defineProps<{ focused: boolean }>()
const emit = defineEmits<{ 'toggle-focus': [] }>()

/** Identity of the not-yet-committed catalogue device shown during a drag. */
const PREVIEW_ID = 'drag-preview'
/** How far outside a row band the pointer may sit and still snap to that row. */
const ROW_SNAP_PX = 90
const EDGE_PX = 56
const SCROLL_STEP_PX = 16

interface PlacementPreview {
  row: number
  slot: number
  devices: PlacedDevice[]
  error?: string
}

const store = useProjectStore()
const { currentProject, definitions, selectedDeviceId } = storeToRefs(store)
const preferences = usePreferencesStore()
// storeToRefs hands back state only — the action stays on the store.
const { boardZoom } = storeToRefs(preferences)
const canvasScroll = ref<HTMLElement | null>(null)
const viewport = ref({ width: 0, height: 0 })
const preview = ref<PlacementPreview | null>(null)
const announcement = ref('')
let resizeObserver: ResizeObserver | null = null
let frame = 0
let rowElements: HTMLElement[] = []
let railElements: HTMLElement[] = []

const updateViewport = () => {
  const element = canvasScroll.value
  if (!element) return

  const style = window.getComputedStyle(element)
  const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  const verticalPadding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)

  viewport.value = {
    width: Math.max(0, element.clientWidth - horizontalPadding),
    height: Math.max(0, element.clientHeight - verticalPadding),
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(updateViewport)
  if (canvasScroll.value) {
    resizeObserver.observe(canvasScroll.value)
    // Not passive: the handler calls preventDefault, and a passive wheel listener would let the
    // page zoom the browser's own way on top of the board's.
    canvasScroll.value.addEventListener('wheel', onCanvasWheel, { passive: false })
  }
  updateViewport()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  canvasScroll.value?.removeEventListener('wheel', onCanvasWheel)
  setBoardDropHandler(null)
  window.cancelAnimationFrame(frame)
})

const geometry = computed(() => getPanelGeometry(currentProject.value, definitions.value))
const capacity = computed(() => geometry.value.capacity)
const slotIndexes = computed(() => Array.from({ length: capacity.value }, (_, index) => index))
const moduleWidth = computed(() => geometry.value.moduleWidthPx)
const railWidth = computed(() => geometry.value.railWidthPx)
const rows = computed(() => Array.from({ length: currentProject.value.settings.rows }, (_, index) => index))
const naturalWidth = computed(() => geometry.value.cabinetWidthPx)
const naturalHeight = computed(() => geometry.value.cabinetHeightPx)
/** Physical description of the current housing, taken from the catalog. */
const cabinetLabel = computed(() => {
  const cabinet = resolveLayout(currentProject.value).cabinet
  if (!cabinet) return `${geometry.value.cabinetWidthMm}×${geometry.value.cabinetHeightMm}×${geometry.value.cabinetDepthMm} мм · параметры вручную`
  const status = cabinet.verificationStatus === 'template' ? 'профиль' : cabinet.ip || ''
  return [cabinet.brand, status, `${cabinet.width}×${cabinet.height}×${cabinet.depth} мм`].filter(Boolean).join(' · ')
})
const fitScale = computed(() => {
  if (!props.focused || !viewport.value.width || !viewport.value.height) return 1
  return Math.min(1, viewport.value.width / naturalWidth.value, viewport.value.height / naturalHeight.value)
})
/**
 * Auto-fit and manual zoom are alternatives, not factors: a manual zoom is a plain multiple of the
 * board's natural size, so it does not silently shrink or grow when the side panels come and go.
 * `null` means the working area is still fitting the board by itself.
 */
const renderScale = computed(() => boardZoom.value ?? fitScale.value)
const fitted = computed(() => boardZoom.value === null)

const clampScale = (scale: number) => Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, Math.round(scale * 10) / 10))
/** Leaving auto-fit steps from whatever the board is showing now, so the first click does not jump. */
const changeZoom = (delta: number) => preferences.setBoardZoom(clampScale((boardZoom.value ?? renderScale.value) + delta))
const fitToView = () => preferences.setBoardZoom(null)

/**
 * Ctrl/⌘ + wheel zooms about the pointer. The board point under the cursor is held in place, which
 * needs the scroll offset recomputed for the new scale — without it the view jumps away from the
 * detail you were aiming at, and zooming in is only useful if you can aim.
 */
const onCanvasWheel = (event: WheelEvent) => {
  if (!event.ctrlKey && !event.metaKey) return
  const element = canvasScroll.value
  if (!element) return
  event.preventDefault()
  const before = renderScale.value
  const after = clampScale(before - Math.sign(event.deltaY) * 0.1)
  if (after === before) return
  const rect = element.getBoundingClientRect()
  const pointerX = event.clientX - rect.left
  const pointerY = event.clientY - rect.top
  const boardX = (pointerX + element.scrollLeft) / before
  const boardY = (pointerY + element.scrollTop) / before
  preferences.setBoardZoom(after)
  // The stage is centred by auto margins, so it has no fixed offset to add: the new scroll position
  // follows from where the board point now sits relative to the pointer.
  nextTick(() => {
    element.scrollLeft = boardX * after - pointerX
    element.scrollTop = boardY * after - pointerY
  })
}

const product = (id: string) => definitions.value.get(id)
const productWidth = (productId: string) => Math.max(1, Math.round(geometry.value.deviceWidthMm(productId) / geometry.value.modulePitchMm))
const rowUsage = (row: number) => getRowUsage(row, currentProject.value, definitions.value)
const rowHeight = (row: number) => geometry.value.rowHeightsPx[row] ?? geometry.value.rowHeightsPx[0] ?? 56
const rowStyle = (row: number) => ({ height: `${rowHeight(row)}px` })
const railStyle = (row: number) => ({ top: `${geometry.value.railOffsetPx(row)}px`, height: `${geometry.value.railHeightPx}px` })
const deviceStyle = (device: PlacedDevice) => ({
  left: `${device.slot * geometry.value.moduleWidthPx}px`,
  top: `${geometry.value.deviceOnRailOffsetPx(device.row, device.productId)}px`,
  width: `${geometry.value.deviceWidthPx(device.productId)}px`,
  height: `${geometry.value.deviceHeightPx(device.productId)}px`,
})
const rowLabelStyle = () => ({
  left: `${-geometry.value.railStartXPx}px`,
  width: `${Math.max(0, geometry.value.railStartXPx - 4)}px`,
})
const pitchLabel = computed(() => geometry.value.legacy ? `${geometry.value.modulePitchMm} мм · legacy` : `${geometry.value.modulePitchMm} мм`)
const devicePhaseClass = (device: PlacedDevice) => `phase-${device.phase}`
const deviceCategoryClass = (device: PlacedDevice) => `category-${product(device.productId)?.category || 'generic'}`

/**
 * While a drag is live the board renders the result of the move instead of the
 * stored layout, so the row on screen is literally the row the store will hold.
 */
const previewDevices = computed(() => preview.value?.devices ?? currentProject.value.devices)
const devicesInRow = (row: number) => previewDevices.value.filter((item) => item.row === row).sort((a, b) => a.slot - b.slot)
const occupiedSlots = computed(() => {
  const map = new Map<number, Set<number>>()
  for (const item of previewDevices.value) {
    if (!isDinDevice(item)) continue
    let slots = map.get(item.row)
    if (!slots) map.set(item.row, (slots = new Set()))
    for (let index = 0; index < productWidth(item.productId); index += 1) slots.add(item.slot + index)
  }
  return map
})
const slotOccupied = (row: number, slot: number) => occupiedSlots.value.get(row)?.has(slot) ?? false

/** Neighbours the pending move pushes aside, and the slots they travel through. */
const shiftingIds = computed(() => {
  const ids = new Set<string>()
  const result = preview.value
  const source = dragSource.value
  if (!result) return ids
  for (const item of result.devices) {
    if (item.instanceId === PREVIEW_ID || (source?.kind === 'placed' && item.instanceId === source.id)) continue
    const before = currentProject.value.devices.find((entry) => entry.instanceId === item.instanceId)
    if (before && before.slot !== item.slot) ids.add(item.instanceId)
  }
  return ids
})
const touchedSlots = computed(() => {
  const keys = new Set<string>()
  const result = preview.value
  const source = dragSource.value
  if (!result) return keys
  const mark = (row: number, from: number, to: number) => {
    for (let slot = Math.min(from, to); slot <= Math.max(from, to); slot += 1) keys.add(`${row}:${slot}`)
  }
  for (const device of result.devices) {
    const width = productWidth(device.productId)
    if (device.instanceId === PREVIEW_ID || (source?.kind === 'placed' && device.instanceId === source.id)) {
      mark(device.row, device.slot, device.slot + width - 1)
      continue
    }
    if (!shiftingIds.value.has(device.instanceId)) continue
    const before = currentProject.value.devices.find((entry) => entry.instanceId === device.instanceId)
    if (before) mark(device.row, before.slot, device.slot + width - 1)
  }
  return keys
})
const slotTouched = (row: number, slot: number) => touchedSlots.value.has(`${row}:${slot}`)

const cacheRowElements = () => {
  const root = canvasScroll.value
  rowElements = root ? Array.from(root.querySelectorAll<HTMLElement>('.din-row')) : []
  railElements = root ? Array.from(root.querySelectorAll<HTMLElement>('.din-rail')) : []
}

/** Geometry hit testing, so a mouse, a pen and a finger all land on the same module. */
const rowAtPoint = (y: number) => {
  let nearest = -1
  let distance = ROW_SNAP_PX + 1
  rowElements.forEach((element, index) => {
    const rect = element.getBoundingClientRect()
    if (y >= rect.top && y <= rect.bottom) { nearest = index; distance = -1; return }
    if (distance < 0) return
    const gap = y < rect.top ? rect.top - y : y - rect.bottom
    if (gap < distance) { distance = gap; nearest = index }
  })
  return nearest
}

const slotAtPoint = (x: number, rail: HTMLElement, width: number) => {
  const rect = rail.getBoundingClientRect()
  if (rect.width <= 0) return 0
  const module = rect.width / capacity.value
  return Math.max(0, Math.min(capacity.value - width, Math.floor((x - rect.left) / module)))
}

const computePreview = () => {
  preview.value = null
  const source = dragSource.value
  if (!source) return
  const row = rowAtPoint(dragPointer.value.y)
  const rail = railElements[row]
  if (row < 0 || !rail) return
  const slot = slotAtPoint(dragPointer.value.x, rail, source.width)
  if (source.kind === 'catalog') {
    const item = definitions.value.get(source.id)
    if (!item) return
    const result = placeProduct(currentProject.value.devices, item, row, slot, capacity.value, () => PREVIEW_ID, definitions.value)
    preview.value = { row, slot: result.slot, devices: result.devices, error: result.error }
    return
  }
  const result = resolveDeviceMove(currentProject.value.devices, source.id, row, slot, capacity.value, definitions.value)
  preview.value = { row: result.row, slot: result.slot, devices: result.devices, error: result.error }
}

const autoscroll = () => {
  const element = canvasScroll.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const { x, y } = dragPointer.value
  let dx = 0
  let dy = 0
  if (x < rect.left + EDGE_PX) dx = -SCROLL_STEP_PX
  else if (x > rect.right - EDGE_PX) dx = SCROLL_STEP_PX
  if (y < rect.top + EDGE_PX) dy = -SCROLL_STEP_PX
  else if (y > rect.bottom - EDGE_PX) dy = SCROLL_STEP_PX
  if (!dx && !dy) return
  element.scrollLeft += dx
  element.scrollTop += dy
}

const tick = () => {
  frame = 0
  if (!isDragging.value) return
  autoscroll()
  computePreview()
  frame = window.requestAnimationFrame(tick)
}

watch(isDragging, (value) => {
  window.cancelAnimationFrame(frame)
  frame = 0
  if (!value) { preview.value = null; return }
  cacheRowElements()
  frame = window.requestAnimationFrame(tick)
})

const commitDrop = () => {
  const source = dragSource.value
  const result = preview.value
  if (!source || !result || result.error) return
  if (source.kind === 'catalog') store.addDevice(source.id, result.row, result.slot)
  else store.moveDeviceById(source.id, result.row, result.slot)
}
setBoardDropHandler(commitDrop)

const startDeviceDrag = (event: PointerEvent, device: PlacedDevice) => {
  if (device.mount === 'busbar') return
  beginBoardDrag({ kind: 'placed', id: device.instanceId, width: productWidth(device.productId), fromRow: device.row, fromSlot: device.slot }, event)
}

const previewLabel = computed(() => {
  const result = preview.value
  if (!result) return ''
  return result.error ?? `модуль ${result.slot + 1}`
})
const previewStyle = computed(() => {
  const result = preview.value
  const source = dragSource.value
  if (!result || !source) return {}
  const ghost = result.devices.find((item) => item.instanceId === (source.kind === 'catalog' ? PREVIEW_ID : source.id))
  const productId = ghost?.productId ?? ''
  return {
    left: `${(ghost?.slot ?? result.slot) * geometry.value.moduleWidthPx}px`,
    top: productId ? `${geometry.value.deviceOnRailOffsetPx(result.row, productId)}px` : '0px',
    width: `${source.width * geometry.value.moduleWidthPx}px`,
    height: productId ? `${geometry.value.deviceHeightPx(productId)}px` : '0px',
  }
})

/** An empty slot only places the product the user actually picked in the catalogue. */
const placeAtEnd = (row: number, slot: number) => {
  const productId = store.selectedProduct?.id
  if (!productId) { store.notify('Выберите аппарат в каталоге, чтобы вставить его в ряд.', 'error'); return }
  store.addDevice(productId, row, slot)
}

const announceDevice = (device: PlacedDevice) => {
  announcement.value = `${device.address}: ряд ${device.row + 1}, модуль ${device.slot + 1}`
}

const onDeviceKeydown = (event: KeyboardEvent, device: PlacedDevice) => {
  const step = event.shiftKey ? 5 : 1
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [0, -step],
    ArrowRight: [0, step],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  }
  const delta = moves[event.key]
  if (!delta || device.mount === 'busbar') return
  event.preventDefault()
  store.selectedDeviceId = device.instanceId
  store.nudgeSelectedDevice(delta[0], delta[1])
  const moved = currentProject.value.devices.find((item) => item.instanceId === device.instanceId)
  if (moved) announceDevice(moved)
}

const onBoardKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  cancelBoardDrag()
  preview.value = null
}

const wirePaths = computed(() => {
  const paths: Array<{ id: string; d: string; bus: 'L' | 'N' | 'PE'; color: string; thickness: number; label: string }> = []
  const busX: Record<'L' | 'N' | 'PE', number> = { L: 3, N: 7, PE: 11 }
  // One lookup table per recomputation instead of a scan per wire. The schema allows 2000
  // connections over 500 devices, and a drag re-runs this on every frame, so the nested scan was
  // a million comparisons per frame on a large board.
  const devicesById = new Map(currentProject.value.devices.map((device) => [device.instanceId, device]))
  for (const connection of currentProject.value.connections ?? []) {
    const target = devicesById.get(connection.toDeviceId)
    if (!target) continue
    const width = geometry.value.deviceWidthPx(target.productId)
    const targetX = geometry.value.railStartXPx + (target.slot * geometry.value.moduleWidthPx) + width / 2
    const targetY = geometry.value.rowTopPx[target.row] + geometry.value.deviceHeightPx(target.productId) / 2
    const sourceX = busX[connection.fromBus]
    const sourceY = targetY - geometry.value.railHeightPx / 2
    const bendX = Math.max(sourceX + 8, targetX - 8)
    const d = `M ${sourceX} ${sourceY} H ${bendX} V ${targetY} H ${targetX}`
    paths.push({ id: connection.id, d, bus: connection.fromBus, color: connection.color || '#c65c3b', thickness: connection.thickness || 2, label: connection.label })
  }
  return paths
})
</script>

<template>
  <section class="editor-2d" :class="{ 'is-dragging': isDragging }" aria-label="Схема электрощита" @keydown="onBoardKeydown">
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <div class="canvas-toolbar">
      <div class="view-caption"><span class="live-dot"></span><span>Схема щита</span><b>{{ geometry.cabinetWidthMm }} × {{ geometry.cabinetHeightMm }} × {{ geometry.cabinetDepthMm }} мм</b><b class="canvas-spec">{{ geometry.capacity }} мод./рейка · {{ pitchLabel }}</b></div>
      <div class="canvas-tools">
        <button class="panel-toggle" data-panel-toggle :aria-pressed="focused" :aria-label="focused ? 'Показать боковые панели' : 'Скрыть боковые панели'" @click="emit('toggle-focus')">{{ focused ? 'Панели' : 'Только щит' }}</button>
        <div class="zoom-controls" role="group" aria-label="Масштаб схемы">
          <button aria-label="Уменьшить масштаб" @click="changeZoom(-0.1)">−</button>
          <span class="mono">{{ Math.round(renderScale * 100) }}%</span>
          <button aria-label="Увеличить масштаб" @click="changeZoom(0.1)">＋</button>
          <button class="fit-toggle" :class="{ active: fitted }" :aria-pressed="fitted" title="Вписать схему в рабочую область" @click="fitToView">Вписать</button>
        </div>
      </div>
    </div>

    <div ref="canvasScroll" class="canvas-scroll">
      <div class="canvas-stage" :style="{ width: `${naturalWidth * renderScale}px`, minHeight: `${naturalHeight * renderScale}px` }">
        <div class="cabinet" :style="{ width: `${naturalWidth}px`, minHeight: `${naturalHeight}px`, transform: `scale(${renderScale})` }">
          <div class="cabinet-wall wall-left"></div><div class="cabinet-wall wall-right"></div>
          <div class="mounting-plate" :style="{ left: `${geometry.plateInsetPx}px`, top: `${geometry.plateTopPx}px`, width: `${geometry.plateWidthPx}px`, height: `${geometry.plateHeightPx}px` }">
            <span v-for="fastener in 4" :key="fastener" class="plate-fastener" aria-hidden="true"></span>
            <div class="bus-bars" aria-hidden="true"><span class="bus-zone-label">ШИНЫ</span><span class="bus-l"></span><span class="bus-n"></span><span class="bus-pe"></span><small>L</small><small>N</small><small>PE</small></div>
            <div class="din-rows" :style="{ width: `${railWidth}px`, marginLeft: `${geometry.railStartXPx}px`, gap: `${geometry.rowGapPx}px` }">
              <div v-for="row in rows" :key="row" class="din-row" :class="{ 'drag-over': preview?.row === row, 'drop-blocked': preview?.row === row && Boolean(preview?.error) }" :style="rowStyle(row)">
                <div class="row-label" :style="rowLabelStyle()"><b>{{ String(row + 1).padStart(2, '0') }}</b><small>{{ rowUsage(row).used }}/{{ capacity }}</small></div>
                <div class="din-rail" :style="railStyle(row)">
                  <button v-for="slot in slotIndexes" :key="slot" class="slot-cell" :class="{ occupied: slotOccupied(row, slot), free: !slotOccupied(row, slot), shifted: slotTouched(row, slot) }" :data-slot="slot + 1" :data-slot-state="slotTouched(row, slot) ? 'shifted' : (slotOccupied(row, slot) ? 'occupied' : 'free')" :style="{ width: `${moduleWidth}px` }" :aria-label="`Ряд ${row + 1}, модуль ${slot + 1}. ${slotOccupied(row, slot) ? 'Занят. Вставить и сдвинуть соседние' : 'Свободен. Добавить устройство'}`" @click="placeAtEnd(row, slot)"></button>
                  <div v-if="preview?.row === row" class="drop-preview" :class="{ blocked: Boolean(preview.error) }" :style="previewStyle"><span>{{ previewLabel }}</span></div>
                  <button v-for="device in devicesInRow(row)" :key="device.instanceId" class="placed-device" :class="[devicePhaseClass(device), deviceCategoryClass(device), { selected: selectedDeviceId === device.instanceId, dragging: device.instanceId === (dragSource?.kind === 'placed' ? dragSource.id : PREVIEW_ID), shifting: shiftingIds.has(device.instanceId), 'is-preview': device.instanceId === PREVIEW_ID, 'busbar-device': device.mount === 'busbar', 'missing-product': !product(device.productId) }]" :data-instance-id="device.instanceId" :data-phase="device.phase" :data-mount="device.mount || 'din'" :data-footprint-modules="productWidth(device.productId)" :data-width-mm="geometry.deviceWidthMm(device.productId)" :style="deviceStyle(device)" :aria-label="`${device.address}, ${product(device.productId)?.name ?? 'товар отсутствует в каталоге'}`" :aria-grabbed="isDragging && device.instanceId === (dragSource?.kind === 'placed' ? dragSource.id : '')" @click="store.selectedDeviceId = device.instanceId" @pointerdown="startDeviceDrag($event, device)" @keydown="onDeviceKeydown($event, device)">
                    <template v-if="product(device.productId)">
                      <DeviceVisual :product="product(device.productId)!" :width="Math.max(18, geometry.deviceWidthPx(device.productId))" />
                      <b>{{ device.address }}</b><small>{{ product(device.productId)?.series || `${product(device.productId)?.ratedCurrent}A` }}</small>
                    </template>
                    <template v-else>
                      <span class="missing-mark" aria-hidden="true">?</span>
                      <b>{{ device.address }}</b><small>нет в каталоге</small>
                    </template>
                  </button>
                </div>
                <div class="row-capacity" :class="{ 'is-full': rowUsage(row).percent >= 100 }" role="img" :aria-label="`Ряд ${row + 1}: занято ${rowUsage(row).used} из ${capacity} модулей${rowUsage(row).percent >= 100 ? ', ряд заполнен' : ''}`"><span :style="{ height: `${rowUsage(row).percent}%` }"></span></div>
              </div>
            </div>
            <svg class="wires" :viewBox="`0 0 ${geometry.plateWidthPx} ${geometry.plateHeightPx}`" aria-hidden="true"><path v-for="path in wirePaths" :key="path.id" :data-connection-id="path.id" :d="path.d" :class="`wire-${path.bus.toLowerCase()}`" :stroke="path.color" :style="{ strokeWidth: `${path.thickness}px` }"><title>{{ path.label }}</title></path></svg>
          </div>
          <div class="cabinet-label"><span>{{ currentProject.name }}</span><small>{{ cabinetLabel }}</small></div>
        </div>
      </div>
    </div>
    <div class="canvas-legend"><span><i class="legend-l"></i>L</span><span><i class="legend-n"></i>N</span><span><i class="legend-pe"></i>PE</span><span><i class="legend-phase phase-1"></i>Фаза 1</span><span><i class="legend-phase phase-2"></i>Фаза 2</span><span><i class="legend-phase phase-3"></i>Фаза 3</span><span class="legend-note">Перетащите аппарат в ряд — соседи сдвинутся сами. Стрелки двигают выбранный аппарат.</span><span class="mono">{{ capacity }} мод./ряд</span></div>
  </section>
</template>
