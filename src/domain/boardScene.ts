import { getDeviceFaceMetrics, type DeviceFaceMetrics } from './faceMetrics'
import { getPanelGeometry, type PanelGeometry } from './panelGeometry'
import { faceTerminals, routeWire, terminalForBus, type FaceTerminals } from './wiring'
import type { BusType, DeviceDefinition, PanelProject } from './types'

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
  source: 'busbar' | 'device'
  /** Start and end in board millimetres; the path is already in the same space. */
  from: { x: number; y: number }
  to: { x: number; y: number; height: number }
  d: string
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
  devices: SceneDevice[]
  wires: SceneWire[]
  capacity: number
  railStartX: number
  modulePitch: number
  geometry: PanelGeometry
}

const busX: Record<BusType, number> = { L: 2.5, N: 7, PE: 11.5 }

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

  /** A terminal in board millimetres, which is the only space wires and clamps both live in. */
  const terminalPoint = (instanceId: string, bus: BusType, side: 'top' | 'bottom') => {
    const device = byId.get(instanceId)
    if (!device) return null
    const terminal = terminalForBus(device.terminals, bus, side)
    if (!terminal) return null
    return { x: device.x + terminal.x, y: device.y + terminal.y, height: terminal.height }
  }

  const wires: SceneWire[] = []
  for (const connection of project.connections ?? []) {
    const to = terminalPoint(connection.toDeviceId, connection.fromBus, 'top')
    if (!to) continue
    // A connection that names a device is a cascade: the feed leaves another breaker instead of the
    // busbar. Those wires are drawn by a different shape, because the same shape would make a
    // cascade and a direct feed indistinguishable.
    const from = connection.fromDeviceId ? terminalPoint(connection.fromDeviceId, connection.fromBus, 'bottom') : null
    const source = from ? 'device' : 'busbar'
    const target = byId.get(connection.toDeviceId)
    const start = from ?? { x: busX[connection.fromBus], y: target ? target.y - 6 : 0 }
    wires.push({
      id: connection.id,
      bus: connection.fromBus,
      label: connection.label,
      color: connection.color,
      thickness: connection.thickness,
      source,
      from: { x: start.x, y: start.y },
      to,
      d: routeWire({ from: start, to, source, stubMm: 2.4 }),
    })
  }

  return {
    width: geometry.plateWidthMm,
    height: geometry.plateHeightMm,
    rails,
    devices,
    wires,
    capacity: geometry.capacity,
    railStartX,
    modulePitch: pitch,
    geometry,
  }
}
