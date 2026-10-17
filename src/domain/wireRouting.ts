import { PANEL_MM_TO_PX } from './panelGeometry'
import type { PanelGeometry } from './panelGeometry'
import { deviceTerminals, facePlacementMm, terminalAnchorMm, terminalKey, terminalLabel, terminalType, wireColor } from './terminals'
import type { TerminalRef, TerminalSide, TerminalType } from './terminals'
import type { BusAssembly, Connection, DeviceDefinition, PanelProject, PlacedDevice, RowComb } from './types'

/**
 * Orthogonal wire routing for the board drawing. Every decision is made in millimetres over a
 * small frame description, so the result can be asserted in a unit test without mounting the
 * editor, and the same numbers drive the SVG overlay and the terminal hit targets. Only the
 * final geometry leaves this module in pixels, because the overlay's viewBox is the plate in
 * pixels; converting in one place is what keeps a wire landing on the clamp it names.
 */
const mm = (value: number) => value * PANEL_MM_TO_PX

/** How far above or below a row the horizontal runs of its wires sit, millimetres. */
export const CORRIDOR_MM = 3.6
/** Horizontal spacing between the vertical channels that feed one device, millimetres. */
export const LANE_MM = 2.6
/** Height of a drawn N/PE bar, millimetres. */
export const BUS_BAR_HEIGHT_MM = 5.4
/** Vertical gap between the two bars, millimetres. */
export const BUS_BAR_GAP_MM = 4.2
/** Where the incoming channels start on the free plate strip left of the first rail module. */
const INCOMING_MARGIN_MM = 4
const INCOMING_PITCH_MM = 3.4
const PLATE_BOTTOM_MARGIN_MM = 6

export interface RoutedBus {
  id: string
  kind: 'L' | 'N' | 'PE'
  placement: 'top' | 'bottom'
  x: number
  y: number
  width: number
  height: number
  label: string
}

export interface WirePoint { x: number; y: number }

export interface RoutedWire {
  id: string
  /** The orthogonal run in plate pixels, ready for an SVG `d`. */
  d: string
  /** The same run as a point list in plate pixels, for hit targets and the label badge. */
  points: WirePoint[]
  /** Midpoint of the longest horizontal run, where the marking badge is drawn. */
  labelAt: WirePoint
  /** The colour the conductor is drawn in: the bus palette, unless the user picked one. */
  color: string
  /**
   * True when the colour came from the connection rather than the bus palette. The drawing lets
   * the stylesheet own the palette and applies an inline stroke only for this case, so a board
   * that never overrides a colour keeps following the theme, and one that does gets what the
   * inspector promised it.
   */
  customColor: boolean
  /** Conductor cross-section in millimetres, as the inspector and the print report quote it. */
  thickness: number
  label: string
  bus: 'L' | 'N' | 'PE'
  phase?: 1 | 2 | 3
  kind: 'circuit' | 'busbar' | 'jumper'
  /** The planner line this conductor belongs to, so the board can highlight a selected line. */
  circuitId?: string
}

export interface RoutedBoard {
  wires: RoutedWire[]
  buses: RoutedBus[]
  combs: RoutedComb[]
}

/** A comb drawn above its row: the bar that bridges the run, and one tooth per pole. */
export interface RoutedComb {
  id: string
  row: number
  poles: 1 | 2 | 3 | 4
  /** Bar body, in plate pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Teeth dropping from the bar into the top clamps, in plate pixels. */
  teeth: WirePoint[]
  /** True when the comb covers fewer devices than it has poles to feed. */
  starved: boolean
  label: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Collapses the straight runs a step-by-step walk produces into an SVG path. */
const pathOf = (points: WirePoint[]): string =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

/** The plate-local frame the router needs, in millimetres from the mounting plate's top-left. */
export interface WireFrame {
  plateWidthMm: number
  plateHeightMm: number
  railStartXMm: number
  railWidthMm: number
  rows: number
  rowTopMm: (row: number) => number
  rowHeightMm: (row: number) => number
  deviceLeftMm: (device: PlacedDevice) => number
  deviceTopMm: (device: PlacedDevice) => number
  deviceWidthMm: (device: PlacedDevice) => number
  deviceHeightMm: (device: PlacedDevice) => number
}

/** Reads the millimetre frame the router needs out of the panel geometry the board already has. */
export const wireFrameFromGeometry = (geometry: PanelGeometry): WireFrame => ({
  plateWidthMm: geometry.plateWidthMm,
  plateHeightMm: geometry.plateHeightMm,
  railStartXMm: geometry.railStartXMm,
  railWidthMm: geometry.railWidthMm,
  rows: geometry.rowTopMm.length,
  // geometry.rowTopMm is measured from the cabinet top, while the overlay's viewBox starts at the
  // plate. Every frame coordinate is plate-local, so the offset is taken off here once rather
  // than at each use — a corridor left 24mm low runs a wire straight through the device row.
  // A row the cabinet no longer has falls back to the plate's own top edge: the zero of the
  // geometry is the cabinet top, which sits above the plate, so a plain zero here would hand
  // the caller a corridor drawn off the top of the board.
  rowTopMm: (row) => (geometry.rowTopMm[row] ?? geometry.plateTopMm) - geometry.plateTopMm,
  rowHeightMm: (row) => geometry.rowHeightsMm[row] ?? 0,
  deviceLeftMm: (device) => geometry.railStartXMm + device.slot * (geometry.railWidthMm / Math.max(1, geometry.capacity)),
  deviceTopMm: (device) => geometry.deviceTopMm(device.row, device.productId) - geometry.plateTopMm,
  deviceWidthMm: (device) => geometry.deviceWidthMm(device.productId),
  deviceHeightMm: (device) => geometry.deviceHeightMm(device.productId),
})

interface Anchor extends WirePoint { device: PlacedDevice; side: TerminalSide }

const anchorFor = (
  ref: TerminalRef, frame: WireFrame, definitions: Map<string, DeviceDefinition>,
  devices: Map<string, PlacedDevice>, fallbackSide: TerminalSide = 'top',
): Anchor | null => {
  const device = devices.get(ref.deviceId)
  if (!device) return null
  const product = definitions.get(device.productId)
  if (!product) return null
  const side: TerminalSide = ref.side === 'bottom' ? 'bottom' : ref.side === 'top' ? 'top' : fallbackSide
  const point = terminalAnchorMm(product, ref.pole, side)
  if (!point) return null
  // The face is drawn in its own viewBox and letterboxed into the device box, so the clamp only
  // lands on the board after the same fit the SVG applies.
  const fit = facePlacementMm(product, frame.deviceWidthMm(device), frame.deviceHeightMm(device))
  return {
    x: frame.deviceLeftMm(device) + fit.offsetXMm + point.x * fit.scale,
    y: frame.deviceTopMm(device) + fit.offsetYMm + point.y * fit.scale,
    device,
    side,
  }
}

/** Where a line lands when it names no terminal: the device's first phase clamp on top. */
const defaultTerminal = (product: DeviceDefinition): TerminalRef['pole'] => {
  const columns = Math.max(1, Math.round(product.moduleWidth || 1))
  for (let column = 0; column < columns; column += 1) {
    const label = terminalLabel(product, column, columns, false)
    if (terminalType(product, column, columns, false) === 'phase') return parseInt(label, 10) || column + 1
  }
  return 1
}

/** The corridor a wire runs in: above the row for a top clamp, below it for a bottom one. */
export const corridorYMm = (frame: WireFrame, row: number, side: TerminalSide): number =>
  side === 'top'
    ? frame.rowTopMm(row) - CORRIDOR_MM
    : frame.rowTopMm(row) + frame.rowHeightMm(row) + CORRIDOR_MM

/** Bars run along the plate edge, so a wire can drop straight from the bar into a row corridor. */
export const busBarLayout = (frame: WireFrame, buses: BusAssembly[]): Map<string, RoutedBus> => {
  const result = new Map<string, RoutedBus>()
  const bottom = buses.filter((bus) => bus.placement === 'bottom')
  const top = buses.filter((bus) => bus.placement === 'top')
  const place = (bus: BusAssembly, index: number, count: number, edge: 'top' | 'bottom') => {
    const pitch = BUS_BAR_HEIGHT_MM + BUS_BAR_GAP_MM
    const stackHeight = count * BUS_BAR_HEIGHT_MM + Math.max(0, count - 1) * BUS_BAR_GAP_MM
    // Bottom bars grow upward from the plate edge, top bars grow downward, so the outermost
    // bar always sits the same distance from its edge whichever kind the project has.
    const y = edge === 'bottom'
      ? frame.plateHeightMm - PLATE_BOTTOM_MARGIN_MM - stackHeight + index * pitch
      : PLATE_BOTTOM_MARGIN_MM + (count - 1 - index) * pitch
    result.set(bus.id, {
      id: bus.id,
      kind: bus.kind,
      placement: bus.placement,
      x: 0,
      y,
      width: frame.plateWidthMm,
      height: BUS_BAR_HEIGHT_MM,
      label: bus.label || bus.kind,
    })
  }
  bottom.forEach((bus, index) => place(bus, index, bottom.length, 'bottom'))
  top.forEach((bus, index) => place(bus, index, top.length, 'top'))
  return result
}

/**
 * A comb bridges the top clamps of a run of devices, so it is drawn in the corridor above its row
 * with a tooth dropping into each clamp it feeds. The teeth land on the same anchors the wires use,
 * which is what makes a comb and a hand-drawn jumper look like the same board.
 */
export const combLayout = (
  frame: WireFrame,
  combs: RowComb[],
  devices: Map<string, PlacedDevice>,
  definitions: Map<string, DeviceDefinition>,
): RoutedComb[] =>
  (combs ?? []).map((comb) => {
    const from = Math.min(comb.fromSlot, comb.toSlot)
    const to = Math.max(comb.fromSlot, comb.toSlot)
    // The devices the comb actually spans, in rail order. A gap in the row leaves a hole in the
    // run, so the teeth follow the devices rather than the slot numbers.
    const covered = [...devices.values()]
      .filter((device) => device.row === comb.row && device.slot >= from && device.slot <= to)
      .sort((left, right) => left.slot - right.slot)
    const teeth: WirePoint[] = []
    for (const device of covered.slice(0, comb.poles)) {
      const product = definitions.get(device.productId)
      if (!product) continue
      const anchor = anchorFor({ deviceId: device.instanceId, pole: 1, side: 'top' }, frame, definitions, devices)
      if (anchor) teeth.push({ x: mm(anchor.x), y: mm(anchor.y) })
    }
    const barY = mm(corridorYMm(frame, comb.row, 'top') - CORRIDOR_MM * 0.55)
    const barHeight = mm(2.2)
    const left = teeth.length ? Math.min(...teeth.map((tooth) => tooth.x)) : 0
    const right = teeth.length ? Math.max(...teeth.map((tooth) => tooth.x)) : 0
    return {
      id: comb.id,
      row: comb.row,
      poles: comb.poles,
      x: left,
      y: barY,
      // A comb needs at least a tooth's width of bar to read as a bar rather than a dot.
      width: Math.max(right - left, right ? mm(4) : 0),
      height: barHeight,
      teeth,
      starved: covered.length < comb.poles,
      label: comb.label || `Гребёнка ${comb.poles}P`,
    }
  })

/** Appends a step only when it moves, so the generated path has no zero-length segments. */
const walk = (points: WirePoint[], x: number, y: number): WirePoint[] => {
  const last = points[points.length - 1]
  if (last && last.x === x && last.y === y) return points
  return [...points, { x, y }]
}

/**
 * What the badge on the conductor reads. A wire drawn by hand names two clamps, and that text is
 * the inspector's, not the board's: on a 12-module-wide rail a badge long enough to spell
 * «QF01:1 верх → QF03:1 верх» would cover the very devices it connects. The board shows what an
 * installer reads off it in the field: the line's name when the wire belongs to one — the way a
 * worksheet and a marking sheet spell it — or the phase/N/PE for a conductor without a line.
 * A line that predates clamping, or that an installer named by hand, keeps its own text.
 */
export const wireBadge = (
  connection: { label: string; fromBus: string; phase?: 1 | 2 | 3; fromTerminal?: unknown; toTerminal?: unknown },
  lineName?: string,
): string => {
  if (!connection.toTerminal) return connection.label
  if (lineName) return lineName.length > 24 ? `${lineName.slice(0, 23)}…` : lineName
  if (connection.fromBus === 'N' || connection.fromBus === 'PE') return connection.fromBus
  return `L${connection.phase ?? 1}`
}

/**
 * Where a wire's badge sits: the middle of its longest horizontal run. A horizontal stretch is the
 * only part of an orthogonal route long enough to hold a label without covering a corner or a
 * neighbouring conductor, and a corner is exactly where two wires tend to cross.
 */
const labelAnchor = (points: WirePoint[]): WirePoint => {
  let best = { x: 0, y: 0, span: -1 }
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (from.y !== to.y) continue
    const span = Math.abs(to.x - from.x)
    if (span <= best.span) continue
    best = { x: (from.x + to.x) / 2, y: from.y, span }
  }
  if (best.span >= 0) return { x: best.x, y: best.y }
  const only = points[0] ?? { x: 0, y: 0 }
  return only
}

/**
 * Routes every connection of a project. Wires entering from the incoming side climb the free
 * plate strip left of the first module and turn into the row corridor; wires leaving a bar run
 * up the same strip from the bar itself. Both then run horizontally and drop into the clamp, so
 * no wire ever crosses a device body on its way to a terminal.
 */
export const routeBoard = (project: PanelProject, definitions: Map<string, DeviceDefinition>, frame: WireFrame): RoutedBoard => {
  const devices = new Map(project.devices.map((device) => [device.instanceId, device]))
  const lineNames = new Map((project.circuits ?? []).map((circuit) => [circuit.id, circuit.name]))
  const busBars = busBarLayout(frame, project.busAssemblies ?? [])
  const buses = [...busBars.values()]
  const wires: RoutedWire[] = []

  // One lane counter for the whole incoming strip. Counting per source kind handed the L, N
  // and PE feeders of one line the same lane — three conductors drawn as one line, which is
  // exactly the unreadability the strip exists to prevent. Jumper and busbar channels keep
  // their own counters: they leave the strip to the feeders and only space themselves.
  let incomingLane = 0
  const nextStripLane = () => incomingLane++
  const incomingXMm = (lane: number) => INCOMING_MARGIN_MM + lane * INCOMING_PITCH_MM
  const channelLanes = new Map<string, number>()
  const nextChannelLane = (key: string) => {
    const used = channelLanes.get(key) ?? 0
    channelLanes.set(key, used + 1)
    return used
  }

  for (const connection of project.connections ?? []) {
    const target = connection.toTerminal
      ? anchorFor(connection.toTerminal, frame, definitions, devices)
      : (() => {
        const device = devices.get(connection.toDeviceId)
        const product = device ? definitions.get(device.productId) : undefined
        if (!device || !product) return null
        return anchorFor({ deviceId: device.instanceId, pole: defaultTerminal(product), side: 'top' }, frame, definitions, devices)
      })()
    if (!target) continue

    const corridorY = corridorYMm(frame, target.device.row, target.side)
    let points: WirePoint[]

    if (connection.kind === 'jumper' && connection.fromTerminal) {
      const from = anchorFor(connection.fromTerminal, frame, definitions, devices, 'bottom')
      if (!from) continue
      // A jumper between two clamps is drawn in the corridor of the row it leaves, then drops
      // into the second clamp. Both ends are on devices, so no incoming strip is involved.
      const lane = (nextChannelLane(`jumper:${from.device.row}:${from.side}`) - 0.5) * LANE_MM
      const channelX = clamp(from.x + lane, frame.railStartXMm - INCOMING_PITCH_MM * 6, frame.railStartXMm + frame.railWidthMm)
      const exitY = corridorYMm(frame, from.device.row, from.side)
      const entryY = from.side === target.side ? exitY : corridorYMm(frame, target.device.row, target.side)
      points = [{ x: from.x, y: from.y }]
      points = walk(points, from.x, exitY)
      points = walk(points, channelX, exitY)
      points = walk(points, channelX, entryY)
      points = walk(points, target.x, entryY)
      points = walk(points, target.x, target.y)
    } else if (connection.kind === 'busbar' && connection.fromDeviceId) {
      const bar = devices.get(connection.fromDeviceId)
      if (!bar) continue
      const barX = frame.deviceLeftMm(bar) + frame.deviceWidthMm(bar)
      const barY = frame.deviceTopMm(bar) + frame.deviceHeightMm(bar) / 2
      const lane = (nextChannelLane(`bar:${connection.fromDeviceId}`) - 0.5) * LANE_MM
      const barMidX = barX + frame.deviceWidthMm(bar) / 2
      points = [{ x: barX + lane, y: barY }]
      points = walk(points, barMidX, barY)
      points = walk(points, barMidX, corridorY)
      points = walk(points, target.x, corridorY)
      points = walk(points, target.x, target.y)
    } else {
      const bar = connection.busId ? busBars.get(connection.busId) : undefined
      const laneX = Math.min(incomingXMm(nextStripLane()), Math.max(INCOMING_MARGIN_MM, frame.railStartXMm - 2))
      // A bar-fed wire climbs the incoming strip from the bar; an L wire has no bar behind it
      // and simply starts on the corridor, which is the incoming zone of the board.
      const sourceY = bar ? bar.y + bar.height / 2 : corridorY
      points = [{ x: laneX, y: sourceY }]
      points = walk(points, laneX, corridorY)
      points = walk(points, target.x, corridorY)
      points = walk(points, target.x, target.y)
    }

    const scaled = points.map((point) => ({ x: mm(point.x), y: mm(point.y) }))
    const at = labelAnchor(scaled)
    wires.push({
      id: connection.id,
      d: pathOf(scaled),
      points: scaled,
      labelAt: at,
      color: wireColor(connection),
      // An empty colour is the conductor asking to be painted in its bus colour, so only a
      // colour the user actually chose overrides what the stylesheet would have picked.
      customColor: Boolean(connection.color),
      thickness: connection.thickness > 0 ? connection.thickness : 2,
      label: wireBadge(connection, connection.circuitId ? lineNames.get(connection.circuitId) : undefined),
      bus: connection.fromBus,
      phase: connection.phase,
      kind: connection.kind ?? 'circuit',
      circuitId: connection.circuitId || undefined,
    })
  }

  return {
    wires,
    combs: combLayout(frame, project.combs ?? [], devices, definitions),
    buses: buses.map((bus) => ({
      ...bus,
      x: mm(bus.x),
      y: mm(bus.y),
      width: mm(bus.width),
      height: mm(bus.height),
    })),
  }
}

/** One clickable clamp on the board. The hit target and the conductor share these numbers. */
export interface TerminalTarget {
  key: string
  deviceId: string
  address: string
  pole: number
  side: TerminalSide
  label: string
  type: TerminalType
  /** Clamp centre in plate pixels, exactly where a wire drawn to this terminal lands. */
  x: number
  y: number
  occupied: boolean
}

/**
 * Every clamp on the board, in plate pixels. The wire tool needs targets that agree with the
 * drawing to the pixel, so they are read out of the same anchors the router uses rather than
 * measured from the rendered face — a hit zone that drifts from its screw is worse than none.
 */
export const terminalTargets = (
  project: PanelProject, definitions: Map<string, DeviceDefinition>, frame: WireFrame,
): TerminalTarget[] => {
  const devices = new Map(project.devices.map((device) => [device.instanceId, device]))
  const targets: TerminalTarget[] = []
  for (const device of project.devices) {
    if (device.mount === 'busbar') continue
    const product = definitions.get(device.productId)
    if (!product) continue
    for (const info of deviceTerminals(product)) {
      const anchor = anchorFor({ deviceId: device.instanceId, pole: info.pole, side: info.side }, frame, definitions, devices)
      if (!anchor) continue
      const ref: TerminalRef = { deviceId: device.instanceId, pole: info.pole, side: info.side }
      targets.push({
        key: terminalKey(ref),
        deviceId: device.instanceId,
        address: device.address,
        pole: info.pole,
        side: info.side,
        label: info.label,
        type: info.type,
        x: mm(anchor.x),
        y: mm(anchor.y),
        occupied: terminalOccupied(project, ref),
      })
    }
  }
  return targets
}

export const routeConnections = (
  project: PanelProject,
  definitions: Map<string, DeviceDefinition>,
  geometry: PanelGeometry,
): RoutedWire[] => routeBoard(project, definitions, wireFrameFromGeometry(geometry)).wires

/** True when a clamp is already taken, so the wire tool can refuse a second conductor. */
export const terminalOccupied = (project: PanelProject, ref: TerminalRef, ignoreId?: string): boolean =>
  (project.connections ?? []).some((connection: Connection) =>
    connection.id !== ignoreId && (sameEnd(connection.fromTerminal, ref) || sameEnd(connection.toTerminal, ref)))

const sameEnd = (end: TerminalRef | undefined, ref: TerminalRef): boolean =>
  Boolean(end && end.deviceId === ref.deviceId && end.pole === ref.pole && end.side === ref.side)
