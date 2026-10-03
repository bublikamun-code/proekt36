<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildBoardScene, type BoardScene as BoardSpace } from '../../domain/boardScene'
import { getRowCapacity, placeProduct, resolveDeviceMove } from '../../domain/layout'
import { routeWire, wireColor } from '../../domain/wiring'
import { validateProject } from '../../domain/validation'
import { beginBoardDrag, dragPointer, dragSource, isDragging, setBoardDropHandler } from '../../composables/useBoardDrag'
import DeviceChassis from '../catalog/deviceFace/DeviceChassis.vue'
import DeviceFace from '../catalog/deviceFace/DeviceFace.vue'
import { useProjectStore } from '../../stores/project'
import type { BusType, ValidationIssue } from '../../domain/types'

/**
 * The board, drawn as one SVG.
 *
 * Every coordinate in here is a millimetre of the enclosure, and the only conversion to pixels
 * happens once, on the `viewBox` scale. The editor this replaces mounted a separate `<svg>` inside
 * every device and scaled it to a pixel width, so the board had two scales on screen at once and
 * nothing drawn on them could be relied on to line up. Here a clamp and the wire that lands in it
 * are two numbers about the same millimetre.
 */
const props = defineProps<{ scale?: number; tool?: BoardTool }>()
const emit = defineEmits<{ 'update:tool': [BoardTool] }>()

/**
 * What a click on the board means.
 */
export type BoardTool = 'select' | 'address' | 'wire'
const tool = computed<BoardTool>(() => props.tool ?? 'select')

const store = useProjectStore()
const scene = computed<BoardSpace>(() => buildBoardScene(store.currentProject, store.definitions))

/**
 * The board is drawn in millimetres, so at 1:1 it is a 300-pixel rectangle sitting in the left
 * corner of a wide panel — which is exactly what it looked like before the container was measured.
 * The zoom the user asks for is a multiple of "fits the space available", not of millimetres.
 */
const canvas = ref<HTMLElement | null>(null)
const fitScale = ref(1)
let observer: ResizeObserver | undefined

const measure = () => {
  const element = canvas.value
  if (!element) return
  // clientWidth counts the padding, and the padding is exactly the room reserved for the side
  // panels that overlay this canvas. Measuring the border box would draw the board underneath
  // them — reachable only where a panel happens not to cover it.
  const style = window.getComputedStyle(element)
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
  const width = element.clientWidth - (Number.isFinite(padding) ? padding : 0)
  if (width > 0 && scene.value.width > 0) fitScale.value = width / scene.value.width
}

onMounted(() => {
  measure()
  if (canvas.value) {
    observer = new ResizeObserver(measure)
    observer.observe(canvas.value)
  }
})

onBeforeUnmount(() => observer?.disconnect())

const scale = computed(() => Math.max(0.4, Math.min(6, (props.scale ?? 1) * fitScale.value)))

const busColor: Record<BusType, string> = { L: '#a44d37', N: '#5f7f9c', PE: '#47a067' }

const faceOf = (device: BoardSpace['devices'][number]) => device.face
/**
 * Drop targets and the preview, computed in board millimetres.
 *
 * The scene is drawn in millimetres and the browser reports the pointer in screen pixels, so every
 * drop is resolved by inverting the one transform the SVG has — the same single conversion the
 * drawing uses. The old editor hit-tested DOM elements per module; here the rail already says where
 * module 5 starts, so there is nothing to look up and nothing that can drift out of step with the
 * picture.
 */
const preview = ref<{ row: number; slot: number; width: number; error?: string } | null>(null)

const svgElement = ref<SVGSVGElement | null>(null)

const pointerToBoard = () => {
  const svg = svgElement.value
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const point = new DOMPoint(dragPointer.value.x, dragPointer.value.y).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

const computePreview = () => {
  const pointer = pointerToBoard()
  if (!pointer || !dragSource.value) { preview.value = null; return }
  const { railStartX, modulePitch, rails } = scene.value

  // The rail band is the row. A pointer above the first rail or below the last one is not a drop.
  const rail = rails.find((candidate) => pointer.y >= candidate.y - ROW_GRAB_MM && pointer.y <= candidate.y + candidate.height + ROW_GRAB_MM)
  if (!rail) { preview.value = null; return }

  const source = dragSource.value
  const width = source.width || 1
  const rawSlot = Math.round((pointer.x - railStartX) / modulePitch)
  const slot = Math.max(0, Math.min(rawSlot, scene.value.capacity - width))
  const devices = store.currentProject.devices

  // The same two functions the old editor validates with, so a move that fails here would have
  // failed there for the same reason.
  const result = source.kind === 'catalog'
    ? placeProduct(devices, store.definitions.get(source.id)!, rail.row, slot, getRowCapacity(store.currentProject), () => '', store.definitions)
    : resolveDeviceMove(devices, source.id, rail.row, slot, getRowCapacity(store.currentProject), store.definitions)

  preview.value = { row: rail.row, slot, width, error: result.error }
}

const commitDrop = () => {
  const source = dragSource.value
  const target = preview.value
  if (!source || !target || target.error) return
  if (source.kind === 'catalog') store.addDevice(source.id, target.row, target.slot)
  else store.moveDeviceById(source.id, target.row, target.slot)
}

setBoardDropHandler(commitDrop)

watch(isDragging, (dragging) => {
  if (!dragging) { preview.value = null; return }
  frame = window.requestAnimationFrame(tick)
})

let frame = 0
const tick = () => {
  frame = 0
  if (!isDragging.value) return
  computePreview()
  frame = window.requestAnimationFrame(tick)
}

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frame)
  setBoardDropHandler(null)
})

// Escape is handled by the view, which owns the keyboard, so the tool is asked to drop a
// half-drawn wire from there rather than listening to the window itself.
const cancelWire = () => clearWire()


/** How far above and below a rail a pointer still counts as pointing at it, in millimetres. */
const ROW_GRAB_MM = 10

/**
 * The address editor, positioned in the same millimetres as the device it belongs to.
 *
 * It is an ordinary input over the board rather than a prompt or a panel field: the person is
 * correcting a label on the panel, and the label is where their hand already is. Nothing is written
 * until Enter, so a click that was a mistake leaves the project untouched.
 */
type BoardEditor =
  | { kind: 'address'; instanceId: string; x: number; y: number; value: string }
  | { kind: 'load'; instanceId: string; circuitId: string; x: number; y: number; value: string }
const editing = ref<BoardEditor | null>(null)
const addressInput = ref<HTMLInputElement | null>(null)

const deviceById = (instanceId: string) => scene.value.devices.find((device) => device.instanceId === instanceId)

/**
 * The wire tool: click a terminal, click another, a wire appears.
 *
 * Terminals already know their own bus and their position in board millimetres, so the tool has
 * nothing to guess and nothing to look up. The one decision left open by the plan — whether a wire
 * records the bus or an explicit terminal index — is settled in favour of the bus here, because the
 * two produce the same interaction and differ only in what is written to the project.
 */
const pendingWire = ref<WireEnd>(null)
const hoveredWire = ref<WireEnd>(null)
const wireRefusal = ref('')

/**
 * What the board says about the project, straight from the validator.
 *
 * The board draws the validator's verdict and nothing of its own: a second set of rules here would
 * quietly disagree with the one the report and the printout use, and a panel that is louder than
 * its own export is a panel nobody trusts.
 */
const issues = computed(() => validateProject(store.currentProject, store.definitions))
const issuesByDevice = computed(() => {
  const map = new Map<string, ValidationIssue[]>()
  for (const entry of issues.value) {
    if (!entry.deviceId) continue
    const list = map.get(entry.deviceId) ?? []
    list.push(entry)
    map.set(entry.deviceId, list)
  }
  return map
})
const issuesFor = (instanceId: string) => issuesByDevice.value.get(instanceId) ?? []

/**
 * Issues that belong to the project rather than to any one device — a circuit that lost its
 * breaker, a busbar that no longer exists.
 *
 * These have no device to hang a mark on, and before this they were shown nowhere: deleting the
 * main breaker left three circuits without protection and the board said nothing at all. A panel
 * that stays quiet about that is the panel that gets trusted too much.
 */
const generalIssues = computed(() => issues.value.filter((entry) => !entry.deviceId && entry.level === 'error'))
const worstLevel = (instanceId: string) => (issuesFor(instanceId).some((entry) => entry.level === 'error')
  ? 'error'
  : issuesFor(instanceId).length ? 'warning' : '')

/** The words a person gets instead of a rule code. */
const announced = ref('')
const announce = (instanceId: string) => {
  const list = issuesFor(instanceId)
  const device = deviceById(instanceId)
  if (!list.length || !device) { announced.value = ''; return }
  const name = device.address || device.name
  announced.value = list.map((entry) => `${name}: ${entry.message}`).join(' ')
}

type WireEnd = { instanceId: string; bus: string; side: 'top' | 'bottom' } | null
const isWireEnd = (end: WireEnd, instanceId: string, bus: string, side: 'top' | 'bottom') =>
  Boolean(end && end.instanceId === instanceId && end.bus === bus && end.side === side)

const terminalAt = (device: BoardSpace['devices'][number], bus: string, side: 'top' | 'bottom') => {
  const row = side === 'top' ? device.terminals.top : device.terminals.bottom
  return row.find((terminal) => terminal.bus === bus)
}

/** The end the feed leaves from and the end it arrives at, for a wire between two clamps. */
const wireEnds = (from: NonNullable<WireEnd>, to: NonNullable<WireEnd>) => {
  const start = deviceById(from.instanceId)
  const end = deviceById(to.instanceId)
  if (!start || !end) return null
  const fromTerminal = terminalAt(start, from.bus, from.side)
  const toTerminal = terminalAt(end, to.bus, to.side)
  if (!fromTerminal || !toTerminal) return null
  return {
    from: { x: start.x + fromTerminal.x, y: start.y + fromTerminal.y, height: fromTerminal.height },
    to: { x: end.x + toTerminal.x, y: end.y + toTerminal.y, height: toTerminal.height },
  }
}

/** The line that follows the pointer: real routing to the hovered clamp, straight to the rest. */
const ghostPath = computed(() => {
  const from = pendingWire.value
  const to = hoveredWire.value
  if (!from || !to) return ''
  const ends = wireEnds(from, to)
  if (ends) return routeWire({ from: ends.from, to: ends.to, source: 'device', stubMm: 4 })
  const start = deviceById(from.instanceId)
  const startTerminal = start && terminalAt(start, from.bus, from.side)
  if (!start || !startTerminal) return ''
  return `M ${start.x + startTerminal.x} ${start.y + startTerminal.y} L ${dragPointer.value.x} ${dragPointer.value.y}`
})

const clearWire = () => {
  pendingWire.value = null
  hoveredWire.value = null
  wireRefusal.value = ''
}

const onTerminalClick = (device: BoardSpace['devices'][number], bus: string, side: 'top' | 'bottom') => {
  const first = pendingWire.value
  if (!first) {
    pendingWire.value = { instanceId: device.instanceId, bus, side }
    wireRefusal.value = ''
    return
  }
  if (first.instanceId === device.instanceId && first.bus === bus && first.side === side) { clearWire(); return }
  if (first.bus !== bus) {
    // A wire carries one bus. Letting a person join L to N would produce something that cannot be
    // built, and the board is exactly where they find out, so it is refused here rather than later.
    wireRefusal.value = `Провод несёт одну шину: ${first.bus} и ${bus} соединить нельзя.`
    return
  }
  const connection = connectOnBoard(first, { instanceId: device.instanceId, bus, side })
  if (connection) { clearWire(); emit('update:tool', 'select') }
}

const connectOnBoard = (from: NonNullable<typeof pendingWire.value>, to: NonNullable<typeof pendingWire.value>) => {
  const ok = store.connectOnBoard(from.instanceId, from.bus as BusType, to.instanceId)
  if (!ok) wireRefusal.value = 'Провести провод не получилось.'
  return ok
}

const beginAddress = (device: BoardSpace['devices'][number]) => {
  editing.value = { kind: 'address', instanceId: device.instanceId, x: device.x, y: device.y, value: device.address }
  void nextTick(() => addressInput.value?.select())
}

const commitAddress = () => {
  const target = editing.value
  if (!target || target.kind !== 'address') return
  // The typed text, not the value captured when the field opened. Reading the captured value saved
  // the old address every time, which is invisible until you try to change one.
  const value = (addressInput.value?.value ?? target.value).trim()
  // An empty address is refused by the domain, because an unlabelled device cannot be found later.
  // Silently dropping the edit would look exactly like the field had saved.
  if (!value) { wireRefusal.value = 'Адрес не может быть пустым: без него аппарат потом не найти.'; return }
  // updateSelected works on the selection, so the device is selected first.
  store.selectedDeviceId = target.instanceId
  store.updateSelected({ address: value })
  editing.value = null
  emit('update:tool', 'select')
}

/**
 * Creates a circuit for the selected device and asks for its load right here.
 *
 * The circuit is already complete the moment it is created — store.addCircuit makes the wire too —
 * so the only thing missing is what it feeds. Asking on the board, next to the device, is where
 * the person is looking; asking in a panel would hide the one answer they have not got yet.
 */
const createCircuit = (instanceId: string) => {
  const device = deviceById(instanceId)
  const created = store.addCircuit(instanceId)
  const circuit = created && typeof created === 'object' ? created : null
  if (!circuit || !device) return
  editing.value = { kind: 'load', instanceId, circuitId: circuit.id, x: device.x, y: device.y, value: circuit.loadName }
  void nextTick(() => addressInput.value?.select())
}

const commitLoad = () => {
  const target = editing.value
  if (!target || target.kind !== 'load') return
  const value = (addressInput.value?.value ?? target.value).trim()
  if (value) store.updateCircuit(target.circuitId, { loadName: value })
  editing.value = null
  emit('update:tool', 'select')
}

const commitEditor = () => (editing.value?.kind === 'load' ? commitLoad() : commitAddress())

defineExpose({ cancelWire, createCircuit })

const cancelAddress = () => {
  editing.value = null
  emit('update:tool', 'select')
}

const onDeviceClick = (device: BoardSpace['devices'][number]) => {
  if (tool.value === 'address') { beginAddress(device); return }
  store.selectedDeviceId = device.instanceId
}

const startDeviceDrag = (event: PointerEvent, device: BoardSpace['devices'][number]) => {
  if (event.button !== 0) return
  // Dragging in address mode would move a device the person only meant to relabel.
  if (tool.value !== 'select') return
  beginBoardDrag({ kind: 'placed', id: device.instanceId, width: Math.max(1, Math.round(device.width / scene.value.modulePitch)), fromRow: device.row, fromSlot: device.slot }, event)
}

</script>

<template>
  <div ref="canvas" class="board-scene-canvas">
  <svg
    class="board-scene"
    :viewBox="`0 0 ${scene.width} ${scene.height}`"
    :style="{ width: `${scene.width * scale}px`, height: `${scene.height * scale}px` }"
    ref="svgElement"
    role="img"
    :aria-label="`Схема электрощита: ${scene.devices.length} аппаратов, ${scene.wires.length} соединений`"
  >
    <rect class="scene-plate" x="0" y="0" :width="scene.width" :height="scene.height" rx="3" />

    <g class="scene-rails">
      <g v-for="rail in scene.rails" :key="`rail-${rail.row}`">
        <rect class="scene-rail" :x="scene.railStartX - 3" :y="rail.y + rail.height / 2 - 6" :width="rail.capacity * scene.modulePitch + 6" height="12" rx="1" />
        <line
          v-for="(slot, index) in rail.slots"
          :key="`slot-${rail.row}-${index}`"
          class="scene-slot"
          :x1="slot" :y1="rail.y + rail.height / 2 - 6"
          :x2="slot" :y2="rail.y + rail.height / 2 + 6"
        />
      </g>
    </g>

    <!-- Drop targets. These are the rail's own module boundaries rather than a separate grid of
         cells, so a target can never be drawn where the rail is not. -->
    <g class="scene-drop-zones" :class="{ 'is-active': isDragging }">
      <rect
        v-for="rail in scene.rails"
        :key="`zone-${rail.row}`"
        class="scene-drop-zone"
        :data-row="rail.row"
        :data-capacity="rail.capacity"
        :data-module-pitch="scene.modulePitch"
        :x="rail.slots[0] ?? scene.railStartX"
        :y="rail.y"
        :width="rail.capacity * scene.modulePitch"
        :height="rail.height"
      />
    </g>

    <rect
      v-if="preview"
      class="scene-drop-preview"
      :class="{ 'is-blocked': Boolean(preview.error) }"
      :x="scene.railStartX + preview.slot * scene.modulePitch"
      :y="scene.rails.find((rail) => rail.row === preview?.row)?.y ?? 0"
      :width="preview.width * scene.modulePitch"
      :height="scene.rails.find((rail) => rail.row === preview?.row)?.height ?? 0"
      rx="0.8"
    />

    <!-- Wires first, so a device covers the end of its own wire the way a real panel does. -->
    <g class="scene-wires" aria-hidden="true">
      <path
        v-for="wire in scene.wires"
        :key="wire.id"
        class="scene-wire"
        :class="`scene-wire-${wire.bus.toLowerCase()}`"
        :d="wire.d"
        :stroke="wire.color || busColor[wire.bus]"
        :stroke-width="wire.thickness || 2"
        fill="none"
      >
        <title>{{ wire.label }}</title>
      </path>
    </g>

    <g
      v-for="device in scene.devices"
      :key="device.instanceId"
      class="scene-device"
      :class="{
        'is-missing': device.missingProduct,
        'is-selected': store.selectedDeviceId === device.instanceId,
        'has-issue': Boolean(worstLevel(device.instanceId)),
        [`is-${worstLevel(device.instanceId)}`]: Boolean(worstLevel(device.instanceId)),
      }"
      :transform="`translate(${device.x} ${device.y})`"
      :data-instance-id="device.instanceId"
      @pointerdown="startDeviceDrag($event, device)"
      role="button"
      tabindex="0"
      :aria-label="`${device.address || 'без адреса'}, ${device.name}`"
      @click="onDeviceClick(device); announce(device.instanceId)"
      @keydown.enter="store.selectedDeviceId = device.instanceId"
    >
      <!-- The face is the very same component the catalogue draws, placed directly in board
           millimetres. It used to be mounted as its own scaled <svg> per device, and that second
           coordinate system is exactly what made a wire miss its clamp. -->
      <!-- A device whose product is missing keeps its body from the fallback definition, so the
           board shows a marked placeholder rather than a hole where the device used to be. -->
      <template v-if="device.product">
        <DeviceChassis :product="device.product" :metrics="faceOf(device)" />
        <!-- The mark is drawn on the chassis corner, where a plate sticker would go, and it is the
             same verdict the report prints. -->
        <circle
          v-if="worstLevel(device.instanceId)"
          class="scene-issue"
          :class="`is-${worstLevel(device.instanceId)}`"
          :cx="device.width - 2" cy="2.4" r="1.9"
          :data-issue="worstLevel(device.instanceId)"
          :aria-label="`Замечание: ${device.address || device.name}`"
        />

        <DeviceFace :product="device.product" :metrics="faceOf(device)" />
      </template>
      <rect
        v-else
        class="scene-device-missing"
        :x="faceOf(device).body.x" :y="faceOf(device).body.y"
        :width="faceOf(device).body.width" :height="faceOf(device).body.height"
        rx="1.6"
      />

      <g class="scene-device-labels">
        <text class="scene-device-address" :x="device.width / 2" :y="-1.6" text-anchor="middle">{{ device.address || '—' }}</text>
        <text class="scene-device-name" :x="device.width / 2" :y="device.height + 3.4" text-anchor="middle">{{ device.name }}</text>
      </g>
    </g>

    <!-- Terminals become reachable while the wire tool is on: without a visible target a person is
         aiming at a two-millimetre pocket. -->
    <g v-if="tool === 'wire'" class="scene-terminals">
      <g v-for="device in scene.devices" :key="`terms-${device.instanceId}`" :transform="`translate(${device.x} ${device.y})`">
        <template v-for="side in (['top', 'bottom'] as const)" :key="side">
          <circle
          v-for="terminal in (side === 'top' ? device.terminals.top : device.terminals.bottom)"
          :key="`${side}-${terminal.bus}-${terminal.column}`"
          class="scene-terminal"
          :class="{
            'is-start': isWireEnd(pendingWire, device.instanceId, terminal.bus, side),
            'is-hover': isWireEnd(hoveredWire, device.instanceId, terminal.bus, side),
          }"
          :cx="terminal.x" :cy="terminal.y" r="2.6"
          :stroke="wireColor(terminal.bus)"
          :data-terminal="`${device.instanceId}:${terminal.bus}:${side}:${terminal.column}`"
          @pointerenter="hoveredWire = { instanceId: device.instanceId, bus: terminal.bus, side }"
          @pointerleave="hoveredWire = null"
          @click.stop="onTerminalClick(device, terminal.bus, side)"
          />
        </template>
      </g>
    </g>

    <path
      v-if="ghostPath"
      class="scene-wire-ghost"
      :d="ghostPath"
      :stroke="pendingWire ? wireColor(pendingWire.bus) : '#8a9599'"
      stroke-width="0.8"
      fill="none"
    />
    <text
      v-if="wireRefusal"
      class="scene-wire-refusal"
      :x="scene.width / 2" :y="8"
      text-anchor="middle"
    >{{ wireRefusal }}</text>
  </svg>

  <p v-if="wireRefusal" class="board-wire-refusal" role="status">{{ wireRefusal }}</p>
  <p v-if="announced" class="board-issue-note" role="status">{{ announced }}</p>
  <ul v-if="generalIssues.length" class="board-general-issues" role="status">
    <li v-for="entry in generalIssues" :key="entry.id">{{ entry.message }}</li>
  </ul>

  <input
    v-if="editing"
    ref="addressInput"
    class="board-address-input"
    :aria-label="editing.kind === 'load' ? 'Нагрузка цепи' : `Адрес: ${deviceById(editing.instanceId)?.name ?? 'устройство'}`"
    :value="editing.value"
    :style="{ left: `${editing.x * scale}px`, top: `${editing.y * scale}px` }"
    @keydown.enter.prevent="commitEditor"
    @keydown.esc.prevent="cancelAddress"
    @blur="cancelAddress"
    @click.stop
  />
  </div>
</template>

<style scoped>
.board-scene-canvas {
  /*
   * The side panels are fixed overlays. The grid reserves 270px and 330px for them, but a fixed
   * panel is 330px wide and covers the working area anyway, so the board keeps clear of them
   * itself. These are the widths that actually get covered — not the grid columns, which are
   * narrower than the panels they were supposed to reserve room for. Without this the board was
   * drawn edge to edge under both panels, reachable only where neither one covered it.
   */
  --panel-overlay-inline: 0px;
  width: 100%;
  padding-inline: var(--panel-overlay-inline);
}

.app-shell.panels-open .board-scene-canvas {
  --panel-overlay-inline: 330px;
}

.board-scene {
  display: block;
  max-width: 100%;
  height: auto;
  background: var(--board-plate);
  border: 1px solid var(--line);
  border-radius: 4px;
}

.scene-plate {
  fill: var(--board-plate);
  stroke: var(--board-plate-edge);
  stroke-width: 0.6;
}

/* Rails are the DIN profile a device clips onto, so they read as metal against the back plate. */
.scene-rail {
  fill: var(--board-rail-fill);
  stroke: var(--board-rail-edge);
  stroke-width: 0.3;
}

.scene-slot {
  stroke: var(--board-slot-edge);
  stroke-width: 0.25;
  stroke-dasharray: 0.8 0.8;
}

.scene-terminal {
  fill: var(--board-slot);
  fill-opacity: .001;
  cursor: crosshair;
}

.scene-terminal.is-hover {
  fill-opacity: .45;
}

.scene-terminal.is-start {
  fill-opacity: .8;
  stroke-width: 0.7;
}

.scene-wire-ghost {
  stroke-dasharray: 1.6 1.2;
  pointer-events: none;
}

.scene-wire-refusal {
  font: 3px var(--mono);
  fill: #b4472e;
}

.scene-device.has-issue .dv-body,
.scene-device.has-issue > rect {
  stroke: #b4472e;
  stroke-width: .35;
}

.scene-device.has-issue.is-warning .dv-body,
.scene-device.has-issue.is-warning > rect {
  stroke: #b0821f;
}

.scene-issue {
  fill: #b4472e;
  stroke: var(--board-plate);
  stroke-width: .3;
}

.scene-issue.is-warning {
  fill: #b0821f;
}

.board-general-issues {
  position: absolute;
  z-index: 4;
  left: 6px;
  right: 6px;
  top: 34px;
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text);
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--error);
  border-radius: 3px;
}

.board-issue-note {
  position: absolute;
  z-index: 3;
  margin: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
}

.board-wire-refusal {
  position: absolute;
  z-index: 3;
  margin: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--error);
  background: var(--surface);
  border: 1px solid var(--error);
  border-radius: 3px;
}

.scene-drop-zone {
  fill: transparent;
}

.scene-drop-zones.is-active .scene-drop-zone {
  fill: var(--board-slot-hover);
}

.scene-drop-preview {
  fill: var(--board-slot-filled);
  stroke: var(--board-slot-filled-edge);
  stroke-width: 0.5;
}

.scene-drop-preview.is-blocked {
  fill: var(--board-slot-wide);
  stroke: #b4472e;
}

.scene-wire {
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Wires stay legible when the board is scaled down to fit a narrow panel. */
  vector-effect: non-scaling-stroke;
}

.scene-device {
  cursor: pointer;
}

.scene-device .dv-body {
  transition: filter 120ms ease;
}

.scene-device:hover .dv-body {
  filter: brightness(1.06);
}

.scene-device:focus {
  outline: none;
}

.scene-device:focus-visible .dv-body,
.scene-device.is-selected .dv-body {
  filter: drop-shadow(0 0 0.7mm var(--board-slot-filled-edge));
}

.scene-device-address,
.scene-device-name {
  /* Type in millimetres, so the marking keeps its size on the panel however the board is scaled. */
  font-family: var(--mono);
  fill: var(--text);
}

.scene-device-address {
  font-size: 2.6px;
  font-weight: 700;
}

.scene-device-name {
  font-size: 1.9px;
  fill: var(--board-ink);
}

.board-scene-canvas {
  position: relative;
}

.board-address-input {
  position: absolute;
  z-index: 2;
  min-width: 15mm;
  padding: 2px 4px;
  font: 600 11px var(--mono);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 3px;
}

.scene-device-missing {
  fill: var(--board-slot-wide);
  stroke: var(--board-device-edge);
  stroke-width: 0.5;
  stroke-dasharray: 2 1.5;
}
</style>
