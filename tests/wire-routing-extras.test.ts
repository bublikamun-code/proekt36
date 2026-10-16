import { describe, expect, it } from 'vitest'
import { getPanelGeometry } from '../src/domain/panelGeometry'
import {
  BUS_BAR_GAP_MM,
  BUS_BAR_HEIGHT_MM,
  busBarLayout,
  combLayout,
  corridorYMm,
  routeBoard,
  routeConnections,
  terminalOccupied,
  terminalTargets,
  wireFrameFromGeometry,
} from '../src/domain/wireRouting'
import type { WireFrame } from '../src/domain/wireRouting'
import type { BusAssembly, Connection, DeviceDefinition, PanelProject, PlacedDevice } from '../src/domain/types'

const product = (over: Partial<DeviceDefinition> & { id: string }): DeviceDefinition => ({
  brand: 'EKF',
  name: over.id,
  series: 'AVO-10',
  category: 'MCB',
  moduleWidth: 1,
  poles: 1,
  ratedCurrent: 16,
  voltage: 230,
  price: 0,
  ...over,
} as DeviceDefinition)

const CATALOG: DeviceDefinition[] = [
  product({ id: 'mcb-1p' }),
  product({ id: 'mcb-2p', moduleWidth: 2, poles: 2 }),
  product({ id: 'rccb-2p', category: 'RCCB', moduleWidth: 2, poles: 1 }),
  product({ id: 'bar', category: 'busbar', moduleWidth: 12, poles: 0 }),
]

const definitions = new Map(CATALOG.map((item) => [item.id, item]))

const placed = (instanceId: string, productId: string, slot: number, row = 0, extra: Partial<PlacedDevice> = {}): PlacedDevice => ({
  instanceId,
  productId,
  row,
  slot,
  address: instanceId.toUpperCase(),
  marking: instanceId.toUpperCase(),
  quantity: 1,
  phase: 1,
  note: '',
  mount: 'din',
  ...extra,
})

const connection = (over: Partial<Connection> & { id: string }): Connection => ({
  circuitId: 'c1',
  fromBus: 'L',
  toDeviceId: 'qf01',
  color: '',
  thickness: 0,
  label: '',
  ...over,
})

const project = (over: Partial<PanelProject> = {}): PanelProject => ({
  schemaVersion: 3,
  id: 'routing-extras',
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
  devices: [placed('qf01', 'mcb-2p', 0), placed('qf02', 'mcb-1p', 2)],
  busAssemblies: [],
  combs: [],
  circuits: [],
  connections: [],
  ...over,
})

const frameOf = (source: PanelProject): WireFrame => wireFrameFromGeometry(getPanelGeometry(source, definitions))

const boardOf = (source: PanelProject) => routeBoard(source, definitions, frameOf(source))

const wireOf = (source: PanelProject, id: string) => boardOf(source).wires.find((wire) => wire.id === id)

const firstPoint = (wire: { points: Array<{ x: number; y: number }> }) => wire.points[0]!
const lastPoint = (wire: { points: Array<{ x: number; y: number }> }) => wire.points[wire.points.length - 1]!

describe('рамка разводки', () => {
  it('переносит начало координат на монтажную плиту, а не на корпус', () => {
    const source = project()
    const geometry = getPanelGeometry(source, definitions)
    const frame = frameOf(source)

    // The geometry measures rows from the cabinet top; the overlay's viewBox starts at the plate.
    // A corridor left unshifted runs a wire straight through the device row.
    expect(geometry.plateTopMm).toBeGreaterThan(0)
    expect(frame.rowTopMm(0)).toBeCloseTo(geometry.rowTopMm[0]! - geometry.plateTopMm, 6)
    expect(frame.deviceTopMm(source.devices[0]!))
      .toBeCloseTo(geometry.deviceTopMm(0, 'mcb-2p') - geometry.plateTopMm, 6)
  })

  it('кладёт верхний коридор над рядом, а нижний под ним, и оба остаются в плите', () => {
    const source = project()
    const frame = frameOf(source)
    const top = corridorYMm(frame, 0, 'top')
    const bottom = corridorYMm(frame, 0, 'bottom')

    expect(top).toBeLessThan(frame.rowTopMm(0))
    expect(bottom).toBeGreaterThan(frame.rowTopMm(0) + frame.rowHeightMm(0))
    expect(top).toBeGreaterThanOrEqual(0)
    expect(bottom).toBeLessThan(frame.plateHeightMm)
  })

  it('ведёт себя разумно для ряда, которого на плите нет', () => {
    const frame = frameOf(project())
    expect(frame.rowTopMm(99)).toBe(0)
    expect(frame.rowHeightMm(99)).toBe(0)
  })
})

describe('шины N и PE', () => {
  const frame = frameOf(project())

  it('раскладывает шины наверху в обратном порядке, чтобы крайняя не уезжала', () => {
    const buses: BusAssembly[] = [
      { id: 'bus-pe-top', kind: 'PE', placement: 'top', label: 'PE' },
      { id: 'bus-n-top', kind: 'N', placement: 'top', label: 'N' },
    ]
    const layout = busBarLayout(frame, buses)
    const pe = layout.get('bus-pe-top')!
    const n = layout.get('bus-n-top')!

    // Top bars grow downward, so the first bus listed sits closest to the row above it.
    expect(n.y).toBeLessThan(pe.y)
    expect(n.y).toBeGreaterThan(0)
    expect(pe.y + pe.height).toBeLessThan(frame.plateHeightMm)
    expect(n.height).toBe(BUS_BAR_HEIGHT_MM)
    expect(pe.y - n.y).toBeCloseTo(BUS_BAR_HEIGHT_MM + BUS_BAR_GAP_MM, 6)
  })

  it('раскладывает нижние шины вверх от края плиты тем же шагом', () => {
    const layout = busBarLayout(frame, [
      { id: 'bus-n', kind: 'N', placement: 'bottom', label: 'N' },
      { id: 'bus-pe', kind: 'PE', placement: 'bottom', label: 'PE' },
    ])
    const n = layout.get('bus-n')!
    const pe = layout.get('bus-pe')!

    expect(n.y).toBeLessThan(pe.y)
    expect(pe.y + pe.height).toBeCloseTo(frame.plateHeightMm - 6, 6)
  })

  it('подписывает шину её видом, когда проекту не дано названия', () => {
    const layout = busBarLayout(frame, [{ id: 'bus-n', kind: 'N', placement: 'bottom' }])
    expect(layout.get('bus-n')!.label).toBe('N')
  })

  it('тянет провод от самой шины, а не от входящей полосы', () => {
    const source = project({
      busAssemblies: [{ id: 'bus-n', kind: 'N', placement: 'bottom', label: 'N' }],
      connections: [connection({ id: 'w1', fromBus: 'N', busId: 'bus-n', toDeviceId: 'qf01' })],
    })
    const wire = wireOf(source, 'w1')!
    const bar = busBarLayout(frameOf(source), source.busAssemblies).get('bus-n')!

    expect(firstPoint(wire).y).toBeCloseTo((bar.y + bar.height / 2) * 1.5, 6)
    // It climbs the incoming strip, so the run starts left of the first rail module.
    expect(firstPoint(wire).x).toBeLessThan(frameOf(source).railStartXMm * 1.5)
  })

  it('не находит провод, если проект ссылается на несуществующую шину, и рисует его от входа', () => {
    const withBus = project({ connections: [connection({ id: 'w1', busId: 'bus-n' })] })
    const withoutBus = project({ connections: [connection({ id: 'w1' })] })
    const corridor = corridorYMm(frameOf(withoutBus), 0, 'top') * 1.5

    // A dangling busId must not throw the wire away or invent a bar for it.
    expect(firstPoint(wireOf(withBus, 'w1')!).y).toBeCloseTo(corridor, 6)
    expect(firstPoint(wireOf(withoutBus, 'w1')!).y).toBeCloseTo(corridor, 6)
  })
})

describe('провод между двумя аппаратами', () => {
  it('выходит из центра шины на плате и приходит в клемму', () => {
    const source = project({
      devices: [placed('qf01', 'mcb-1p', 0), placed('bar01', 'bar', 4)],
      connections: [
        connection({ id: 'w1', kind: 'busbar', fromDeviceId: 'bar01', toDeviceId: 'qf01' }),
      ],
    })
    const frame = frameOf(source)
    const bar = source.devices[1]!
    const wire = wireOf(source, 'w1')!
    const barCentreX = (frame.deviceLeftMm(bar) + frame.deviceWidthMm(bar) * 1.5) * 1.5

    expect(firstPoint(wire).x).toBeGreaterThan(frame.deviceLeftMm(bar) * 1.5)
    // The first two points share the bar's centre line, so the run leaves the bar straight.
    expect(wire.points[1]!.x).toBeCloseTo(barCentreX, 6)
    expect(wire.points[1]!.y).toBe(firstPoint(wire).y)
    expect(wire.kind).toBe('busbar')
  })

  it('не рисует провод от шины, которой на плите нет', () => {
    const source = project({
      connections: [connection({ id: 'w1', kind: 'busbar', fromDeviceId: 'ghost', toDeviceId: 'qf01' })],
    })
    expect(wireOf(source, 'w1')).toBeUndefined()
  })

  it('опускает перемычку сначала в коридор, а потом в клемму назначения', () => {
    const source = project({
      connections: [
        connection({
          id: 'w1',
          kind: 'jumper',
          fromDeviceId: 'qf01',
          toDeviceId: 'qf02',
          fromTerminal: { deviceId: 'qf01', pole: 1, side: 'top' },
          toTerminal: { deviceId: 'qf02', pole: 1, side: 'bottom' },
        }),
      ],
    })
    const frame = frameOf(source)
    const wire = wireOf(source, 'w1')!
    const exitY = corridorYMm(frame, 0, 'top') * 1.5
    const entryY = corridorYMm(frame, 0, 'bottom') * 1.5

    // Two distinct corridors, then the drop into the clamp: a jumper that stayed in one
    // corridor would cut straight across the device bodies.
    expect(wire.points.map((point) => point.y)).toContain(exitY)
    expect(wire.points.map((point) => point.y)).toContain(entryY)
    expect(exitY).toBeLessThan(entryY)
    expect(wire.kind).toBe('jumper')
  })

  it('не рисует перемычку, если один из её концов исчез из проекта', () => {
    const source = project({
      connections: [
        connection({
          id: 'w1',
          kind: 'jumper',
          toDeviceId: 'qf02',
          fromTerminal: { deviceId: 'ghost', pole: 1, side: 'top' },
          toTerminal: { deviceId: 'qf02', pole: 1, side: 'bottom' },
        }),
      ],
    })
    expect(wireOf(source, 'w1')).toBeUndefined()
  })

  it('подставляет первую фазную клемму, когда провод называет аппарат без клеммы', () => {
    const source = project({
      connections: [connection({ id: 'w1', toDeviceId: 'qf01' })],
    })
    const targets = terminalTargets(source, definitions, frameOf(source))
    const first = targets.find((target) => target.deviceId === 'qf01' && target.pole === 1 && target.side === 'top')!

    expect(wireOf(source, 'w1')).toBeDefined()
    expect(lastPoint(wireOf(source, 'w1')!)).toEqual({ x: first.x, y: first.y })
  })

  it('не рисует провод в аппарат, которого нет ни в проекте, ни в каталоге', () => {
    const source = project({
      devices: [placed('qf01', 'ghost-product', 0)],
      connections: [connection({ id: 'w1', toDeviceId: 'qf01' })],
    })
    expect(wireOf(source, 'w1')).toBeUndefined()
  })
})

describe('оформление провода', () => {
  it('берёт толщину и вид из соединения, а отсутствующие оставляет по умолчанию', () => {
    const source = project({
      connections: [
        connection({ id: 'thin', toDeviceId: 'qf01', toTerminal: { deviceId: 'qf01', pole: 1, side: 'top' } }),
        connection({ id: 'thick', toDeviceId: 'qf01', toTerminal: { deviceId: 'qf01', pole: 1, side: 'bottom' }, thickness: 5 }),
      ],
    })
    expect(wireOf(source, 'thin')!.thickness).toBe(2)
    expect(wireOf(source, 'thick')!.thickness).toBe(5)
    expect(wireOf(source, 'thin')!.kind).toBe('circuit')
  })

  it('помечает цвет как заданный только когда его выбрали, а не когда он пришёл от шины', () => {
    const source = project({
      connections: [
        connection({ id: 'byBus', fromBus: 'PE', toDeviceId: 'qf01', toTerminal: { deviceId: 'qf01', pole: 1, side: 'top' } }),
        connection({ id: 'picked', fromBus: 'PE', color: '#2c7155', toDeviceId: 'qf01', toTerminal: { deviceId: 'qf01', pole: 1, side: 'bottom' } }),
      ],
    })

    // The drawing keeps the palette in the stylesheet, so a wire nobody touched must not arrive
    // with an inline colour to shadow it — the theme has to stay free to restyle those.
    expect(wireOf(source, 'byBus')!.customColor).toBe(false)
    expect(wireOf(source, 'picked')!.customColor).toBe(true)
    // Either way the router still resolves a colour, because the print report quotes it.
    expect(wireOf(source, 'byBus')!.color).toBe('#4f9d3a')
    expect(wireOf(source, 'picked')!.color).toBe('#2c7155')
  })

  it('разводит несколько входящих проводов по разным полосам, а не в одну', () => {
    const source = project({
      connections: [1, 2, 3].map((index) => connection({
        id: `w${index}`,
        toDeviceId: 'qf01',
        toTerminal: { deviceId: 'qf01', pole: 1, side: 'top' },
      })),
    })
    const xs = boardOf(source).wires.map((wire) => firstPoint(wire).x)

    expect(new Set(xs).size).toBe(3)
    // Each lane is a step further into the plate, and none of them reaches the rail.
    expect([...xs].sort((left, right) => left - right)).toEqual(xs)
    expect(Math.max(...xs)).toBeLessThan(frameOf(source).railStartXMm * 1.5)
  })
})

describe('гребёнки', () => {
  it('рисует гребёнку с нулевой шириной, когда в ряду под её диапазоном никого нет', () => {
    const source = project({
      combs: [{ id: 'c1', row: 1, poles: 3, fromSlot: 8, toSlot: 11 }],
    })
    const [comb] = boardOf(source).combs

    expect(comb!.teeth).toEqual([])
    expect(comb!.width).toBe(0)
    expect(comb!.starved).toBe(true)
    expect(comb!.label).toBe('Гребёнка 3P')
  })

  it('пропускает зуб у аппарата, который ушёл из каталога, но дорисовывает остальные', () => {
    const source = project({
      devices: [placed('qf01', 'ghost-product', 0), placed('qf02', 'mcb-1p', 1)],
      combs: [{ id: 'c1', row: 0, poles: 2, fromSlot: 0, toSlot: 1, label: 'Гребёнка 2P' }],
    })
    const [comb] = boardOf(source).combs

    expect(comb!.teeth).toHaveLength(1)
    expect(comb!.label).toBe('Гребёнка 2P')
  })

  it('не падает на проекте без гребёнок вовсе', () => {
    expect(combLayout(frameOf(project()), [], new Map(), definitions)).toEqual([])
  })
})

describe('занятость клеммы', () => {
  const ref = { deviceId: 'qf01', pole: 1, side: 'top' as const }
  const withWire = project({
    connections: [connection({ id: 'w1', toDeviceId: 'qf01', toTerminal: ref })],
  })

  it('считает клемму занятой с обоих концов провода', () => {
    expect(terminalOccupied(withWire, ref)).toBe(true)
    expect(terminalOccupied(withWire, { deviceId: 'qf01', pole: 2, side: 'top' })).toBe(false)
  })

  it('освобождает клемму, когда перерисовывают именно этот провод', () => {
    // The wire tool re-routes the conductor it is dragging; without this the clamp it already
    // occupies would refuse its own wire and the drag could never be finished.
    expect(terminalOccupied(withWire, ref, 'w1')).toBe(false)
    expect(terminalOccupied(withWire, ref, 'w2')).toBe(true)
  })

  it('не считает занятой клемму на аппарате, который из проекта убрали', () => {
    const empty = project()
    expect(terminalOccupied(empty, ref)).toBe(false)
    expect(terminalOccupied(empty, ref, undefined)).toBe(false)
  })
})

describe('обёртка над разводкой', () => {
  it('отдаёт те же провода, что и полный проход по доске', () => {
    const source = project({
      connections: [connection({ id: 'w1', toDeviceId: 'qf01', toTerminal: { deviceId: 'qf01', pole: 1, side: 'top' } })],
    })
    const geometry = getPanelGeometry(source, definitions)

    expect(routeConnections(source, definitions, geometry)).toEqual(boardOf(source).wires)
  })
})
