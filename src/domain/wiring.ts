import { faceSocketGrid, getDeviceFaceMetrics, type DeviceFaceMetrics, type FacePocket } from './faceMetrics'
import type { BusType, DeviceDefinition } from './types'

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
  N: '#8a9599',
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

/**
 * Which bus each column belongs to.
 *
 * A single-pole breaker is the common case and the one that has to be right: two terminals, line
 * and neutral. A multi-pole device has one line per pole and a single shared neutral at the end,
 * which is why the neutral is the last column and not "the second column of each pole". Getting
 * this wrong is not cosmetic — it is the difference between a wire diagram a person can read and
 * one they learn to ignore.
 */
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
  const pockets = metrics.pockets
  if (!pockets.length) {
    // A terminal block has no top and bottom clamp rows; its connection points are the screws on
    // its face. Without this the block was unconnectable, which is where a wire lands on a real
    // board. The product names its own bus — a PE block is PE — so the wire is checked against
    // that rather than against whatever the person was holding.
    const sockets = faceSocketGrid(product, metrics)
    if (product.category === 'terminals' && sockets.length) {
      const left = sockets.filter((socket) => socket.cx === Math.min(...sockets.map((entry) => entry.cx)))
      const topSocket = left.reduce((a, b) => (a.cy <= b.cy ? a : b))
      const bottomSocket = left.reduce((a, b) => (a.cy >= b.cy ? a : b))
      const make = (socket: typeof sockets[number], side: 'top' | 'bottom'): Terminal => ({
        side, column: 0, label: side === 'top' ? '1' : '2', bus: product.bus,
        x: socket.cx, y: socket.cy, width: socket.r * 2, height: socket.r * 2,
      })
      return {
        top: [make(topSocket, 'top')],
        bottom: [make(bottomSocket, 'bottom')],
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

/** The terminal a wire of this bus should use: the first column carrying it. */
export const terminalForBus = (terminals: FaceTerminals, bus: BusType, side: 'top' | 'bottom'): Terminal | undefined => {
  const row = side === 'top' ? terminals.top : terminals.bottom
  const exact = row.find((terminal) => terminal.bus === bus)
  if (exact) return exact
  // A device without a neutral terminal — a busbar, an auxiliary contact — still has to be
  // connectable, so the first column stands in. The fallback is visible in the face: the terminal
  // that receives the wire is the one drawn under it.
  return row[0]
}

export interface WirePoint {
  x: number
  y: number
}

export interface RouteOptions {
  /** Where the wire starts: a busbar tap or the bottom of another device. */
  from: WirePoint
  /**
   * Where it lands: the centre of a terminal pocket. The height is the pocket's own, because the
   * wire has to stop short of the clamp face and not just short of the device outline.
   */
  to: WirePoint & { height: number }
  /**
   * A busbar wire runs along the top of the row and drops into the terminal; a wire between two
   * devices leaves a bottom terminal and has to find its way across and up, which is a different
   * shape entirely and reads as one if drawn the same way.
   */
  source: 'busbar' | 'device'
  /** A short straight stub out of the pocket, so the line does not vanish under the clamp. */
  stubMm?: number
}

/**
 * Orthogonal route with one bend, in millimetres.
 *
 * Two bends would be tidier to look at and worse to read: a wire that crosses the row twice makes
 * it impossible to follow where it goes, which is the one thing a wiring diagram has to make easy.
 */
export const routeWire = ({ from, to, source, stubMm = 2.2 }: RouteOptions) => {
  const stub = Math.max(0.8, stubMm)
  if (source === 'busbar') {
    // Along the rail line, then straight down into the terminal from above.
    const cornerX = to.x
    const entryY = to.y - to.height / 2 - stub
    return `M ${round(from.x)} ${round(from.y)} H ${round(cornerX)} V ${round(entryY)} L ${round(to.x)} ${round(to.y)}`
  }
  // Out of the bottom terminal, down into the free space under the row, across, then up into the
  // terminal of the device below.
  const exitY = from.y + stub
  const landingY = to.y - to.height / 2 - stub
  return `M ${round(from.x)} ${round(from.y)} V ${round(exitY)} H ${round(to.x)} V ${round(landingY)} L ${round(to.x)} ${round(to.y)}`
}

const round = (value: number) => Math.round(value * 100) / 100