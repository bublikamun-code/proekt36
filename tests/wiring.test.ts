import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import { buildBoardScene } from '../src/domain/boardScene'
import { createDevice, createProject } from '../src/domain/project'
import type { Connection, DeviceDefinition, PanelProject } from '../src/domain/types'
import { validateProject } from '../src/domain/validation'
import { connectionTouchesTerminal, terminalForBus, type FaceTerminals, type Terminal } from '../src/domain/wiring'

const clamp = (column: number, bus: Terminal['bus'], side: Terminal['side'] = 'top'): Terminal => ({
  column, bus, side, label: String(column + 1), x: column * 10, y: 4, width: 4, height: 4,
})
const terminals: FaceTerminals = {
  top: [clamp(0, 'L'), clamp(2, 'N'), clamp(4, 'aux')],
  bottom: [clamp(0, 'L', 'bottom')], widthMm: 50, heightMm: 82,
}

describe('strict terminal resolution', () => {
  it('uses the physical column identifier, even when the row is sparse', () => {
    expect(terminalForBus(terminals, 'N', 'top', 2)).toBe(terminals.top[1])
    expect(terminalForBus(terminals, 'N', 'top', 1)).toBeUndefined()
  })

  it.each([-1, 9, 0.5, NaN])('does not replace invalid column %s', (column) => {
    expect(terminalForBus(terminals, 'L', 'top', column)).toBeUndefined()
  })

  it('rejects a selected incompatible bus without choosing another clamp', () => {
    expect(terminalForBus(terminals, 'N', 'top', 0)).toBeUndefined()
    expect(terminalForBus(terminals, 'L', 'top', 2)).toBeUndefined()
  })

  it('accepts explicitly selected auxiliary clamps', () => {
    expect(terminalForBus(terminals, 'PE', 'top', 4)).toBe(terminals.top[2])
  })

  it('resolves old unspecified columns only to compatible clamps on the saved side', () => {
    expect(terminalForBus(terminals, 'N', 'top')).toBe(terminals.top[1])
    expect(terminalForBus(terminals, 'PE', 'top')).toBe(terminals.top[2])
    expect(terminalForBus(terminals, 'N', 'bottom')).toBeUndefined()
  })

  it('rejects invalid runtime side and bus rather than treating them as bottom or aux', () => {
    expect(terminalForBus(terminals, 'L', 'left' as Terminal['side'])).toBeUndefined()
    expect(terminalForBus(terminals, 'unknown' as 'L', 'top')).toBeUndefined()
  })
})

const definitions = new Map(allCatalog.map((product) => [product.id, product]))
const fixture = () => {
  const project = createProject('Контакты', 'demo')
  const product = definitions.get('ekf-rccb-4p-40')!
  project.devices = [createDevice(product, 0, 0), createDevice(product, 1, 0)]
  project.devices[0]!.instanceId = 'source'
  project.devices[1]!.instanceId = 'target'
  project.connections = [{
    id: 'wire', kind: 'busbar', circuitId: '', fromBus: 'L', fromDeviceId: 'source',
    toDeviceId: 'target', fromSide: 'bottom', toSide: 'top', fromTerminal: 0, terminal: 0,
    color: '#a44d37', thickness: 2, label: 'Питание',
  }]
  return project
}
const errorsFor = (project: PanelProject, catalog: Map<string, DeviceDefinition> = definitions) =>
  validateProject(project, catalog).filter((entry) => entry.level === 'error' && entry.context?.connectionId === 'wire')

describe('invalid physical connection diagnostics and scene', () => {
  it('draws a valid device cascade', () => {
    const project = fixture()
    expect(errorsFor(project)).toEqual([])
    expect(buildBoardScene(project, definitions).wires).toHaveLength(1)
  })

  it.each(['from', 'to'] as const)('rejects a missing explicit column at the %s endpoint', (endpoint) => {
    const project = fixture()
    project.connections[0]![endpoint === 'from' ? 'fromTerminal' : 'terminal'] = 99
    expect(errorsFor(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'connection.terminal.missing', context: expect.objectContaining({ endpoint, terminal: 99 }) }),
    ]))
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it.each(['from', 'to'] as const)('rejects a selected N clamp for an L conductor at %s', (endpoint) => {
    const project = fixture()
    project.connections[0]![endpoint === 'from' ? 'fromTerminal' : 'terminal'] = 3
    expect(errorsFor(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'connection.terminal.bus.mismatch', context: expect.objectContaining({ endpoint, terminalBus: 'N' }) }),
    ]))
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it.each(['from', 'to'] as const)('rejects an invalid saved side at %s', (endpoint) => {
    const project = fixture()
    project.connections[0]![endpoint === 'from' ? 'fromSide' : 'toSide'] = 'left' as Connection['fromSide']
    expect(errorsFor(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'connection.terminal.side.invalid', context: expect.objectContaining({ endpoint }) }),
    ]))
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it.each(['from', 'to'] as const)('rejects an incompatible unspecified clamp at %s', (endpoint) => {
    const project = fixture()
    project.connections[0]!.fromBus = 'N'
    delete project.connections[0]!.fromTerminal
    delete project.connections[0]!.terminal
    project.devices[endpoint === 'from' ? 0 : 1]!.productId = 'ekf-mcb-1p-b16'
    expect(errorsFor(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'connection.clamp.bus.missing', context: expect.objectContaining({ endpoint }) }),
    ]))
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it('keeps compatible unspecified legacy endpoints and finds N on both ends', () => {
    const project = fixture()
    project.connections[0]!.fromBus = 'N'
    delete project.connections[0]!.fromTerminal
    delete project.connections[0]!.terminal
    expect(errorsFor(project)).toEqual([])
    const scene = buildBoardScene(project, definitions)
    const wire = scene.wires[0]!
    expect(wire).toBeDefined()
    const source = scene.devices[0]!
    const target = scene.devices[1]!
    expect(wire.from.x).toBeCloseTo(source.x + source.terminals.bottom[3]!.x)
    expect(wire.to.x).toBeCloseTo(target.x + target.terminals.top[3]!.x)
  })

  it.each(['busbar', 'circuit', 'bus'] as const)('reports a deleted source regardless of kind %s', (kind) => {
    const project = fixture()
    project.connections[0]!.kind = kind
    project.connections[0]!.fromDeviceId = 'deleted-source'
    expect(errorsFor(project).some((entry) => ['connection.source.missing', 'connection.busbar.source.missing'].includes(entry.ruleCode))).toBe(true)
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it('does not turn a cascade without its required source into a panel feed', () => {
    const project = fixture()
    delete project.connections[0]!.fromDeviceId
    expect(errorsFor(project).some((entry) => entry.ruleCode === 'connection.busbar.source.missing')).toBe(true)
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it.each(['from', 'to'] as const)('reports a missing catalogue definition at %s', (endpoint) => {
    const project = fixture()
    project.devices[endpoint === 'from' ? 0 : 1]!.productId = 'missing-product'
    expect(errorsFor(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'connection.product.missing', context: expect.objectContaining({ endpoint }) }),
    ]))
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })

  it.each([
    { fromSide: 'top' as const, fromTerminal: 0, fromBus: 'L' as const, code: 'connection.terminal.missing' },
    { fromSide: 'bottom' as const, fromTerminal: 7, fromBus: 'L' as const, code: 'connection.terminal.missing' },
    { fromSide: 'bottom' as const, fromTerminal: 0, fromBus: 'N' as const, code: 'connection.terminal.bus.mismatch' },
  ])('does not draw an invalid busbar source as a fallback at its edge: %j', ({ code, ...patch }) => {
    const project = fixture()
    const busbar = allCatalog.find((product) => product.category === 'busbar' && product.bus === 'L')!
    expect(busbar).toBeDefined()
    project.devices[0] = { ...createDevice(busbar, 0, 0), instanceId: 'source', mount: 'busbar' }
    Object.assign(project.connections[0]!, patch)
    project.connections[0]!.terminal = patch.fromBus === 'N' ? 3 : 0
    expect(errorsFor(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: code, context: expect.objectContaining({ endpoint: 'from' }) }),
    ]))
    expect(buildBoardScene(project, definitions).wires).toEqual([])
  })
})


describe('physical feeder identity', () => {
  it('matches only the requested clamp, side and conductor bus', () => {
    const project = fixture()
    const connection = project.connections[0]!
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'target', 'L')).toBe(true)
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'target', 'N')).toBe(false)
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'target', 'L', 'bottom')).toBe(false)
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'target', 'L', 'top', 1)).toBe(false)
    connection.terminal = 1
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'target', 'L')).toBe(false)
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'target', 'L', 'top', 1)).toBe(true)
  })

  it('recognizes a reverse-drawn conductor at its source clamp', () => {
    const project = fixture()
    const connection = project.connections[0]!
    connection.fromSide = 'top'
    connection.toSide = 'bottom'
    expect(connectionTouchesTerminal(connection, project.devices, definitions, 'source', 'L')).toBe(true)
  })

  it.each([
    { fromDeviceId: 'deleted' }, { fromTerminal: 99 }, { terminal: 99 },
    { kind: 'bus' as const }, { fromDeviceId: undefined },
    { fromDeviceId: 'target', fromSide: 'top' as const, fromTerminal: 0 },
  ])('does not reuse a broken conductor: %j', (patch) => {
    const project = fixture()
    Object.assign(project.connections[0]!, patch)
    expect(connectionTouchesTerminal(project.connections[0]!, project.devices, definitions, 'target', 'L')).toBe(false)
  })
})
