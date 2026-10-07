import { getDeviceFaceMetrics, type DeviceFaceMetrics } from './faceMetrics'
import { getPanelGeometry, type PanelGeometry } from './panelGeometry'
import { buildBusRails, BUS_SHORT_TITLE, type BusRail } from './busRail'
import { faceTerminals, manualWireSegments, routeWire, routeWirePoints, terminalForBus, type FaceTerminals, type WireSegment } from './wiring'
import type { BusType, Connection, DeviceDefinition, PanelProject, WirePoint, WireRoute } from './types'

/**
 * The whole board as one scene, in millimetres, ready to be drawn by a single SVG.
 *
 * The editor this replaces drew each device as its own nested `<svg>` scaled to fit a pixel width,
 * while the plate underneath worked in board millimetres at a fixed scale. Two coordinate systems
 * on one screen is why a wire could land on the right column and miss the clamp by 21 pixels: the
 * x came out of the board's millimetres and the y out of the face's, and the two scales differed by
 * a fifth.
 *
 * Everything here is computed once, in millimetres, and converted to pixels exactly once when it
 * is handed to the view. A wire and the clamp it lands in are two facts about the same millimetre,
 * so they cannot drift apart.
 */

export interface SceneDevice {
  instanceId: string
  address: string
  marking: string
  note: string
  category: string
  brand: string
  name: string
  /** A fork or rail is mounted across the panel rather than clipped to a DIN rail. */
  mount: 'din' | 'busbar'
  /** The catalogue entry itself, so the scene can be drawn without looking anything up again. */
  product?: DeviceDefinition
  row: number
  slot: number
  quantity: number
  missingProduct: boolean
  /** Top-left corner in board millimetres. */
  x: number
  y: number
  width: number
  height: number
  face: DeviceFaceMetrics
  terminals: FaceTerminals
}

export interface SceneWire {
  id: string
  bus: BusType
  label: string
  color: string
  thickness: number
  /** `bus` is a feed from the panel rail, `device` a run between two devices, `busbar` a fork. */
  source: 'busbar' | 'device'
  kind: NonNullable<Connection['kind']>
  circuitId: string
  fromDeviceId?: string
  toDeviceId: string
  /** Names for the wire inspector, so the panel does not have to look anything up again. */
  fromName: string
  toName: string
  /** Start and end in board millimetres; the path is already in the same space. */
  from: { x: number; y: number }
  to: { x: number; y: number; height: number }
  d: string
  /** Separate SVG paths allow runs to be drawn before or after the devices. */
  segments: WireSegment[]
  /** Resolved source, saved interior anchors, resolved target. */
  routePoints: WirePoint[]
  /** A detached manual-edit seed preserving the rendered bends and layers. */
  editableRoute: WireRoute
}

export interface SceneRail {
  row: number
  y: number
  height: number
  /** X of each rail slot, in millimetres. */
  slots: number[]
  capacity: number
}

export interface BoardScene {
  width: number
  height: number
  rails: SceneRail[]
  /** The three panel buses the wiring comes from. */
  busRails: BusRail[]
  devices: SceneDevice[]
  wires: SceneWire[]
  capacity: number
  railStartX: number
  modulePitch: number
  geometry: PanelGeometry
}


/**
 * Millimetres between two wires of one bundle, so none of them is drawn on top of another.
 *
 * Wider than the pointer's target for a wire (2.2 mm in the view), because two wires whose hit
 * areas overlap cannot both be picked: the topmost one wins every click near the overlap, and the
 * one underneath looks selectable while refusing to be.
 */
const WIRE_CHANNEL_MM = 3.4

/** How close to the edge of a device still counts as being inside it, in millimetres. */
const BODY_CLEARANCE_MM = 0.3

export const buildBoardScene = (project: PanelProject, definitions: Map<string, DeviceDefinition>): BoardScene => {
  const geometry = getPanelGeometry(project, definitions)
  const railStartX = geometry.railStartXMm
  const pitch = geometry.modulePitchMm

  const rails: SceneRail[] = geometry.rowTopMm.map((y, row) => ({
    row,
    y,
    height: geometry.railHeightMm,
    slots: Array.from({ length: geometry.capacity }, (_, slot) => railStartX + slot * pitch),
    capacity: geometry.capacity,
  }))

  const faceCache = new Map<string, DeviceFaceMetrics>()
  const faceFor = (product: DeviceDefinition | undefined, key: string) => {
    if (!product) return null
    let face = faceCache.get(key)
    if (!face) {
      face = getDeviceFaceMetrics(product)
      faceCache.set(key, face)
    }
    return face
  }

  const devices: SceneDevice[] = project.devices.map((device) => {
    const product = definitions.get(device.productId)
    const face = faceFor(product, device.productId)
    // Height and top come from the board, not from the face: a device is centred inside its row,
    // and taking them from the face metrics is how the old board ended up with a face whose box
    // and whose painted body were two different sizes.
    const width = geometry.deviceWidthMm(device.productId)
    const height = geometry.deviceHeightMm(device.productId)
    return {
      instanceId: device.instanceId,
      address: device.address || '',
      marking: device.marking || '',
      note: device.note,
      category: product?.category ?? '',
      brand: product?.brand ?? '',
      name: product?.name ?? 'Товар отсутствует в каталоге',
      mount: device.mount === 'busbar' || product?.category === 'busbar' ? 'busbar' : 'din',
      product,
      row: device.row,
      slot: device.slot,
      quantity: device.quantity,
      missingProduct: !product,
      x: railStartX + device.slot * pitch,
      y: geometry.deviceTopMm(device.row, device.productId),
      width,
      height,
      // A missing product still needs a face to sit in, or the board grows a hole where a device
      // used to be. One module wide and plainly marked is enough to show that something is wrong.
      face: face ?? getDeviceFaceMetrics({
        id: device.productId, name: '', brand: '', sku: '', category: 'terminals',
        moduleWidth: 1, poles: 1, ratedCurrent: 0, voltage: 230, bus: 'L', price: 0, weight: 0,
        height: 82, depth: 70, color: '#eee', verificationStatus: 'unverified',
      }),
      terminals: product
        ? faceTerminals(product, face!)
        : { top: [], bottom: [], widthMm: width, heightMm: height },
    }
  })

  const byId = new Map(devices.map((device) => [device.instanceId, device]))
  const busRails = buildBusRails(railStartX, geometry.capacity * pitch)
  const railByBus = new Map(busRails.map((rail) => [rail.bus, rail]))

  /** A terminal in board millimetres, which is the only space wires and clamps both live in. */
  const terminalPoint = (instanceId: string, bus: BusType, side: 'top' | 'bottom', column?: number) => {
    const device = byId.get(instanceId)
    if (!device) return null
    const terminal = terminalForBus(device.terminals, bus, side, column)
    if (!terminal) return null
    return { x: device.x + terminal.x, y: device.y + terminal.y, height: terminal.height }
  }

  const deviceName = (instanceId: string | undefined) => {
    if (!instanceId) return ''
    const device = byId.get(instanceId)
    return device ? (device.address || device.name) : 'удалённый аппарат'
  }

  type WirePlan = {
    connection: Connection
    to: { x: number; y: number; height: number }
    /** Where the wire leaves, before the bundle is spread apart. */
    start: { x: number; y: number }
    source: 'busbar' | 'device'
    /** Which bundle of wires this one belongs to: same rail and row, or same pair of devices. */
    bundle: string
    /** Which way the run may be spread when the bundle has more than one wire in it. */
    axis: 'x' | 'y'
    /** The column this wire falls down, when it is not the column of its own clamp. */
    descentX?: number
    /** What the wire leaves from, in words: another device, a fork, or a panel bus. */
    fromName: string
  }

  /**
   * The vertical channel a wire can fall down without crossing a device.
   *
   * A feed to the second row has to get past the first one. Drawn as a straight drop it crosses
   * whatever stands in the way, and the drawing then claims that a conductor passes through the
   * body of a breaker. Real panels route these in the vertical duct between rows, so the wire falls
   * down a free module boundary and crosses horizontally above the device it serves.
   */
  const insideDevice = (row: number, x: number) => devices.some((device) => device.row === row
    && x > device.x + BODY_CLEARANCE_MM && x < device.x + device.width - BODY_CLEARANCE_MM)

  const descentFor = (targetX: number, targetRow: number) => {
    const rowsAbove = Array.from({ length: Math.max(0, targetRow) }, (_, row) => row)
    if (rowsAbove.every((row) => !insideDevice(row, targetX))) return targetX
    const boundaries = Array.from({ length: geometry.capacity + 1 }, (_, slot) => railStartX + slot * pitch)
    boundaries.sort((a, b) => Math.abs(a - targetX) - Math.abs(b - targetX))
    return boundaries.find((x) => rowsAbove.every((row) => !insideDevice(row, x))) ?? targetX
  }

  const plans: WirePlan[] = []
  for (const connection of project.connections ?? []) {
    const target = byId.get(connection.toDeviceId)
    const to = terminalPoint(connection.toDeviceId, connection.fromBus, connection.toSide ?? 'top', connection.terminal)
    if (!to || !target) continue
    // A connection that names another device is a cascade: the feed leaves that device instead of
    // the rail. Those wires are drawn by a different shape, because the same shape would make a
    // cascade and a direct feed indistinguishable.
    const fromTerminal = connection.fromDeviceId ? terminalPoint(connection.fromDeviceId, connection.fromBus, connection.fromSide ?? 'bottom', connection.fromTerminal) : null
    // A missing or incompatible source never becomes a feed from the panel bus.
    if (connection.fromDeviceId && !fromTerminal) continue
    if (connection.kind === 'busbar' && !connection.fromDeviceId) continue
    if (connection.kind === 'bus' && connection.fromDeviceId) continue
    const rail = railByBus.get(connection.fromBus)
    if (!rail) continue
    const tapX = connection.route
      ? Math.max(rail.x, Math.min(rail.x + rail.width, connection.route.points[0]?.x ?? to.x))
      : descentFor(to.x, target.row)
    const start = fromTerminal ?? { x: tapX, y: rail.tapY }
    plans.push({
      connection,
      to,
      start,
      descentX: fromTerminal ? undefined : tapX,
      source: fromTerminal ? 'device' : 'busbar',
      fromName: fromTerminal ? deviceName(connection.fromDeviceId) : BUS_SHORT_TITLE[connection.fromBus],
      bundle: connection.route ? `manual:${connection.id}` : fromTerminal
        ? `cascade:${connection.fromDeviceId}:${connection.toDeviceId}:${connection.fromBus}`
        : `rail:${connection.fromBus}:${target.row}`,
      axis: fromTerminal ? 'y' : 'x',
    })
  }

  /**
   * Spread the wires of one bundle along the rail or along the run, so none is drawn on top of
   * another. Six devices fed from one rail would otherwise produce six lines drawn on top of each
   * other: the topmost one would be all you could see, and the drawing would claim a panel with one
   * connection where there are six.
   */
  const bundles = new Map<string, WirePlan[]>()
  for (const plan of plans) {
    const list = bundles.get(plan.bundle)
    if (list) list.push(plan)
    else bundles.set(plan.bundle, [plan])
  }

  const wires: SceneWire[] = []
  for (const bundle of bundles.values()) {
    const spread = (bundle.length - 1) * WIRE_CHANNEL_MM
    for (const [index, plan] of bundle.entries()) {
      const offset = spread / 2 - index * WIRE_CHANNEL_MM
      // A bundle may move its route, never its clamp.
      const rail = railByBus.get(plan.connection.fromBus)
      const start = !plan.connection.route && plan.axis === 'x'
        ? { x: Math.max(rail?.x ?? 0, Math.min((rail?.x ?? 0) + (rail?.width ?? geometry.plateWidthMm), plan.start.x + offset)), y: plan.start.y }
        : plan.start
      const connection = plan.connection
      const target = byId.get(connection.toDeviceId)!
      const sourceDevice = connection.fromDeviceId ? byId.get(connection.fromDeviceId) : undefined
      const entryY = connection.toSide === 'bottom' ? target.y + target.height + 3 : target.y - 3
      const exitY = sourceDevice
        ? connection.fromSide === 'top' ? sourceDevice.y - 3 : sourceDevice.y + sourceDevice.height + 3
        : undefined
      // Use a free vertical boundary across every row traversed by this run.
      const lowY = Math.min(exitY ?? start.y, entryY)
      const highY = Math.max(exitY ?? start.y, entryY)
      const boundaries = Array.from({ length: geometry.capacity + 1 }, (_, slot) => railStartX + slot * pitch)
      boundaries.sort((a, b) => Math.abs(a - plan.to.x) - Math.abs(b - plan.to.x))
      const channel = boundaries.find((x) => !devices.some((device) =>
        device.y < highY && device.y + device.height > lowY
        && x > device.x + BODY_CLEARANCE_MM && x < device.x + device.width - BODY_CLEARANCE_MM)) ?? railStartX
      const needsChannel = sourceDevice || connection.toSide === 'bottom'
      const automaticOptions = { from: start, to: plan.to, source: plan.source, stubMm: 2.4,
        descentX: needsChannel ? channel : plan.descentX, entryY, exitY, fromSide: connection.fromSide, toSide: connection.toSide }
      const segments: WireSegment[] = connection.route
        ? manualWireSegments(start, plan.to, connection.route)
        : [{ index: 0, layer: 'rear', d: routeWire(automaticOptions) }]
      // A rail feed has no persisted source clamp. Include its existing tap as the first anchor
      // so converting a spread automatic feed to manual does not move that tap to the descent.
      const automaticAnchors = connection.route ? [] : routeWirePoints(automaticOptions).slice(connection.fromDeviceId ? 1 : 0, -1)
      const editableRoute: WireRoute = connection.route
        ? { points: connection.route.points.map((point) => ({ ...point })), segmentLayers: [...connection.route.segmentLayers] }
        : { points: automaticAnchors, segmentLayers: automaticAnchors.map(() => 'rear' as const).concat('rear') }
      wires.push({
        id: connection.id,
        bus: connection.fromBus,
        label: connection.label,
        color: connection.color,
        thickness: connection.thickness,
        source: plan.source,
        kind: connection.kind ?? (connection.fromDeviceId ? 'busbar' : 'circuit'),
        circuitId: connection.circuitId,
        fromDeviceId: connection.fromDeviceId,
        toDeviceId: connection.toDeviceId,
        fromName: plan.fromName,
        toName: deviceName(connection.toDeviceId),
        from: { x: start.x, y: start.y },
        to: plan.to,
        d: segments.map((segment) => segment.d).join(' '),
        segments,
        editableRoute,
        routePoints: [{ x: start.x, y: start.y }, ...(connection.route?.points ?? []).map((point) => ({ ...point })), { x: plan.to.x, y: plan.to.y }],
      })
    }
  }

  return {
    width: geometry.plateWidthMm,
    height: geometry.plateHeightMm,
    rails,
    busRails,
    devices,
    wires,
    capacity: geometry.capacity,
    railStartX,
    modulePitch: pitch,
    geometry,
  }
}
