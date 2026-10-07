import { faceSocketGrid, getDeviceFaceMetrics, type DeviceFaceMetrics, type FacePocket } from './faceMetrics'
import type { BusType, Connection, DeviceDefinition, PlacedDevice } from './types'

/**
 * Where a wire physically attaches, and how it gets there.
 *
 * Until now the board drew every wire as a line from the busbar to the middle of the device, and
 * drew no wire at all between two devices: the terminal openings were on the face, but nothing
 * used them. The result looked like a diagram drawn over a picture of the panel rather than like
 * wiring — and a cascade of breakers, which is how most real boards are built, was invisible.
 *
 * Everything here works in the millimetre space of the face and returns millimetres too; the board
 * scales once, at the edge, so the geometry that decides where a wire lands and the geometry that
 * draws the clamp it lands in can never disagree.
 */

/** What a terminal is for. `aux` covers supply terminals, auxiliaries and anything unlabelled. */
export type TerminalBus = BusType | 'aux'

/**
 * The colour of a conductor, in one place.
 *
 * Three places were drawing wires and two of them had their own copy of this table, so a fourth
 * place had to be added rather than reused. The colour is not decoration here: it is how a reader
 * tells live, neutral and earth apart on a black and white printout that lost its colour anyway.
 */
export const WIRE_COLOR = {
  L: '#a44d37',
  N: '#428bc1',
  PE: '#47a067',
} as const

export const wireColor = (bus: string) => WIRE_COLOR[bus as keyof typeof WIRE_COLOR] ?? '#8a9599'

export interface Terminal {
  /** Top row is the line side, bottom row is the load side. */
  side: 'top' | 'bottom'
  column: number
  /** The number printed on the device: 1, 2, 3, N, PE. */
  label: string
  bus: TerminalBus
  /** Pocket centre, in millimetres from the top-left corner of the face. */
  x: number
  y: number
  width: number
  height: number
}

export interface FaceTerminals {
  top: Terminal[]
  bottom: Terminal[]
  widthMm: number
  heightMm: number
}

/** Bus carried by each physical column, based on the device category and pole layout. */
export const terminalBus = (product: DeviceDefinition, column: number, columns: number): TerminalBus => {
  if (columns <= 0) return 'aux'
  const category = product.category
  if (category === 'PSU') return (['L', 'N', 'aux', 'aux'] as TerminalBus[])[column] ?? 'aux'
  if (category === 'terminals' || category === 'busbar') return 'aux'
  // A supply's terminals are what it declares; nothing below may second-guess them.
  if (category === 'relay' || category === 'meter') return 'aux'

  // Whether the last column is the neutral or another line is not a matter of taste — it follows
  // from what the device is. A 230 V breaker on a single-phase board switches the line *and* the
  // neutral, so its second column is N. A 400 V device switches lines only, and a residual current
  // device with three or more poles carries the neutral on its last pole. Marking a three-phase
  // breaker's third terminal as N was a real error here: it would send the neutral wire of a
  // single-phase circuit into a phase clamp.
  const carriesNeutral = product.voltage === 230 ? columns >= 2 : (category === 'RCCB' || category === 'RCBO') && columns >= 3
  return carriesNeutral && column === columns - 1 ? 'N' : 'L'
}

const makeTerminal = (pocket: FacePocket, side: 'top' | 'bottom', product: DeviceDefinition, columns: number): Terminal => ({
  side,
  column: pocket.column,
  label: side === 'top' ? pocket.topLabel : pocket.bottomLabel,
  bus: terminalBus(product, pocket.column, columns),
  x: pocket.x + pocket.width / 2,
  y: pocket.y + pocket.height / 2,
  width: pocket.width,
  height: pocket.height,
})

/**
 * The two rows of terminals of a face.
 *
 * The pockets come from the same `getDeviceFaceMetrics` that draws the device, so a wire lands in
 * the clamp that was actually painted. The bottom row is recognised by its position rather than by
 * a second array in the metrics: the metrics store the top pockets first and the mirrored ones
 * after them, one per column.
 */
export const faceTerminals = (product: DeviceDefinition, metrics: DeviceFaceMetrics = getDeviceFaceMetrics(product)): FaceTerminals => {
  if (product.category === 'busbar') {
    const terminal: Terminal = { side: 'bottom', column: 0, label: product.bus, bus: product.bus,
      x: metrics.widthMm / 2, y: metrics.heightMm, width: 4, height: 2 }
    return { top: [], bottom: [terminal], widthMm: metrics.widthMm, heightMm: metrics.heightMm }
  }
  const pockets = metrics.pockets
  if (!pockets.length) {
    // A terminal block has no top and bottom clamp rows; its connection points are the screws on
    // its face. Without this the block was unconnectable, which is where a wire lands on a real
    // board. The product names its own bus — a PE block is PE — so the wire is checked against
    // that rather than against whatever the person was holding.
    //
    // Every screw is its own terminal. The block was six screws drawn as two of them, which is the
    // one thing a terminal block is not: four landings had nowhere to go, and three wires arriving
    // at one screw were drawn on top of each other. The first screw of each row keeps column 0, so
    // a block wired before this change still lands where it always did.
    const sockets = faceSocketGrid(product, metrics)
    if (product.category === 'terminals' && sockets.length) {
      const rows = [...new Set(sockets.map((socket) => socket.cy))].sort((a, b) => a - b)
      const rowOf = (socket: typeof sockets[number]) => rows.indexOf(socket.cy)
      const top = sockets.filter((socket) => rowOf(socket) === 0)
      const rest = sockets.filter((socket) => rowOf(socket) > 0)
      const make = (socket: typeof sockets[number], side: 'top' | 'bottom', column: number, label: string): Terminal => ({
        side, column, label, bus: product.bus,
        x: socket.cx, y: socket.cy, width: socket.r * 2, height: socket.r * 2,
      })
      return {
        top: top.map((socket, index) => make(socket, 'top', index, String(index + 1))),
        bottom: rest.map((socket, index) => make(socket, 'bottom', index, String(index + 1 + top.length))),
        widthMm: metrics.widthMm, heightMm: metrics.heightMm,
      }
    }
    return { top: [], bottom: [], widthMm: metrics.widthMm, heightMm: metrics.heightMm }
  }
  const half = pockets.length / 2
  const top = pockets.slice(0, half)
  const bottom = pockets.slice(half)
  const columns = Math.max(...top.map((pocket) => pocket.column), ...bottom.map((pocket) => pocket.column)) + 1
  return {
    top: top.map((pocket) => makeTerminal(pocket, 'top', product, columns)),
    bottom: bottom.map((pocket) => makeTerminal(pocket, 'bottom', product, columns)),
    widthMm: metrics.widthMm,
    heightMm: metrics.heightMm,
  }
}

/** Whether at least one physical clamp accepts this bus. */
export const hasTerminalForBus = (product: DeviceDefinition, bus: BusType, metrics?: DeviceFaceMetrics): boolean =>
  Object.values(faceTerminals(product, metrics ?? getDeviceFaceMetrics(product))).some((row) =>
    Array.isArray(row) && row.some((terminal: Terminal) => terminal.bus === bus || terminal.bus === 'aux'))

/** Resolve a physical clamp without moving an explicitly selected endpoint. */
export const terminalForBus = (terminals: FaceTerminals, bus: BusType, side: 'top' | 'bottom', column?: number): Terminal | undefined => {
  if ((side !== 'top' && side !== 'bottom') || !['L', 'N', 'PE'].includes(bus)) return undefined
  const row = terminals[side]
  const compatible = (terminal: Terminal) => terminal.bus === bus || terminal.bus === 'aux'
  if (column !== undefined) {
    const terminal = row.find((candidate) => candidate.column === column)
    return terminal && compatible(terminal) ? terminal : undefined
  }
  // Legacy projects without a column may choose a compatible clamp on the saved side.
  return row.find((terminal) => terminal.bus === bus) ?? row.find((terminal) => terminal.bus === 'aux')
}

/** Whether a valid conductor ends on this exact physical clamp, in either drawing direction. */
export const connectionTouchesTerminal = (
  connection: Connection,
  devices: PlacedDevice[],
  definitions: Map<string, DeviceDefinition>,
  instanceId: string,
  bus: BusType,
  side: 'top' | 'bottom' = 'top',
  column?: number,
): boolean => {
  if (connection.fromBus !== bus) return false
  if (connection.kind === 'bus' && connection.fromDeviceId) return false
  if (connection.kind === 'busbar' && !connection.fromDeviceId) return false
  if (connection.kind !== undefined && !['bus', 'busbar', 'circuit'].includes(connection.kind)) return false
  const resolve = (id: string, terminalSide: 'top' | 'bottom', terminalColumn?: number) => {
    const device = devices.find((item) => item.instanceId === id)
    const product = device && definitions.get(device.productId)
    return product ? terminalForBus(faceTerminals(product), bus, terminalSide, terminalColumn) : undefined
  }
  const requested = resolve(instanceId, side, column)
  const target = resolve(connection.toDeviceId, connection.toSide ?? 'top', connection.terminal)
  const source = connection.fromDeviceId
    ? resolve(connection.fromDeviceId, connection.fromSide ?? 'bottom', connection.fromTerminal)
    : undefined
  if (!requested || !target || (connection.fromDeviceId && !source)) return false
  if (connection.fromDeviceId === connection.toDeviceId && source?.side === target.side && source.column === target.column) return false
  const matches = (id: string | undefined, terminal: Terminal | undefined) =>
    id === instanceId && terminal?.side === requested.side && terminal.column === requested.column
  return matches(connection.toDeviceId, target) || matches(connection.fromDeviceId, source)
}

export interface WirePoint {
  x: number
  y: number
}

export interface RouteOptions {
  /** Where the wire starts: a tap on a bus rail, a fork, or the bottom of another device. */
  from: WirePoint
  /**
   * Where it lands: the centre of a terminal pocket. The height is the pocket's own, because the
   * wire has to stop short of the clamp face and not just short of the device outline.
   */
  to: WirePoint & { height: number }
  /**
   * A busbar wire runs along the rail and drops into the terminal; a wire between two devices
   * leaves a bottom terminal and has to find its way across and up, which is a different shape
   * entirely and reads as one if drawn the same way.
   */
  source: 'busbar' | 'device'
  /** A short straight stub out of the pocket, so the line does not vanish under the clamp. */
  stubMm?: number
  /**
   * The column a wire falls down, when it is not the column of the clamp it enters.
   *
   * A feed to a lower row has to pass the rows above it. Falling straight from the rail to the clamp
   * would cross whatever stands in the way, so the wire runs down a free channel and only then
   * crosses horizontally above the device it serves — the way it is run in the vertical duct.
   */
  descentX?: number
  /**
   * Draw the run upwards when the clamp it enters is above the one it leaves.
   *
   * Without this a cascade into a device higher up the panel dropped below its own row, crossed the
   * whole board under the devices, and climbed back — three crossings to reach a terminal that was
   * straight above it. Which is the case is a fact about the two positions, so it is decided here
   * rather than passed in from the caller that happened to know.
   */
  upward?: boolean
  fromSide?: 'top' | 'bottom'
  toSide?: 'top' | 'bottom'
  exitY?: number
  entryY?: number
}

/**
 * Orthogonal route, in millimetres.
 *
 * One bend for the common case, and two at the most: a wire that crosses the row twice makes it
 * impossible to follow where it goes, which is the one thing a wiring diagram has to make easy.
 *
 * Wires of one bundle are spread apart by the caller, which moves the start point rather than the
 * path: a wire that leaves the rail at a slightly different millimetre is still a wire to that
 * clamp, while a route bent around an offset would no longer be the same shape for every wire.
 */
export const routeWire = ({ from, to, source, stubMm = 2.2, upward, descentX, fromSide, toSide, exitY: sourceExit, entryY: targetEntry }: RouteOptions) => {
  const stub = Math.max(0.8, stubMm)
  const entryY = targetEntry ?? (to.y + (toSide === 'bottom' ? 1 : -1) * (to.height / 2 + stub))
  if (source === 'device' && (sourceExit !== undefined || fromSide !== undefined || toSide !== undefined)) {
    const exitY = sourceExit ?? from.y + (fromSide === 'top' ? -stub : stub)
    const channel = descentX ?? (from.x + to.x) / 2
    return `M ${round(from.x)} ${round(from.y)} V ${round(exitY)} H ${round(channel)} V ${round(entryY)} H ${round(to.x)} L ${round(to.x)} ${round(to.y)}`
  }
  if (source === 'busbar') {
    // Along the rail, then straight down into the terminal from above.
    const descent = descentX ?? to.x
    if (Math.abs(descent - to.x) < 0.01) {
      return `M ${round(from.x)} ${round(from.y)} H ${round(to.x)} V ${round(entryY)} L ${round(to.x)} ${round(to.y)}`
    }
    return `M ${round(from.x)} ${round(from.y)} H ${round(descent)} V ${round(entryY)} H ${round(to.x)} L ${round(to.x)} ${round(to.y)}`
  }
  const up = upward ?? to.y < from.y
  if (up) {
    // Straight up the free space above the row and down into the terminal from above.
    return `M ${round(from.x)} ${round(from.y)} V ${round(entryY)} H ${round(to.x)} L ${round(to.x)} ${round(to.y)}`
  }
  // Out of the bottom terminal, down into the free space under the row, across, then up into the
  // terminal of the device below.
  const exitY = from.y + stub
  return `M ${round(from.x)} ${round(from.y)} V ${round(exitY)} H ${round(to.x)} V ${round(entryY)} L ${round(to.x)} ${round(to.y)}`
}

const round = (value: number) => Math.round(value * 100) / 100

/** Physical identity includes both clamps; clicking in reverse creates the same conductor. */
export const connectionKey = (connection: Connection, devices: PlacedDevice[], definitions: Map<string, DeviceDefinition>) => {
  const endpoint = (id: string, side: 'top' | 'bottom', column?: number) => {
    const device = devices.find((item) => item.instanceId === id)
    const product = device && definitions.get(device.productId)
    const terminal = product ? terminalForBus(faceTerminals(product), connection.fromBus, side, column) : undefined
    return `${id}:${side}:${column ?? terminal?.column ?? 0}`
  }
  const from = connection.fromDeviceId
    ? endpoint(connection.fromDeviceId, connection.fromSide ?? 'bottom', connection.fromTerminal)
    : `bus:${connection.fromBus}`
  const to = endpoint(connection.toDeviceId, connection.toSide ?? 'top', connection.terminal)
  return JSON.stringify([connection.fromBus, ...[from, to].sort()])
}
