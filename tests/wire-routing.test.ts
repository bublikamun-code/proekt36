import { describe, expect, it } from 'vitest'
import { routeBoard, terminalTargets as terminalTargetsOf, wireFrameFromGeometry } from '../src/domain/wireRouting'
import { getPanelGeometry } from '../src/domain/panelGeometry'
import { deviceTerminals, facePlacementMm, faceSizeMm, terminalAnchorMm, terminalColumns } from '../src/domain/terminals'
import type { Connection, DeviceDefinition, PanelProject } from '../src/domain/types'

const MM = 1.5

const product = (over: Partial<DeviceDefinition> & { id: string }): DeviceDefinition => ({
  brand: 'EKF',
  name: over.id,
  series: 'AVO-10',
  category: 'MCB',
  moduleWidth: 1,
  poles: 1,
  ratedCurrent: 16,
  voltage: 230,
  breakingCapacity: '6kA',
  price: 0,
  currency: 'RUB',
  ...over,
} as DeviceDefinition)

const CATALOG: DeviceDefinition[] = [
  product({ id: 'mcb-1p', moduleWidth: 1, poles: 1 }),
  product({ id: 'mcb-2p', moduleWidth: 2, poles: 2 }),
  product({ id: 'mcb-3p', moduleWidth: 3, poles: 3 }),
  product({ id: 'rccb-2p', category: 'RCCB', moduleWidth: 2, poles: 2 }),
  product({ id: 'rcbo-1pn', category: 'RCBO', moduleWidth: 2, poles: 1 }),
  product({ id: 'bar', category: 'busbar', moduleWidth: 12, poles: 0 }),
]

const definitions = new Map(CATALOG.map((item) => [item.id, item]))

const placed = (instanceId: string, productId: string, slot: number, row = 0) => ({
  instanceId,
  productId,
  row,
  slot,
  address: instanceId.toUpperCase(),
  marking: instanceId.toUpperCase(),
  quantity: 1,
  phase: 1 as const,
  note: '',
  mount: 'din' as const,
})

const project = (connections: Connection[], extra: Partial<PanelProject> = {}): PanelProject => ({
  schemaVersion: 3,
  id: 'routing',
  name: 'Разводка',
  preset: 'custom',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    inputCurrent: 63,
    phase: 1,
    rows: 2,
    reserveModules: 4,
    enclosureWidth: 283,
    enclosureHeight: 357,
    enclosureDepth: 106,
    cabinetId: 'panel36-24-embedded',
    railId: 'rail-12',
  },
  devices: [placed('qf01', 'mcb-2p', 0), placed('qf02', 'mcb-1p', 2), placed('qfi01', 'rccb-2p', 3)],
  busAssemblies: [
    { id: 'bus-n', kind: 'N', placement: 'bottom', label: 'N' },
    { id: 'bus-pe', kind: 'PE', placement: 'bottom', label: 'PE' },
  ],
  combs: [],
  circuits: [],
  connections,
  ...extra,
})

/**
 * The plate-local millimetre point a wire endpoint is expected to land on, recomputed here from
 * the geometry rather than read back from the router — otherwise the test would only prove that
 * the router agrees with itself.
 */
const anchorMm = (source: PanelProject, ref: { deviceId: string; pole: number; side: 'top' | 'bottom' }): { x: number; y: number } => {
  const geometry = getPanelGeometry(source, definitions)
  const device = source.devices.find((item) => item.instanceId === ref.deviceId)!
  const definition = definitions.get(device.productId)!
  const fit = facePlacementMm(definition, geometry.deviceWidthMm(device.productId), geometry.deviceHeightMm(device.productId))
  const point = terminalAnchorMm(definition, ref.pole, ref.side)!
  return {
    x: geometry.railStartXMm + device.slot * (geometry.railWidthMm / Math.max(1, geometry.capacity)) + fit.offsetXMm + point.x * fit.scale,
    y: geometry.deviceTopMm(device.row, device.productId) - geometry.plateTopMm + fit.offsetYMm + point.y * fit.scale,
  }
}

const board = (source: PanelProject) => {
  const geometry = getPanelGeometry(source, definitions)
  return routeBoard(source, definitions, wireFrameFromGeometry(geometry))
}

const lastPoint = (d: string) => {
  const numbers = d.match(/-?[\d.]+/g)!.map(Number)
  return { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] }
}

const firstPoint = (d: string) => {
  const numbers = d.match(/-?[\d.]+/g)!.map(Number)
  return { x: numbers[0], y: numbers[1] }
}

/** The router works in millimetres and emits plate pixels, so expectations are scaled here. */
const nearMm = (expected: { x: number; y: number }, actual: { x: number; y: number }, tolerance = 0.4) => ({
  x: expect.closeTo(expected.x * MM, tolerance),
  y: expect.closeTo(expected.y * MM, tolerance),
})

describe('wire routing', () => {
  it('lands a wire end exactly on the terminal it names', () => {
    const source = project([
      { id: 'w1', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'L → QF02', phase: 1, toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
    ])
    const wire = board(source).wires.find((item) => item.id === 'w1')!
    expect(lastPoint(wire.d)).toEqual(nearMm(anchorMm(source, { deviceId: 'qf02', pole: 1, side: 'top' }), lastPoint(wire.d)))
  })

  it('resolves each end of a two-terminal jumper independently', () => {
    const source = project([
      { id: 'w1', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'перемычка', kind: 'jumper', fromTerminal: { deviceId: 'qf01', pole: 3, side: 'bottom' }, toTerminal: { deviceId: 'qf02', pole: 1, side: 'bottom' } },
    ])
    const wire = board(source).wires[0]
    expect(firstPoint(wire.d)).toEqual(nearMm(anchorMm(source, { deviceId: 'qf01', pole: 3, side: 'bottom' }), firstPoint(wire.d)))
    expect(lastPoint(wire.d)).toEqual(nearMm(anchorMm(source, { deviceId: 'qf02', pole: 1, side: 'bottom' }), lastPoint(wire.d)))
  })

  it('routes an N wire down to the bar it names and never above the plate', () => {
    const source = project([
      { id: 'w1', circuitId: '', fromBus: 'N', toDeviceId: 'qf01', thickness: 2, color: '', label: 'N → QF01:2', busId: 'bus-n', toTerminal: { deviceId: 'qf01', pole: 2, side: 'top' } },
    ])
    const wire = board(source).wires[0]
    const geometry = getPanelGeometry(source, definitions)
    const bar = board(source).buses.find((bus) => bus.id === 'bus-n')!
    // It starts on the bar itself and rises to the terminal, so every point stays on the plate.
    expect(firstPoint(wire.d).y).toBeCloseTo(bar.y + bar.height / 2, 0)
    for (const point of wire.points) {
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(geometry.plateHeightPx)
    }
  })

  it('keeps several wires off each other by giving them separate corridors', () => {
    const source = project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'a', toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
      { id: 'b', circuitId: '', fromBus: 'L', toDeviceId: 'qf01', thickness: 2, color: '', label: 'b', toTerminal: { deviceId: 'qf01', pole: 1, side: 'top' } },
      { id: 'c', circuitId: '', fromBus: 'L', toDeviceId: 'qfi01', thickness: 2, color: '', label: 'c', toTerminal: { deviceId: 'qfi01', pole: 1, side: 'top' } },
    ])
    const lanes = board(source).wires.map((wire) => firstPoint(wire.d).x)
    expect(new Set(lanes).size).toBe(3)
  })

  it('emits only orthogonal steps, with no zero-length segments', () => {
    const source = project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'a', toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
      { id: 'b', circuitId: '', fromBus: 'N', toDeviceId: 'qfi01', thickness: 2, color: '', label: 'b', busId: 'bus-n', toTerminal: { deviceId: 'qfi01', pole: 2, side: 'top' } },
    ])
    for (const wire of board(source).wires) {
      for (let index = 1; index < wire.points.length; index += 1) {
        const from = wire.points[index - 1]
        const to = wire.points[index]
        expect(from.x === to.x || from.y === to.y).toBe(true)
        expect(from.x !== to.x || from.y !== to.y).toBe(true)
      }
    }
  })

  it('puts the badge on a horizontal run so it never covers a corner', () => {
    const source = project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'L → QF02', toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
    ])
    const wire = board(source).wires[0]
    const onRun = wire.points.some(
      (from, index) => index > 0 && from.y === wire.points[index - 1].y
        && wire.labelAt.x >= Math.min(from.x, wire.points[index - 1].x)
        && wire.labelAt.x <= Math.max(from.x, wire.points[index - 1].x),
    )
    expect(onRun).toBe(true)
  })

  it('draws the N and PE bars as full-width strips stacked clear of each other', () => {
    const source = project([])
    const geometry = getPanelGeometry(source, definitions)
    const buses = board(source).buses
    expect(buses.map((bus) => bus.kind).sort()).toEqual(['N', 'PE'])
    for (const bus of buses) {
      expect(bus.width).toBeCloseTo(geometry.plateWidthPx, 6)
      expect(bus.y + bus.height).toBeLessThanOrEqual(geometry.plateHeightPx)
    }
    const [first, second] = buses
    expect(Math.abs(first.y - second.y)).toBeGreaterThanOrEqual(first.height)
  })

  it('carries the phase so the drawing can colour a conductor per phase', () => {
    const source = project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'a', phase: 2, toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
    ])
    const wire = board(source).wires[0]
    expect(wire.bus).toBe('L')
    expect(wire.phase).toBe(2)
    expect(wire.color).not.toBe(board(project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'a', phase: 1, toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
    ])).wires[0].color)
  })

  it('skips a connection whose device left the catalogue instead of drawing a broken wire', () => {
    const source = project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'ghost', thickness: 2, color: '', label: 'a', toTerminal: { deviceId: 'ghost', pole: 1, side: 'top' } },
    ])
    expect(board(source).wires).toEqual([])
  })

  it('pairs each phase with its own return on a multi-pole device', () => {
    const three = definitions.get('mcb-3p')!
    expect(terminalColumns(three)).toBe(3)
    // A three-pole device is drawn 1/3/5 above and 2/4/6 below, so pole 2 is the outgoing
    // clamp under pole 1: the two share a column rather than each taking one of their own.
    const columnOf = (pole: number) => terminalAnchorMm(three, pole, 'bottom')!.x
    expect(columnOf(1)).toBeCloseTo(columnOf(2), 6)
    expect(columnOf(3)).toBeCloseTo(columnOf(4), 6)
    expect(columnOf(5)).toBeCloseTo(columnOf(6), 6)
    expect(new Set([columnOf(1), columnOf(3), columnOf(5)]).size).toBe(3)
  })

  it('draws a comb above its row with one tooth per fed device', () => {
    const source = project([], { combs: [{ id: 'c1', row: 0, poles: 2, fromSlot: 0, toSlot: 2 }] })
    const [comb] = board(source).combs
    expect(comb.poles).toBe(2)
    // Three devices span the range but only two poles exist, so the comb feeds the first two.
    expect(comb.teeth).toHaveLength(2)
    expect(comb.starved).toBe(false)
    // The bar sits above the row, and every tooth reaches down into a top clamp.
    const geometry = getPanelGeometry(source, definitions)
    const rowTop = geometry.rowTopMm[0] - geometry.plateTopMm
    expect(comb.y).toBeLessThan(rowTop * MM)
    for (const tooth of comb.teeth) {
      expect(tooth.y).toBeGreaterThan(comb.y)
    }
  })

  it('marks a comb starved when the row holds fewer devices than it has poles', () => {
    const source = project([], { combs: [{ id: 'c1', row: 0, poles: 4, fromSlot: 0, toSlot: 3 }] })
    const [comb] = board(source).combs
    expect(comb.teeth).toHaveLength(3)
    expect(comb.starved).toBe(true)
  })

  it('leaves a hole where the row is empty rather than bridging across it', () => {
    const source = project([], { combs: [{ id: 'c1', row: 0, poles: 3, fromSlot: 0, toSlot: 8 }] })
    const [comb] = board(source).combs
    // Only the three placed devices carry a tooth; the empty slots get none.
    expect(comb.teeth).toHaveLength(3)
  })

  it('orders the comb slot range so a reversed range still draws', () => {
    const source = project([], { combs: [{ id: 'c1', row: 0, poles: 1, fromSlot: 2, toSlot: 0 }] })
    const [comb] = board(source).combs
    expect(comb.teeth).toHaveLength(1)
  })

  it('runs the corridor above the row it feeds, not through the devices', () => {
    const source = project([
      { id: 'a', circuitId: '', fromBus: 'L', toDeviceId: 'qf02', thickness: 2, color: '', label: 'a', toTerminal: { deviceId: 'qf02', pole: 1, side: 'top' } },
    ])
    const geometry = getPanelGeometry(source, definitions)
    const device = source.devices.find((item) => item.instanceId === 'qf02')!
    const deviceTopPx = (geometry.deviceTopMm(device.row, device.productId) - geometry.plateTopMm) * MM
    const wire = board(source).wires[0]
    // The horizontal run happens before the wire drops into the clamp, so every point above the
    // drop must clear the top of the device it feeds.
    const drop = wire.points.findIndex((point) => Math.abs(point.x - lastPoint(wire.d).x) < 0.01)
    for (const point of wire.points.slice(0, drop)) {
      expect(point.y).toBeLessThan(deviceTopPx)
    }
  })

  it('offers a hit target on every clamp, at the point its wire would land', () => {
    const source = project([], { devices: [placed('qf01', 'mcb-3p', 0), placed('qfi01', 'rcbo-1pn', 3)] })
    const targets = terminalTargetsOf(source, definitions, wireFrameFromGeometry(getPanelGeometry(source, definitions)))
    // One per clamp, and never a clamp the terminal model does not have: a 3P breaker numbers its
    // poles in staggered rows (1/3/5 on top, 2/4/6 underneath), so listing sides by hand is a
    // trap. Derive the expectation from the same source the drawing uses.
    const expected = [
      ...deviceTerminals(definitions.get('mcb-3p')!).map((info) => `qf01:${info.pole}:${info.side}`),
      ...deviceTerminals(definitions.get('rcbo-1pn')!).map((info) => `qfi01:${info.pole}:${info.side}`),
    ].sort()
    expect(targets.map((target) => target.key).sort()).toEqual(expected)
    // Spelled out, because a staggered pole number is exactly what a wrong anchor would hide.
    expect(targets.filter((target) => target.deviceId === 'qf01').map((target) => target.key).sort()).toEqual([
      'qf01:1:top', 'qf01:2:bottom', 'qf01:3:top', 'qf01:4:bottom', 'qf01:5:top', 'qf01:6:bottom',
    ])
    // The N clamp of a 1P+N RCBO is the second column, so its pole is 2 while its label is «N».
    const neutral = targets.find((target) => target.key === 'qfi01:2:top')!
    expect(neutral.label).toBe('N')
    expect(neutral.type).toBe('neutral')
    // The whole point of the helper: the target is the router's own endpoint, not a second
    // measurement of the screw that could drift from it.
    for (const target of targets) {
      const source2 = project([{ id: 'c', circuitId: '', fromBus: 'L', toDeviceId: target.deviceId, thickness: 2, color: '', label: 'c', toTerminal: { deviceId: target.deviceId, pole: target.pole, side: target.side } }], { devices: source.devices })
      const endpoint = lastPoint(board(source2).wires[0].d)
      expect(target.x).toBeCloseTo(endpoint.x, 6)
      expect(target.y).toBeCloseTo(endpoint.y, 6)
    }
  })

  it('marks a clamp that already carries a conductor as taken', () => {
    const busy = project([{ id: 'c', circuitId: '', fromBus: 'L', toDeviceId: 'qf01', thickness: 2, color: '', label: 'c', kind: 'jumper', fromTerminal: { deviceId: 'qf02', pole: 1, side: 'top' }, toTerminal: { deviceId: 'qf01', pole: 1, side: 'top' } }])
    const targets = terminalTargetsOf(busy, definitions, wireFrameFromGeometry(getPanelGeometry(busy, definitions)))
    expect(targets.filter((target) => target.occupied).map((target) => target.key).sort()).toEqual(['qf01:1:top', 'qf02:1:top'])
  })

  it('agrees with the face drawing about the face size, so the fit is exact', () => {
    const three = definitions.get('mcb-3p')!
    const face = faceSizeMm(three)
    expect(face.widthMm).toBe(54)
    const fit = facePlacementMm(three, 54, 82)
    // A box exactly the size of the face needs no letterboxing at all.
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.offsetXMm).toBeCloseTo(0, 6)
    expect(fit.offsetYMm).toBeCloseTo(0, 6)
  })
})
