import { describe, expect, it } from 'vitest'
import { builtinCatalog } from '../src/data/catalog'
import { getPanelGeometry, DEFAULT_DEVICE_HEIGHT_MM } from '../src/domain/spike/panelGeometry'
import { routeBoard } from '../src/domain/spike/wireRouting'
import type { WireFrame } from '../src/domain/spike/wireRouting'
import type { DeviceDefinition as ShimDeviceDefinition, PanelProject, PlacedDevice as ShimPlacedDevice } from '../src/domain/spike/shim'
import { clampExists, routerConnections, terminalKey, toTerminalRef } from '../src/domain/spike/wiringLayers'
import type { GraphConnection } from '../src/domain/spike/wiringLayers'

const definitions = new Map<string, ShimDeviceDefinition>(builtinCatalog.map((item) => [item.id, item as unknown as ShimDeviceDefinition] as const))
const mcb = definitions.get('ekf-mcb-1p-c6')! as ShimDeviceDefinition
const terminal1p = definitions.get('ekf-terminal-1p-gray')!
const rccb = definitions.get('ekf-rccb-2p-25')! as ShimDeviceDefinition

const project = (extra: Partial<PanelProject> = {}): PanelProject => ({
  schemaVersion: 4,
  id: 'spike',
  name: 'Спайк',
  preset: 'demo',
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
  settings: {
    inputCurrent: 40, phase: 1, enclosureWidth: 540, enclosureHeight: 650, enclosureDepth: 110,
    rows: 1, reserveModules: 8, cabinetId: 'panel36-18-r18-embedded', railId: 'rail-12',
  },
  devices: [],
  circuits: [],
  connections: [],
  busAssemblies: [
    { id: 'bus-n', kind: 'N', placement: 'top' },
    { id: 'bus-pe', kind: 'PE', placement: 'bottom' },
  ],
  combs: [],
  rooms: [],
  ...extra,
})

const device = (product: ShimDeviceDefinition, row: number, slot: number, instanceId: string): ShimPlacedDevice => ({
  instanceId, productId: product.id, row, slot, address: '', quantity: 1, phase: 1, note: '',
})

describe('спайк A2: слоистая модель разводки', () => {
  it('запитка от шины N: провод попадает в существующий зажим, шина именована', () => {
    // L входит в линейный зажим автомата, N — в нейтральный зажим двухполюсного УЗО:
    // у однополюсного автомата N-зажима нет вовсе, нейтраль уходит на колодку (BOARD_PLAN).
    const graph: GraphConnection[] = [
      { id: 'w1', fromBus: 'N', toDeviceId: 'qf1', kind: 'bus', terminal: 1 },
      { id: 'w2', fromBus: 'L', toDeviceId: 'd1', kind: 'bus', terminal: 0 },
    ]
    const base = project({ devices: [device(mcb, 0, 0, 'd1'), device(rccb, 0, 1, 'qf1')] })
    const mapped = routerConnections(graph, base.busAssemblies!)
    expect(mapped).toHaveLength(2)
    // N-подвод привязывается к именованной сборке; L-бара в модели нет — фазный подвод
    // остаётся абстрактным входом (как в миграции сентября v2→v3) или приходит гребёнкой.
    expect(mapped.find((c) => c.id === 'w1')!.busId).toBe('bus-n')
    expect(mapped.find((c) => c.id === 'w2')!.busId).toBeUndefined()
    const neutral = toTerminalRef(graph[0]!)
    expect(neutral).toEqual({ deviceId: 'qf1', pole: 2, side: 'top' })
    expect(clampExists(rccb, neutral)).toBe(true)
    const line = toTerminalRef(graph[1]!)
    expect(clampExists(mcb, line)).toBe(true)
    expect(terminalKey(line)).not.toEqual(terminalKey(neutral))
  })

  it('гребёнка на ряд автоматов: связи у всех аппаратов ряда, зажимы не заняты дважды', () => {
    const graph: GraphConnection[] = [
      { id: 'c1', fromBus: 'L', toDeviceId: 'a1', kind: 'bus', terminal: 0 },
      { id: 'c2', fromBus: 'L', toDeviceId: 'a2', kind: 'busbar', fromDeviceId: 'a1', terminal: 0 },
      { id: 'c3', fromBus: 'L', toDeviceId: 'a3', kind: 'busbar', fromDeviceId: 'a1', terminal: 0 },
    ]
    const mapped = routerConnections(graph, project().busAssemblies!)
    const withRefs = mapped.filter((connection) => connection.toTerminal)
    expect(withRefs).toHaveLength(2)
    const keys = withRefs.map((connection) => terminalKey(connection.toTerminal!))
    expect(new Set(keys).size).toBe(2)
    for (const connection of withRefs) {
      expect(clampExists(mcb, connection.toTerminal!)).toBe(true)
    }
  })

  it('клеммная колодка: винты колодки не адресуются полюсом — трение фиксируется', () => {
    // У сентября terminalColumns для категории terminals возвращает 0: колодка — не устройство
    // с колонками, её винты живут в механике BusAssembly (зажимы «варианта Б»). У октября
    // колодка — устройство с номером винта в Connection.terminal. Отображение в TerminalRef
    // даёт ссылку, которая не находит зажима, — это и есть предмет решения в A4.
    const ref = toTerminalRef({ id: 'k1', fromBus: 'N', toDeviceId: 'xt1', kind: 'busbar', terminal: 1 })
    expect(ref).toEqual({ deviceId: 'xt1', pole: 2, side: 'top' })
    expect(clampExists(terminal1p, ref)).toBe(false)
    expect(clampExists(rccb, { deviceId: 'qf1', pole: 2, side: 'top' })).toBe(true)
  })

  it('связность инвариантна: множество пар (устройство, зажим) одно и то же до и после слоёв', () => {
    const graph: GraphConnection[] = [
      { id: 'w1', fromBus: 'N', toDeviceId: 'd1', kind: 'bus', terminal: 1 },
      { id: 'w2', fromBus: 'L', toDeviceId: 'a2', kind: 'busbar', fromDeviceId: 'a1', terminal: 0 },
      { id: 'w3', fromBus: 'L', toDeviceId: 'a3', kind: 'busbar', fromDeviceId: 'a1', terminal: 0 },
      { id: 'k1', fromBus: 'N', toDeviceId: 'xt1', kind: 'busbar', fromDeviceId: 'd1', terminal: 2 },
    ]
    // Инвариант проверяется на связях с явным зажимом; шинный подвод в сентябрьской модели
    // сознательно теряет toTerminal — место приземления решает роутер, а не граф.
    const explicit = graph.filter((connection) => connection.kind !== 'bus')
    const expected = new Set(explicit.map((connection) => terminalKey(toTerminalRef(connection))))
    const mapped = routerConnections(graph, project().busAssemblies!)
    const actual = new Set(mapped.filter((c) => c.toTerminal).map((c) => terminalKey(c.toTerminal!)))
    expect(actual).toEqual(expected)
  })

  it('роутер сентября потребляет граф октября: запитка рисуется проводами', () => {
    const base = project({ devices: [device(mcb, 0, 0, 'd1')] })
    const wired = routerProjectForSmoke(base)
    const routed = routeBoard(wired, definitions, frameFor(wired))
    expect(routed.wires.length).toBeGreaterThan(0)
    for (const wire of routed.wires) expect(wire.d.startsWith('M')).toBe(true)
  })
})

const routerProjectForSmoke = (base: PanelProject): PanelProject => ({
  ...base,
  circuits: [{ id: 'c1', name: 'Свет', loadName: 'Свет', current: 6, power: 1300, phase: 1, protectionDeviceId: 'd1', color: '', wireCrossSection: 1.5, note: '' }],
  connections: routerConnections(
    [
      { id: 'w1', circuitId: 'c1', fromBus: 'L', toDeviceId: 'd1', kind: 'bus', terminal: 0 },
      { id: 'w2', circuitId: 'c1', fromBus: 'N', toDeviceId: 'd1', kind: 'bus', terminal: 1 },
    ],
    base.busAssemblies!,
  ),
})

const frameFor = (source: PanelProject): WireFrame => {
  const geometry = getPanelGeometry(source, definitions)
  const railStartXMm = 24
  return {
    plateWidthMm: geometry.plateWidthMm,
    plateHeightMm: geometry.plateHeightMm,
    railStartXMm,
    railWidthMm: geometry.railWidthMm,
    rows: source.settings.rows,
    rowTopMm: (row) => geometry.rowTopMm[row] ?? 0,
    rowHeightMm: (row) => geometry.rowHeightsMm[row] ?? 100,
    deviceLeftMm: (item) => railStartXMm + item.slot * geometry.modulePitchMm,
    deviceTopMm: (item) => (geometry.rowTopMm[item.row] ?? 0) + 10,
    deviceWidthMm: (item) => (definitions.get(item.productId)?.moduleWidth ?? 1) * geometry.modulePitchMm,
    deviceHeightMm: () => DEFAULT_DEVICE_HEIGHT_MM,
  }
}
