<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildBoardScene, type BoardScene as BoardSpace } from '../../domain/boardScene'
import { getRowCapacity, placeProduct, resolveDeviceMove } from '../../domain/layout'
import { buildLabelSheet, labelTextFor } from '../../domain/labelSheet'
import { manualWireSegments, wireColor } from '../../domain/wiring'
import { validateProject } from '../../domain/validation'
import { beginBoardDrag, cancelBoardDrag, dragPointer, dragSource, isDragging, setBoardDropHandler } from '../../composables/useBoardDrag'
import { useBoardViewport } from '../../composables/useBoardViewport'
import BoardWireInspector from './BoardWireInspector.vue'
import DeviceChassis from '../catalog/deviceFace/DeviceChassis.vue'
import DeviceFace from '../catalog/deviceFace/DeviceFace.vue'
import { useProjectStore } from '../../stores/project'
import type { BusType, Connection, ValidationIssue, WireRoute, WireLayer, WirePoint } from '../../domain/types'

/**
 * The board, drawn as one SVG.
 *
 * Every coordinate in here is a millimetre of the enclosure, and the only conversion to pixels
 * happens once, on the `viewBox` scale. The editor this replaces mounted a separate `<svg>` inside
 * every device and scaled it to a pixel width, so the board had two scales on screen at once and
 * nothing drawn on them could be relied on to line up. Here a clamp and the wire that lands in it
 * are two numbers about the same millimetre.
 */
const props = defineProps<{ scale?: number; tool?: BoardTool; active?: boolean }>()
const emit = defineEmits<{ 'update:tool': [BoardTool]; 'update:scale': [number] }>()

/**
 * What a click on the board means.
 */
export type BoardTool = 'select' | 'address' | 'wire' | 'pan'
const tool = computed<BoardTool>(() => props.tool ?? 'select')

const store = useProjectStore()
const scene = computed<BoardSpace>(() => buildBoardScene(store.currentProject, store.definitions))

const deviceMarkings = computed(() => {
  const labels = new Map(buildLabelSheet(store.currentProject, store.definitions).labels.map((label) => [label.instanceId, label.text]))
  return new Map(store.currentProject.devices.map((device) => [device.instanceId, labels.get(device.instanceId) ?? labelTextFor(device, undefined)]))
})
const markingFor = (device: BoardSpace['devices'][number]) => deviceMarkings.value.get(device.instanceId) || ''
const hasCustomMarking = (device: BoardSpace['devices'][number]) => Boolean(markingFor(device) && markingFor(device) !== device.address)
const markingLines = (device: BoardSpace['devices'][number]) => {
  const text = markingFor(device)
  const capacity = Math.max(5, Math.floor(device.width / 1.2))
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + word.length + 1 > capacity) { lines.push(line); line = '' }
    let rest = word
    while (rest.length > capacity) { lines.push(rest.slice(0, capacity)); rest = rest.slice(capacity) }
    line = line ? `${line} ${rest}` : rest
  }
  if (line) lines.push(line)
  return lines.length > 3 ? [...lines.slice(0, 2), `${lines[2]!.slice(0, capacity - 1)}…`] : lines
}

/**
 * The board is drawn in millimetres, so at 1:1 it is a 300-pixel rectangle sitting in the left
 * corner of a wide panel — which is exactly what it looked like before the container was measured.
 * The zoom the user asks for is a multiple of "fits the space available", not of millimetres.
 */
const canvas = ref<HTMLElement | null>(null)
const fitScale = ref(1)
let observer: ResizeObserver | undefined
let measureFrame = 0

const measure = () => {
  const element = canvas.value
  if (!element) return
  // clientWidth counts the padding, and the padding is exactly the room reserved for the side
  // panels that overlay this canvas. Measuring the border box would draw the board underneath
  // them — reachable only where a panel happens not to cover it.
  const style = window.getComputedStyle(element)
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
  const width = element.clientWidth - (Number.isFinite(padding) ? padding : 0)
  // Height used to be ignored, so a tall board was fitted by width alone and ran off the bottom of
  // the window: the lower rows and everything on them were below the fold, on a workspace whose
  // whole point is the whole panel. The available height is measured from the canvas to the window
  // rather than from the canvas itself, because the canvas grows with the board it holds.
  const room = Math.max(120, element.clientHeight - 48)
  if (width <= 0 || scene.value.width <= 0 || scene.value.height <= 0) return
  const next = Math.min(width / scene.value.width, room / scene.value.height)
  // The observer fires when this element resizes, which the drawing itself causes; without a dead
  // band the two would chase each other.
  if (Math.abs(next - fitScale.value) > 0.005) fitScale.value = next
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  if (canvas.value) {
    observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(measureFrame)
      measureFrame = window.requestAnimationFrame(measure)
    })
    observer.observe(canvas.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.cancelAnimationFrame(measureFrame)
  window.removeEventListener('resize', measure)
})

watch(() => [scene.value.width, scene.value.height], () => { void nextTick(measure) })

const scale = computed(() => Math.max(0.01, (props.scale ?? 1) * fitScale.value))

const busColor = { L: wireColor('L'), N: wireColor('N'), PE: wireColor('PE') }

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

const grabOffset = ref(0)

const pointerToBoard = () => {
  const svg = svgElement.value
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const point = new DOMPoint(dragPointer.value.x, dragPointer.value.y).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

const computePreview = () => {
  const pointer = pointerToBoard()
  const bounds = canvas.value?.getBoundingClientRect()
  const { x, y } = dragPointer.value
  if (!pointer || !dragSource.value || !bounds || x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom
    || pointer.x < 0 || pointer.x > scene.value.width || pointer.y < 0 || pointer.y > scene.value.height) {
    preview.value = null
    return
  }
  if (dragSource.value.kind === 'placed') {
    pointer.x -= grabOffset.value
  }
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
  const product = source.kind === 'catalog' ? store.definitions.get(source.id) : undefined
  if (source.kind === 'catalog' && !product) { preview.value = null; return }
  const result = source.kind === 'catalog'
    ? placeProduct(devices, product!, rail.row, slot, getRowCapacity(store.currentProject), () => '', store.definitions)
    : resolveDeviceMove(devices, source.id, rail.row, slot, getRowCapacity(store.currentProject), store.definitions)

  preview.value = { row: rail.row, slot, width, error: result.error }
}

const commitDrop = () => {
  computePreview()
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
  cancelBoardDrag()
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

/** Each endpoint retains the exact side and column clicked on the board. */
type WireEnd =
  | { kind: 'terminal'; instanceId: string; bus: string; side: 'top' | 'bottom'; column: number }
  | { kind: 'bus'; bus: BusType }
  | null

const pendingWire = ref<WireEnd>(null)
const hoveredWire = ref<WireEnd>(null)
const wireRefusal = ref('')
const wireBus = ref<BusType>('L')
const pointer = ref<{ x: number; y: number } | null>(null)
const pendingPoints = ref<WirePoint[]>([])
const pendingLayer = ref<WireLayer>('front')
const pendingLayers = ref<WireLayer[]>([])
const routeDraft = ref<WireRoute | null>(null)
const routeEditingId = ref<string | null>(null)
const draggingRoutePoint = ref<number | null>(null)
const draftWire = computed(() => {
  if (!routeDraft.value || !routeEditingId.value) return null
  const project = { ...store.currentProject, connections: store.currentProject.connections.map((wire) => wire.id === routeEditingId.value ? { ...wire, route: routeDraft.value! } : wire) }
  return buildBoardScene(project, store.definitions).wires.find((wire) => wire.id === routeEditingId.value) ?? null
})
const renderWires = computed(() => scene.value.wires.map((wire) => draftWire.value?.id === wire.id ? draftWire.value : wire))
const routeStroke = (thickness: number) => Math.max(2.8, (thickness || 2) * scale.value)
const eventPoint = (event: MouseEvent | PointerEvent): WirePoint | null => {
  const matrix = svgElement.value?.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: Math.round(Math.max(0, Math.min(scene.value.width, point.x)) * 10) / 10, y: Math.round(Math.max(0, Math.min(scene.value.height, point.y)) * 10) / 10 }
}
const cancelRouteEdit = () => { routeDraft.value = null; routeEditingId.value = null; draggingRoutePoint.value = null }
const beginRouteEdit = async () => {
  const connection = store.selectedConnection
  if (!connection) return
  emit('update:tool', 'select')
  await nextTick()
  const wire = scene.value.wires.find((item) => item.id === connection.id)
  if (!wire) return
  routeEditingId.value = connection.id
  routeDraft.value = { points: wire.editableRoute.points.map((point) => ({ ...point })), segmentLayers: [...wire.editableRoute.segmentLayers] }
}
const applyRouteEdit = () => {
  if (routeEditingId.value && routeDraft.value && store.updateConnection(routeEditingId.value, { route: routeDraft.value })) cancelRouteEdit()
}
const setRouteLayer = (index: number, layer: WireLayer) => { if (routeDraft.value) routeDraft.value.segmentLayers[index] = layer }
const addRoutePoint = (index: number) => {
  const points = draftWire.value?.routePoints
  if (!routeDraft.value || !points?.[index] || !points[index + 1]) return
  const from = points[index]!, to = points[index + 1]!
  routeDraft.value.points.splice(index, 0, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
  routeDraft.value.segmentLayers.splice(index, 0, routeDraft.value.segmentLayers[index] ?? 'front')
}
const removeRoutePoint = (index: number) => {
  if (!routeDraft.value) return
  routeDraft.value.points.splice(index, 1)
  routeDraft.value.segmentLayers.splice(index + 1, 1)
}
const startRoutePointDrag = (event: PointerEvent, index: number) => {
  if (event.button !== 0) return
  event.stopPropagation(); event.preventDefault()
  draggingRoutePoint.value = index
  ;(event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId)
}
const moveRoutePoint = (event: PointerEvent) => {
  if (draggingRoutePoint.value === null || !routeDraft.value) return
  const point = eventPoint(event)
  if (point) routeDraft.value.points[draggingRoutePoint.value] = point
}
const routePointKey = (event: KeyboardEvent, index: number) => {
  if (!routeDraft.value) return
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); removeRoutePoint(index); return }
  const point = routeDraft.value.points[index]
  if (!point || !event.key.startsWith('Arrow')) return
  event.preventDefault(); event.stopPropagation()
  const step = event.shiftKey ? 5 : 1
  point.x = Math.max(0, Math.min(scene.value.width, point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)))
  point.y = Math.max(0, Math.min(scene.value.height, point.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)))
}
const guardRouteKeys = (event: KeyboardEvent) => {
  if (!routeDraft.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.scene-route-handle') && !(event.ctrlKey || event.metaKey)) return
  if (event.key === 'Delete' || event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && ['z', 'd'].includes(event.key.toLowerCase()))) {
    event.stopPropagation()
    if (!target || !/^(INPUT|TEXTAREA)$/.test(target.tagName)) event.preventDefault()
  }
}
const onRouteCanvasClick = (event: MouseEvent) => {
  if (tool.value !== 'wire' || !pendingWire.value) return
  const point = eventPoint(event)
  if (point && pendingPoints.value.length < 64) { pendingPoints.value.push(point); pendingLayers.value.push(pendingLayer.value) }
}
watch(() => store.selectedConnectionId, (id) => { if (routeEditingId.value && id !== routeEditingId.value) cancelRouteEdit() })
const trackPointer = (event: PointerEvent) => {
  moveRoutePoint(event)
  const matrix = svgElement.value?.getScreenCTM()
  if (matrix) pointer.value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
}

const isWireEnd = (end: WireEnd, device: BoardSpace['devices'][number], bus: string, side: 'top' | 'bottom', column: number) =>
  Boolean(end && end.kind === 'terminal' && end.instanceId === device.instanceId && end.bus === bus && end.side === side && end.column === column)

const terminalAt = (device: BoardSpace['devices'][number], bus: string, side: 'top' | 'bottom', column?: number) => {
  const row = side === 'top' ? device.terminals.top : device.terminals.bottom
  if (column !== undefined && row[column]) return row[column]
  return row.find((terminal) => terminal.bus === bus)
}

/**
 * The two ends of a wire, in board millimetres, and the shape that joins them.
 *
 * A run from the rail is drawn like a run from a fork: it leaves a horizontal line and drops into
 * the clamp. A run between two clamps leaves one and climbs into the other, and the route itself
 * decides whether it has to climb at all.
 */
const pointOf = (end: NonNullable<WireEnd>) => {
  if (end.kind === 'bus') {
    const rail = scene.value.busRails.find((candidate) => candidate.bus === end.bus)
    return rail ? { x: rail.x + rail.width / 2, y: rail.tapY, height: 0 } : null
  }
  const device = deviceById(end.instanceId)
  const terminal = device && terminalAt(device, end.bus, end.side, end.column)
  if (!device || !terminal) return null
  return { x: device.x + terminal.x, y: device.y + terminal.y, height: terminal.height }
}

/** The line that follows the pointer: real routing to the hovered clamp, straight to the rest. */
const ghostPath = computed(() => {
  const from = pendingWire.value
  const to = hoveredWire.value
  if (!from) return ''
  const start = pointOf(from)
  if (!start) return ''
  if (to) {
    if (from.bus !== to.bus && from.bus !== 'aux' && to.bus !== 'aux') return ''
    const terminal = to.kind === 'terminal' ? to : from.kind === 'terminal' ? from : null
    if (!terminal) return ''
    const bus = (from.bus !== 'aux' ? from.bus : to.bus !== 'aux' ? to.bus : wireBus.value) as BusType
    const draft: Connection = {
      id: '__wire-preview__', circuitId: '', fromBus: bus, toDeviceId: terminal.instanceId,
      toSide: terminal.side, terminal: terminal.column, color: wireColor(bus), thickness: 2, label: '',
      kind: from.kind === 'terminal' && to.kind === 'terminal' ? 'busbar' : 'bus',
      route: { points: to.kind === 'bus' ? [...pendingPoints.value].reverse() : [...pendingPoints.value], segmentLayers: to.kind === 'bus' ? [...pendingLayers.value, pendingLayer.value].reverse() : [...pendingLayers.value, pendingLayer.value] },
      ...(from.kind === 'terminal' && to.kind === 'terminal'
        ? { fromDeviceId: from.instanceId, fromTerminal: from.column, fromSide: from.side } : {}),
    }
    return buildBoardScene({ ...store.currentProject, connections: [...store.currentProject.connections, draft] }, store.definitions)
      .wires.find((wire) => wire.id === draft.id)?.d ?? ''
  }
  if (!pointer.value) return ''
  if (from.kind === 'bus') {
    const rail = scene.value.busRails.find((candidate) => candidate.bus === from.bus)
    if (rail) start.x = Math.max(rail.x, Math.min(rail.x + rail.width, pendingPoints.value[0]?.x ?? pointer.value.x))
  }
  return manualWireSegments(start, pointer.value, { points: pendingPoints.value, segmentLayers: [...pendingLayers.value, pendingLayer.value] }).map((part) => part.d).join(' ')
})

const clearWire = () => {
  pendingWire.value = null
  pendingPoints.value = []
  pendingLayers.value = []
  hoveredWire.value = null
  wireRefusal.value = ''
}

watch([tool, () => store.currentProject.id], () => clearWire())

const connect = (from: NonNullable<WireEnd>, to: NonNullable<WireEnd>) => {
  const terminal = from.kind === 'terminal' ? from : to.kind === 'terminal' ? to : null
  const bus = (from.bus !== 'aux' ? from.bus : to.bus !== 'aux' ? to.bus : wireBus.value) as BusType
  let connected = false
  let route: WireRoute = { points: [...pendingPoints.value], segmentLayers: [...pendingLayers.value, pendingLayer.value] }
  if (route && to.kind === 'bus') route = { points: [...route.points].reverse(), segmentLayers: [...route.segmentLayers].reverse() }
  if (from.kind === 'terminal' && to.kind === 'terminal') {
    connected = store.connectOnBoard(from.instanceId, bus, to.instanceId, to.column, {
      fromTerminal: from.column, fromSide: from.side, toSide: to.side, route,
    })
  } else if (terminal) {
    connected = store.connectFromBus(bus, terminal.instanceId, terminal.column, terminal.side, route)
  }
  if (!connected) wireRefusal.value = store.toast?.text || 'Выберите зажим аппарата.'
  return connected
}

const onTerminalClick = (device: BoardSpace['devices'][number], bus: string, side: 'top' | 'bottom', column: number) => {
  const first = pendingWire.value
  const end: WireEnd = { kind: 'terminal', instanceId: device.instanceId, bus, side, column }
  if (!first) {
    pendingWire.value = end
    wireRefusal.value = ''
    return
  }
  // Two screws of a terminal block are two terminals, not one wire drawn twice: the column is part
  // of which clamp was clicked.
  const same = first.kind === end.kind && first.instanceId === end.instanceId && first.bus === end.bus
    && first.side === end.side && first.column === end.column
  if (same) { clearWire(); return }
  if (first.bus !== end.bus && first.bus !== 'aux' && end.bus !== 'aux') {
    // A wire carries one bus. Letting a person join L to N would produce something that cannot be
    // built, and the board is exactly where they find out, so it is refused here rather than later.
    wireRefusal.value = `Провод несёт одну шину: ${first.bus} и ${end.bus} соединить нельзя.`
    return
  }
  if (connect(first, end)) { clearWire() }
}

const onBusClick = (bus: BusType) => {
  const first = pendingWire.value
  const end: WireEnd = { kind: 'bus', bus }
  if (!first) {
    pendingWire.value = end
    wireRefusal.value = ''
    return
  }
  if (first.kind === 'bus' && first.bus === end.bus) { clearWire(); return }
  if (first.bus !== end.bus && first.bus !== 'aux') {
    wireRefusal.value = `Провод несёт одну шину: ${first.bus} и ${end.bus} соединить нельзя.`
    return
  }
  if (connect(first, end)) { clearWire() }
}
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

const cancelInteraction = () => {
  cancelBoardDrag()
  stopPan()
  cancelWire()
  cancelRouteEdit()
  editing.value = null
}
const revealDevice = async (instanceId: string) => {
  measure()
  await nextTick()
  const element = [...(canvas.value?.querySelectorAll<SVGGElement>('.scene-device') ?? [])]
    .find((node) => node.dataset.instanceId === instanceId)
  element?.scrollIntoView({ block: 'center', inline: 'center' })
  element?.focus({ preventScroll: true })
}
const { isPanning, canPan, startPan, stopPan, guardCanvasClick, onCanvasWheel, fitView } = useBoardViewport({
  canvas, svg: svgElement,
  active: () => props.active !== false,
  panTool: () => tool.value === 'pan',
  zoom: () => props.scale ?? 1,
  setZoom: (value) => emit('update:scale', value),
})
watch([tool, () => store.currentProject.id, () => props.active], () => cancelInteraction())
defineExpose({ cancelWire, createCircuit, cancelInteraction, revealDevice, fitView })

const cancelAddress = () => {
  editing.value = null
  emit('update:tool', 'select')
}

const onDeviceClick = (device: BoardSpace['devices'][number]) => {
  if (tool.value === 'pan' || routeDraft.value || (tool.value === 'wire' && pendingWire.value)) return
  if (tool.value === 'address') { beginAddress(device); return }
  store.selectDevice(device.instanceId)
}

/**
 * Picking a wire.
 *
 * A wire is one or two millimetres wide on screen and sits under the device it serves, so aiming at
 * one by eye is guesswork. Each wire therefore carries a second, invisible copy of its own path,
 * three millimetres wide, which is what the pointer actually hits — and clicking it selects the
 * wire instead of the device behind it. Before this the only way to remove a wire was to delete a
 * device it happened to touch.
 */
/**
 * A click on the bare plate takes the selection away.
 *
 * Without it there is no way back to "nothing is picked" once a wire or a device has been: the
 * tools are modal, and every other click lands on something. A person who wants to start over has
 * to reload the page.
 */
const onPlateClick = () => {
  if (routeDraft.value || (tool.value === 'wire' && pendingWire.value)) return
  store.selectConnection(null)
  store.selectDevice(null)
}

const onWireClick = (event: MouseEvent, wireId: string) => {
  if (tool.value === 'wire') return
  event.stopPropagation()
  store.selectConnection(wireId)
}


const startDeviceDrag = (event: PointerEvent, device: BoardSpace['devices'][number]) => {
  if (event.button !== 0) return
  // Dragging in address mode would move a device the person only meant to relabel.
  if (tool.value !== 'select' || routeDraft.value) return
  const matrix = svgElement.value?.getScreenCTM()
  const rail = scene.value.rails.find((entry) => entry.row === device.row)
  if (!matrix || !rail) return
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  grabOffset.value = point.x - device.x
  beginBoardDrag({ kind: 'placed', id: device.instanceId, width: Math.max(1, Math.round(device.width / scene.value.modulePitch)), fromRow: device.row, fromSlot: device.slot }, event)
}

</script>

<template>
  <div class="board-stage" @keydown.capture="guardRouteKeys">
  <div v-if="tool === 'wire'" class="board-wire-guide" role="status">
    <span class="wire-step">{{ pendingWire ? '2' : '1' }}</span>
    <span>{{ pendingWire ? 'Кликайте по полю для поворотов, затем выберите конечный зажим' : 'Выберите зажим аппарата или шину L, N, PE' }}<small>Esc — отменить · повторы контактов не создают новый провод</small></span>
    <label>Прокладка <select v-model="pendingLayer" aria-label="Слой нового участка"><option value="front">Перед аппаратами</option><option value="rear">За аппаратами</option></select></label>
    <button v-if="pendingPoints.length" type="button" @click="pendingPoints.pop(); pendingLayers.pop()">Убрать последний поворот</button>
    <label>Провод для AUX <select v-model="wireBus" aria-label="Провод для вспомогательных зажимов"><option>L</option><option>N</option><option>PE</option></select></label>
  </div>
  <div ref="canvas" class="board-scene-canvas" :class="{ 'can-pan': canPan, 'is-panning': isPanning }"
    tabindex="0" aria-label="Рабочая область щита. Пробел и перетаскивание — переместить вид; Ctrl или Command и колесо — масштаб."
    @pointerdown.capture="startPan" @click.capture="guardCanvasClick" @wheel="onCanvasWheel">
  <svg
    class="board-scene"
    :viewBox="`0 0 ${scene.width} ${scene.height}`"
    :style="{ width: `${scene.width * scale}px`, height: `${scene.height * scale}px` }"
    ref="svgElement"
    role="group"
    @pointermove="trackPointer"
    @pointerup="draggingRoutePoint = null"
    @pointercancel="draggingRoutePoint = null"
    @click="onRouteCanvasClick"
    :aria-label="`Схема электрощита: ${scene.devices.length} аппаратов, ${scene.wires.length} соединений`"
  >
    <rect class="scene-plate" x="0" y="0" :width="scene.width" :height="scene.height" rx="3" @click="onPlateClick" />

    <!-- The three buses of the panel, in the margin the geometry reserves above the first row.
         A wire fed from the bus used to begin at a fixed point in the left-hand gutter, so the
         line looked as if it came out of nothing and the picture never said where L, N and PE were. -->
    <g class="scene-buses">
      <g v-for="bus in scene.busRails" :key="`bus-${bus.bus}`" class="scene-bus" :class="{ 'is-wire-target': tool === 'wire' }">
        <rect class="scene-bus-rail" :x="bus.x" :y="bus.y" :width="bus.width" :height="bus.height" rx="1" :fill="bus.color" />
        <text class="scene-bus-label" :x="bus.x - 2.4" :y="bus.y + bus.height - 0.5" text-anchor="end">{{ bus.label }}</text>
        <title>{{ bus.title }}</title>
      </g>
    </g>

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

    <g class="scene-wires" data-wire-layer="rear">
      <template v-for="wire in renderWires" :key="wire.id">
        <!-- Complete path retained for endpoint measurements and accessibility tooling. -->
        <path class="scene-wire" :class="`scene-wire-${wire.bus.toLowerCase()}`" :stroke-width="wire.thickness || 2" :data-wire-id="wire.id" :d="wire.d" fill="none" stroke="none" aria-hidden="true" />
        <path v-for="segment in wire.segments.filter((part) => part.layer === 'rear')" :key="segment.index"
          class="scene-wire-segment" :data-wire-id="wire.id" :data-segment="segment.index" :d="segment.d"
          :stroke="wire.color || busColor[wire.bus]" :style="{ strokeWidth: `${routeStroke(wire.thickness)}px` }" fill="none" />
        <path class="scene-wire-hit" :class="{ 'is-selected': wire.id === store.selectedConnectionId }" :d="wire.d" :data-wire-id="wire.id"
          :aria-label="`Провод: ${wire.fromName} → ${wire.toName}, шина ${wire.bus}`" role="button" tabindex="0"
          @click="onWireClick($event, wire.id)" @keydown.enter.prevent="store.selectConnection(wire.id)" @keydown.space.prevent="store.selectConnection(wire.id)" />
      </template>
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
      :aria-label="`${device.address || 'без адреса'}, ${hasCustomMarking(device) ? markingFor(device) + ' · ' : ''}${device.name}`"
      @click="onDeviceClick(device); announce(device.instanceId)"
      @keydown.enter="store.selectDevice(device.instanceId)"
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
        <title>{{ device.address || 'Без адреса' }} · {{ markingFor(device) }} · {{ device.name }}</title>
        <text class="scene-device-address" :x="device.width / 2" :y="-1.6" text-anchor="middle">{{ device.address || '—' }}</text>
        <text v-if="hasCustomMarking(device)" class="scene-device-marking" :x="device.width / 2" :y="device.height + 3.4" text-anchor="middle" :aria-label="markingFor(device)">
          <tspan v-for="(line, index) in markingLines(device)" :key="index" :x="device.width / 2" :dy="index ? 2.6 : 0">{{ line }}</tspan>
        </text>
        <text v-else class="scene-device-name" :x="device.width / 2" :y="device.height + 3.4" text-anchor="middle">{{ device.name }}</text>
      </g>
    </g>

    <g class="scene-front-wires" data-wire-layer="front">
      <template v-for="wire in renderWires" :key="wire.id">
        <path v-for="segment in wire.segments.filter((part) => part.layer === 'front' || wire.id === store.selectedConnectionId)" :key="segment.index"
          class="scene-wire-segment" :class="{ 'is-selected': wire.id === store.selectedConnectionId, 'is-rear-ghost': segment.layer === 'rear' }"
          :data-wire-id="wire.id" :data-segment="segment.index" :data-layer="segment.layer" :d="segment.d"
          :stroke="wire.color || busColor[wire.bus]" :style="{ strokeWidth: `${routeStroke(wire.thickness)}px` }" fill="none"
          @click="onWireClick($event, wire.id)" />
      </template>
    </g>
    <g v-if="routeDraft" class="scene-route-handles">
      <circle v-for="(point, index) in routeDraft.points" :key="index" class="scene-route-handle" :data-route-point="index"
        :cx="point.x" :cy="point.y" :r="Math.max(2, 5 / scale)" role="button" tabindex="0" :aria-label="`Поворот ${index + 1}. Стрелки — сдвинуть, Delete — удалить`"
        @pointerdown="startRoutePointDrag($event, index)" @keydown="routePointKey($event, index)" @click.stop />
    </g>
    <g v-if="pendingWire" class="scene-pending-points">
      <circle v-for="(point, index) in pendingPoints" :key="index" :cx="point.x" :cy="point.y" r="1.5" />
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
            'is-start': isWireEnd(pendingWire, device, terminal.bus, side, terminal.column),
            'is-hover': isWireEnd(hoveredWire, device, terminal.bus, side, terminal.column),
            'is-incompatible': pendingWire && pendingWire.bus !== 'aux' && terminal.bus !== 'aux' && pendingWire.bus !== terminal.bus,
          }"
          :cx="terminal.x" :cy="terminal.y" r="3.2"
          role="button" tabindex="0"
          :aria-label="`${device.address || device.name}: ${terminal.bus}, зажим ${terminal.label}, ${side === 'top' ? 'сверху' : 'снизу'}`"
          @keydown.enter.prevent="onTerminalClick(device, terminal.bus, side, terminal.column)"
          @keydown.space.prevent="onTerminalClick(device, terminal.bus, side, terminal.column)"
          :stroke="wireColor(terminal.bus)"
          :data-terminal="`${device.instanceId}:${terminal.bus}:${side}:${terminal.column}`"
          @pointerenter="hoveredWire = { kind: 'terminal', instanceId: device.instanceId, bus: terminal.bus, side, column: terminal.column }"
          @pointerleave="hoveredWire = null"
          @click.stop="onTerminalClick(device, terminal.bus, side, terminal.column)"
          />
        </template>
      </g>
    </g>

    <!-- The buses are targets too, and the same shape of target as the clamps: a rail is where a
         wire is clamped as surely as a pocket is. They are drawn above the wires on purpose — every
         feed leaves a rail, so without that the wires would lie across the rails and swallow every
         click on them. -->
    <g v-if="tool === 'wire'" class="scene-bus-targets">
      <rect
        v-for="bus in scene.busRails"
        :key="`bus-target-${bus.bus}`"
        class="scene-bus-target"
        :class="{ 'is-start': pendingWire?.kind === 'bus' && pendingWire.bus === bus.bus }"
        :x="bus.x" :y="bus.y - 1.2" :width="bus.width" :height="bus.height + 2.4"
        :data-bus="bus.bus"
        :aria-label="bus.title" role="button" tabindex="0"
        @keydown.enter.prevent="onBusClick(bus.bus)"
        @keydown.space.prevent="onBusClick(bus.bus)"
        @pointerenter="hoveredWire = { kind: 'bus', bus: bus.bus }"
        @pointerleave="hoveredWire = null"
        @click.stop="onBusClick(bus.bus)"
      />
    </g>

    <path
      v-if="ghostPath"
      class="scene-wire-ghost"
      :d="ghostPath"
      :stroke="pendingWire ? wireColor(pendingWire.bus) : '#8a9599'"
      :style="{ strokeWidth: `${routeStroke(2)}px` }"
      fill="none"
    />
  </svg>



  <ul v-if="generalIssues.length" class="board-general-issues" role="status">
    <li v-for="entry in generalIssues" :key="entry.id">{{ entry.message }}</li>
  </ul>

  <input
    v-if="editing"
    ref="addressInput"
    class="board-address-input"
    :aria-label="editing.kind === 'load' ? 'Нагрузка цепи' : `Адрес: ${deviceById(editing.instanceId)?.name ?? 'устройство'}`"
    v-model="editing.value"
    :style="{ left: `${Math.max(24, ((canvas?.clientWidth ?? 0) - scene.width * scale) / 2) + editing.x * scale}px`, top: `${24 + editing.y * scale}px` }"
    @keydown.enter.prevent="commitEditor"
    @keydown.esc.prevent="cancelAddress"
    @blur="cancelAddress"
    @click.stop
  />
  </div>
  <p v-if="wireRefusal" class="board-wire-refusal" role="status">{{ wireRefusal }}</p>
  <p v-if="announced" class="board-issue-note" role="status">{{ announced }}</p>
  <BoardWireInspector :route-draft="routeDraft" @edit-route="beginRouteEdit" @apply-route="applyRouteEdit" @cancel-route="cancelRouteEdit"
    @add-route-point="addRoutePoint" @remove-route-point="removeRoutePoint" @set-route-layer="setRouteLayer" />
  </div>
</template>

<style scoped>
.board-stage { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.board-scene-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 24px;
  background-image: radial-gradient(var(--line) .7px, transparent .7px);
  background-size: 18px 18px;
}
.board-scene-canvas.can-pan, .board-scene-canvas.can-pan :deep(*) { cursor: grab; }
.board-scene-canvas.is-panning, .board-scene-canvas.is-panning :deep(*) { cursor: grabbing; }
.board-scene-canvas.can-pan { touch-action: none; }
.board-scene-canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.scene-device { touch-action: none; }
.board-scene {
  display: block;
  max-width: none;
  margin-inline: auto;
  background: var(--board-plate);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgb(0 0 0 / .08);
}
.board-wire-guide { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line); font-size: 12px; flex-wrap: wrap; }
.board-wire-guide small { display: block; color: var(--text-muted); margin-top: 3px; }
.board-wire-guide label { margin-left: auto; }
.wire-step { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: var(--on-accent); }
.scene-terminal.is-incompatible { opacity: .25; }
.scene-terminal:focus-visible, .scene-bus-target:focus-visible { outline: none; stroke: var(--accent); stroke-width: 1.2; }

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
  fill-opacity: .7;
  cursor: crosshair;
}

/* The buses are part of the panel, not an overlay on it, so they are drawn with the plate. */
.scene-bus-rail {
  fill-opacity: .85;
  stroke: var(--board-plate-edge);
  stroke-width: .25;
}

.scene-bus-label {
  font: 600 2.4px var(--mono);
  fill: var(--board-ink);
}

.scene-bus.is-wire-target .scene-bus-rail {
  fill-opacity: .45;
  stroke-dasharray: 1.2 .8;
}

.scene-bus-target {
  fill: var(--board-slot);
  fill-opacity: .001;
  cursor: crosshair;
}

.scene-bus-target.is-hover,
.scene-bus-target.is-start {
  fill-opacity: .5;
  stroke: var(--accent);
  stroke-width: .3;
}

/*
 * A wire is one or two millimetres wide and lies under the device it serves, so each one carries a
 * second, invisible copy of its own path, three millimetres wide, for the pointer to hit. It paints
 * nothing: `stroke: transparent` with `pointer-events: stroke` is exactly that.
 */
.scene-wire-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 3.4;
  stroke-linecap: round;
  pointer-events: stroke;
  cursor: pointer;
}

.scene-wire-hit:hover {
  stroke: var(--accent);
  stroke-opacity: .35;
}

.scene-wire-segment.is-selected {
  filter: drop-shadow(0 0 0.5mm var(--accent));
}

.scene-terminal.is-hover {
  fill-opacity: .45;
}

.scene-terminal.is-start {
  fill-opacity: .8;
  stroke-width: 0.7;
}

.scene-wire-ghost {
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
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
  bottom: 12px;
  left: 12px;
  max-width: calc(100% - 36px);
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
  bottom: 12px;
  left: 12px;
  max-width: calc(100% - 36px);
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

.scene-wire-segment {
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
.scene-device-marking,
.scene-device-name {
  /* Type in millimetres, so the marking keeps its size on the panel however the board is scaled. */
  font-family: var(--mono);
  fill: #263c30;
}

.scene-device-address {
  font-size: 2.6px;
  font-weight: 700;
}

.scene-device-marking {
  font-size: 1.9px;
  font-weight: 600;
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

<style scoped>
.scene-wire-segment { pointer-events: stroke; cursor: pointer; }
.scene-wire-segment.is-rear-ghost { stroke-dasharray: 5 4; opacity: .7; }
.scene-route-handle { fill: var(--surface); stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; cursor: move; touch-action: none; }
.scene-route-handle:focus { fill: var(--accent); outline: none; }
.scene-pending-points { fill: var(--accent); pointer-events: none; }
.board-wire-guide { flex-wrap: wrap; }
</style>
