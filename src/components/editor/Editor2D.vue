<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getRowUsage, isDinDevice, placeProduct, resolveDeviceMove, resolveLayout } from '../../domain/layout'
import { getPanelGeometry } from '../../domain/panelGeometry'
import { routeBoard, terminalTargets as terminalTargetsOf, wireFrameFromGeometry } from '../../domain/wireRouting'
import type { WirePoint } from '../../domain/wireRouting'
import { conductorStyle, wireClass } from '../../domain/wireDrawing'
import { terminalKey } from '../../domain/terminals'
import type { TerminalRef } from '../../domain/terminals'
import type { TerminalTarget } from '../../domain/wireRouting'
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

/**
 * Publishes the viewport top of the board as a CSS variable. The floating panels and the
 * scrim anchor to it instead of a hardcoded pixel count, so any chrome added above the
 * editor (workspace nav, tabs) keeps the toolbar band clickable without touching this file.
 */
const syncPanelsTop = () => {
  const element = canvasScroll.value
  if (!element) return
  document.documentElement.style.setProperty('--editor-panels-top', `${Math.round(element.getBoundingClientRect().top)}px`)
}
// The board's top moves when the focus mode toggles chrome above it (the hints card),
// so the anchor measured at mount goes stale until re-measured after the layout settles.
watch(() => props.focused, () => { void nextTick(syncPanelsTop) })

onMounted(() => {
  resizeObserver = new ResizeObserver(updateViewport)
  if (canvasScroll.value) {
    resizeObserver.observe(canvasScroll.value)
    // Not passive: the handler calls preventDefault, and a passive wheel listener would let the
    // page zoom the browser's own way on top of the board's.
    canvasScroll.value.addEventListener('wheel', onCanvasWheel, { passive: false })
  }
  updateViewport()
  requestAnimationFrame(syncPanelsTop)
  window.addEventListener('resize', syncPanelsTop)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  canvasScroll.value?.removeEventListener('wheel', onCanvasWheel)
  window.removeEventListener('resize', syncPanelsTop)
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

// Rounding lives only in setBoardZoom; a second rounding here fought the store's and the
// recorded value could disagree with the zoom label.
const clampScale = (scale: number) => Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, scale))
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
const productModel = (id: string) => {
  const item = product(id)
  return item ? store.resolveProductModel(item) : undefined
}
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
  // The board renders full-bleed behind the floating panels, so a pointer over the
  // catalogue or the inspector is geometrically inside the canvas edge band. That is
  // not a request to scroll the board: it would shift the rails away from under a
  // drop that is still being aimed.
  const overOverlay = document.elementFromPoint(x, y)?.closest('.catalog-panel, .inspector-panel, .editor-tabs, .app-header, .mobile-nav')
  if (overOverlay) return
  let dx = 0
  let dy = 0
  if (x < rect.left + EDGE_PX) dx = -SCROLL_STEP_PX
  else if (x > rect.right - EDGE_PX) dx = SCROLL_STEP_PX
  // A pointer that already snaps to a rail is aiming a live drop; scrolling the board
  // now would slide the rails away from under it. Vertical autoscroll only serves a
  // pointer hunting for a rail that is still off screen.
  if (rowAtPoint(y) < 0) {
    if (y < rect.top + EDGE_PX) dy = -SCROLL_STEP_PX
    else if (y > rect.bottom - EDGE_PX) dy = SCROLL_STEP_PX
  }
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
  if (device.mount === 'busbar' || wireMode.value) return
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
  const target = event.target as HTMLElement | null
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (event.key === 'Escape') {
    // Escape unwinds one layer at a time: a half-drawn wire first, then the tool itself.
    if (wireStart.value) { cancelWire(); return }
    if (wireMode.value) { toggleWireMode(false); return }
    cancelBoardDrag()
    preview.value = null
    return
  }
  if (typing) return
  // W is the shortcut for the wire tool, the way every drawing program labels its line tool.
  if (event.key.toLowerCase() === 'w' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    toggleWireMode()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && store.selectedConnectionId) {
    event.preventDefault()
    store.deleteConnection(store.selectedConnectionId)
  }
}

// The router works in plate-local millimetres, so a wire no longer drifts by the plate offset
// the old hand-rolled paths carried: their Y came from the cabinet top while the overlay's
// viewBox starts at the plate.

/** Core and casing stroke widths, and the override colour, come from the shared drawing module. */
const coreStyle = (path: { customColor: boolean; color: string; thickness: number }) => conductorStyle(path, 'core')
const casingStyle = (path: { customColor: boolean; color: string; thickness: number }) => conductorStyle(path, 'casing')

// Markings crowd a dense board, so the drawing keeps a switch that turns them off.
const showWireLabels = ref(true)

/**
 * The wire tool is two clicks: a start clamp, then an end clamp. The pending end is kept as a
 * plain terminal ref rather than as a rendered connection, so Escape can drop it without
 * touching undo history — nothing is in the project until the second click lands.
 */
/** Pole counts a stocked comb comes in; the row button offers all of them rather than guessing one. */
const COMB_POLES = [1, 2, 3, 4] as const

const boardRoot = ref<HTMLElement | null>(null)
const wireMode = ref(false)
const wireStart = ref<TerminalRef | null>(null)
const wireCursor = ref<WirePoint | null>(null)

const boardFrame = computed(() => wireFrameFromGeometry(geometry.value))
const board = computed(() => routeBoard(currentProject.value, definitions.value, boardFrame.value))
const wirePaths = computed(() => board.value.wires)
const terminalTargets = computed(() => terminalTargetsOf(currentProject.value, definitions.value, boardFrame.value))

/** The stretch drawn from the pending start to the pointer, in the same space as the wires. */
const wirePreviewPath = computed(() => {
  if (!wireStart.value || !wireCursor.value) return ''
  const start = terminalTargets.value.find((target) => target.key === terminalKey(wireStart.value as TerminalRef))
  if (!start) return ''
  const end = wireCursor.value
  // Orthogonal, like the real thing: a diagonal rubber band would promise a route the router
  // never draws, and the user would be aiming at a path that does not exist.
  const bendX = end.x
  return `M ${start.x} ${start.y} L ${start.x} ${end.y} L ${bendX} ${end.y}`
})

const startWire = (target: TerminalTarget) => {
  if (target.occupied) { store.notify(`Клемма ${target.label} уже занята`, 'error'); return }
  wireStart.value = { deviceId: target.deviceId, pole: target.pole, side: target.side }
  announcement.value = `Провод: начало ${target.label}. Выберите клемму назначения`
}

/** Second click: a bus bar feeds one clamp, a clamp feeds another. */
const finishWire = (target: TerminalTarget | { busId: string; label: string; x: number; y: number }) => {
  const from = wireStart.value
  if (!from) return
  const ok = 'busId' in target ? store.addBusWire(target.busId, { deviceId: from.deviceId, pole: from.pole, side: from.side })
    : store.addWire(from, { deviceId: target.deviceId, pole: target.pole, side: target.side })
  if (ok) announcement.value = 'Провод добавлен'
  wireStart.value = null
  wireCursor.value = null
}

const cancelWire = () => {
  if (!wireMode.value && !wireStart.value) return
  wireStart.value = null
  wireCursor.value = null
  announcement.value = ''
}

const toggleWireMode = (value = !wireMode.value) => {
  wireMode.value = value
  cancelWire()
  // The shortcut only works if the board can take the keystroke, and the toolbar button keeps
  // focus after a click, so focus moves here explicitly when the tool comes on.
  if (value) { boardRoot.value?.focus(); announcement.value = 'Инструмент «Провод»: выберите клемму начала' }
}

/** Pointer position in plate pixels, so the rubber band shares the overlay's coordinate space. */
const onWirePointerMove = (event: PointerEvent) => {
  if (!wireStart.value) return
  const plate = (event.currentTarget as Element).getBoundingClientRect()
  wireCursor.value = {
    x: (event.clientX - plate.left) / renderScale.value,
    y: (event.clientY - plate.top) / renderScale.value,
  }
}

const selectWire = (id: string) => {
  if (wireMode.value) return
  store.selectConnection(id)
  const connection = currentProject.value.connections.find((item) => item.id === id)
  if (connection) announcement.value = `Выбран провод: ${connection.label || connection.id}`
}

</script>

<template>
  <section ref="boardRoot" class="editor-2d" tabindex="-1" :class="{ 'is-dragging': isDragging, 'wire-tool': wireMode }" aria-label="Схема электрощита" @keydown="onBoardKeydown">
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <div class="canvas-toolbar">
      <div class="view-caption"><span class="live-dot"></span><span>Схема щита</span><b>{{ geometry.cabinetWidthMm }} × {{ geometry.cabinetHeightMm }} × {{ geometry.cabinetDepthMm }} мм</b><b class="canvas-spec">{{ geometry.capacity }} мод./рейка · {{ pitchLabel }}</b></div>
      <div class="canvas-tools">
        <div class="tool-segment" role="group" aria-label="Инструмент доски">
          <button data-tool="select" :class="{ active: !wireMode }" :aria-pressed="!wireMode" @click="toggleWireMode(false)">Выбор</button>
          <button data-tool="wire" :class="{ active: wireMode }" :aria-pressed="wireMode" @click="toggleWireMode(true)">Провод <kbd>W</kbd></button>
        </div>
        <button class="panel-toggle" data-panel-toggle :aria-pressed="focused" :aria-label="focused ? 'Показать боковые панели' : 'Скрыть боковые панели'" @click="emit('toggle-focus')">{{ focused ? 'Панели' : 'Только щит' }}</button>
        <button class="panel-toggle" data-wire-labels :aria-pressed="showWireLabels" :aria-label="showWireLabels ? 'Скрыть подписи проводов' : 'Показать подписи проводов'" @click="showWireLabels = !showWireLabels">{{ showWireLabels ? 'Подписи' : 'Без подписей' }}</button>
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
            <div class="din-rows" :style="{ width: `${railWidth}px`, marginLeft: `${geometry.railStartXPx}px`, marginTop: `${geometry.plateWireBandPx}px`, gap: `${geometry.rowGapPx}px` }">
              <div v-for="row in rows" :key="row" class="din-row" :class="{ 'drag-over': preview?.row === row, 'drop-blocked': preview?.row === row && Boolean(preview?.error) }" :style="rowStyle(row)">
                <div class="row-label" :style="rowLabelStyle()"><b>{{ String(row + 1).padStart(2, '0') }}</b><small>{{ rowUsage(row).used }}/{{ capacity }}</small><div class="row-comb-add"><span>Гребёнка</span><button v-for="poles in COMB_POLES" :key="poles" :data-add-comb="`${row}-${poles}`" :disabled="!rowUsage(row).used" :aria-label="`Добавить гребёнку ${poles}P в ряд ${row + 1}`" :title="`Гребёнка ${poles}P над рядом`" @click.stop="store.addComb(row, poles)">{{ poles }}P</button></div></div>
                <div class="din-rail" :style="railStyle(row)">
                  <button v-for="slot in slotIndexes" :key="slot" class="slot-cell" :class="{ occupied: slotOccupied(row, slot), free: !slotOccupied(row, slot), shifted: slotTouched(row, slot) }" :data-slot="slot + 1" :data-slot-state="slotTouched(row, slot) ? 'shifted' : (slotOccupied(row, slot) ? 'occupied' : 'free')" :style="{ width: `${moduleWidth}px` }" :aria-label="`Ряд ${row + 1}, модуль ${slot + 1}. ${slotOccupied(row, slot) ? 'Занят. Вставить и сдвинуть соседние' : 'Свободен. Добавить устройство'}`" @click="placeAtEnd(row, slot)"></button>
                  <div v-if="preview?.row === row" class="drop-preview" :class="{ blocked: Boolean(preview.error) }" :style="previewStyle"><span>{{ previewLabel }}</span></div>
                  <button v-for="device in devicesInRow(row)" :key="device.instanceId" class="placed-device" :class="[devicePhaseClass(device), deviceCategoryClass(device), { selected: selectedDeviceId === device.instanceId, dragging: device.instanceId === (dragSource?.kind === 'placed' ? dragSource.id : PREVIEW_ID), shifting: shiftingIds.has(device.instanceId), 'is-preview': device.instanceId === PREVIEW_ID, 'busbar-device': device.mount === 'busbar', 'missing-product': !product(device.productId) }]" :data-instance-id="device.instanceId" :data-phase="device.phase" :data-mount="device.mount || 'din'" :data-footprint-modules="productWidth(device.productId)" :data-width-mm="geometry.deviceWidthMm(device.productId)" :style="deviceStyle(device)" :aria-label="`${device.address}, ${product(device.productId)?.name ?? 'товар отсутствует в каталоге'}`" :aria-grabbed="isDragging && device.instanceId === (dragSource?.kind === 'placed' ? dragSource.id : '')" @click="!wireMode && (store.selectedDeviceId = device.instanceId)" @pointerdown="startDeviceDrag($event, device)" @keydown="onDeviceKeydown($event, device)">
                    <template v-if="product(device.productId)">
                      <DeviceVisual :product="product(device.productId)!" :model="productModel(device.productId)" :width="Math.max(18, geometry.deviceWidthPx(device.productId))" />
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
            <svg class="wires" :class="{ 'labels-off': !showWireLabels }" :viewBox="`0 0 ${geometry.plateWidthPx} ${geometry.plateHeightPx}`" aria-hidden="true">
              <g class="wire-combs">
                  <g v-for="comb in board.combs" :key="comb.id" class="comb" :class="{ starved: comb.starved }" :data-comb-id="comb.id" :data-comb-row="comb.row" :data-comb-poles="comb.poles">
                  <rect class="comb-bar" :x="comb.x" :y="comb.y" :width="comb.width" :height="comb.height" rx="1" />
                  <path v-for="(tooth, index) in comb.teeth" :key="index" class="comb-tooth" :d="`M ${tooth.x} ${comb.y} V ${tooth.y}`" />
                </g>
              </g>
              <g class="wire-buses">
                <g v-for="bus in board.buses" :key="bus.id" :data-bus-id="bus.id" :data-bus-kind="bus.kind">
                  <rect :x="bus.x" :y="bus.y" :width="bus.width" :height="bus.height" rx="1.5" :class="`bus-bar bus-${bus.kind.toLowerCase()}`" />
                  <text :x="bus.x + 3" :y="bus.y + bus.height * 0.78" font-size="4" font-weight="700" :class="`bus-tag bus-tag-${bus.kind.toLowerCase()}`">{{ bus.label }}</text>
                </g>
              </g>
              <!-- Casing first, core on top: one pass per wire so every conductor keeps its own
                   outline instead of merging with its neighbours where they run side by side. -->
              <path v-for="path in wirePaths" :key="`${path.id}-casing`" :d="path.d" :class="`wire-casing wire-${wireClass(path)}`" :style="casingStyle(path)" />
              <path v-for="path in wirePaths" :key="`${path.id}-core`" :data-connection-id="path.id" :d="path.d" :class="`wire-core wire-${wireClass(path)}${path.circuitId && path.circuitId === store.selectedLineId ? ' line-active' : ''}`" :style="coreStyle(path)"><title>{{ path.label }}</title></path>
              <g class="wire-labels">
                <text v-for="path in wirePaths" :key="`${path.id}-label`" :x="path.labelAt.x" :y="path.labelAt.y" class="wire-label">{{ path.label }}</text>
              </g>
              <path v-if="wirePreviewPath" class="wire-preview" :d="wirePreviewPath" />
            </svg>
            <!-- The hit layer sits over the drawing rather than inside it: the drawing itself is
                 aria-hidden decoration, and a transparent stroke is the only way to make a 0.8px
                 conductor clickable at all. Terminal targets come from the router, so a click and
                 the wire it will create land on the same screw. -->
            <svg class="wire-hits" :class="{ active: wireMode }" :viewBox="`0 0 ${geometry.plateWidthPx} ${geometry.plateHeightPx}`" aria-hidden="true" @pointermove="onWirePointerMove" @pointerleave="wireCursor = null">
              <path v-for="path in wirePaths" :key="`hit-${path.id}`" class="wire-hit" :class="{ selected: store.selectedConnectionId === path.id }" :d="path.d" :data-connection-id="path.id" @click="selectWire(path.id)" />
              <template v-if="wireMode">
                <g class="wire-port-hits">
                  <circle v-for="target in terminalTargets" :key="target.key" class="wire-port" :class="{ taken: target.occupied, source: wireStart && wireStart.deviceId === target.deviceId && wireStart.pole === target.pole && wireStart.side === target.side }" :cx="target.x" :cy="target.y" r="2.6" :data-terminal="target.key" :data-terminal-state="target.occupied ? 'taken' : 'free'" :data-terminal-label="target.label" @click.stop="wireStart ? finishWire(target) : startWire(target)" />
                </g>
                <g class="wire-port-hits">
                  <rect v-for="bus in board.buses" :key="`bus-${bus.id}`" class="wire-bus-port" :x="bus.x + 4" :y="bus.y" :width="Math.max(0, bus.width - 8)" :height="bus.height" :data-terminal-bus="bus.id" :data-terminal-bus-kind="bus.kind" :data-terminal-label="bus.label" @click.stop="wireStart && finishWire({ busId: bus.id, label: bus.label, x: bus.x, y: bus.y })" />
                </g>
              </template>
            </svg>
          </div>
          <div class="cabinet-label"><span>{{ currentProject.name }}</span><small>{{ cabinetLabel }}</small></div>
        </div>
      </div>
    </div>
    <div class="canvas-legend"><span><i class="legend-l"></i>L</span><span><i class="legend-n"></i>N</span><span><i class="legend-pe"></i>PE</span><span><i class="legend-phase phase-1"></i>Фаза 1</span><span><i class="legend-phase phase-2"></i>Фаза 2</span><span><i class="legend-phase phase-3"></i>Фаза 3</span><span class="legend-note">Перетащите аппарат в ряд — соседи сдвинутся сами. Стрелки двигают выбранный аппарат.</span><span class="mono">{{ capacity }} мод./ряд</span></div>
  </section>
</template>
