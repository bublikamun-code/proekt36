import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog } from '../src/data/catalog'
import { createDevice, createProject } from '../src/domain/project'
import { phaseBalance } from '../src/domain/electrical'
import { validateProject } from '../src/domain/validation'
import type { Circuit, Connection } from '../src/domain/types'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1',
  name: 'Цепь 1',
  loadName: 'Розетка',
  current: 10,
  power: 0,
  phase: 1,
  protectionDeviceId: '',
  color: '#c65c3b',
  wireCrossSection: 1.5,
  note: '',
  ...patch,
})

describe('project validation', () => {
  it('marks preliminary calculation and empty board', () => {
    const issues = validateProject(createProject(), definitions)
    expect(issues.some((issue) => issue.id === 'empty')).toBe(true)
    expect(issues.some((issue) => issue.id === 'preliminary')).toBe(true)
  })

  it('reports over-current protection and missing protection categories', () => {
    const project = createProject('test', 'demo', { inputCurrent: 16 })
    project.devices = [createDevice(definitions.get('ekf-mcb-3p-c25')!, 0, 0)]
    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id.startsWith('current-'))).toBe(true)
    expect(issues.some((issue) => issue.id === 'rccd')).toBe(true)
    expect(issues.some((issue) => issue.id === 'spd')).toBe(true)
  })

  it('reports row overflow on a selected 12-module rail', () => {
    const project = createProject('Короткий ряд', 'apartment', { cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' })
    const device = createDevice(definitions.get('ekf-mcb-4p-b32')!, 0, 10)
    project.devices = [device]
    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id === `row-overflow-${device.instanceId}`)).toBe(true)
  })

  it('requires a real source for a busbar connection', () => {
    const project = createProject('Шины', 'apartment')
    const target = createDevice(definitions.get('enmas-nb1-63h-1p-16a-c')!, 0, 0)
    project.devices = [target]
    project.connections = [{
      id: 'fork-link', circuitId: '', fromBus: 'L', toDeviceId: target.instanceId,
      color: '#aeb8b4', thickness: 2, label: 'FORK', kind: 'busbar', fromDeviceId: 'missing-busbar',
    }]
    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id === 'connection-busbar-source-missing-fork-link')).toBe(true)
  })

  it('calls an unloaded board balanced instead of maximally skewed', () => {
    // A zero denominator used to be forced to 1, which reported a 100 % spread on
    // a panel that has no load at all.
    const empty = createProject('Пусто', 'demo', { phase: 3 })
    expect(phaseBalance(empty, definitions).spread).toBe(0)

    const loaded = createProject('Одна фаза', 'demo', { phase: 3 })
    loaded.devices = [createDevice(definitions.get('ekf-mcb-3p-c25')!, 0, 0)]
    expect(phaseBalance(loaded, definitions).spread).toBe(100)
  })

  it('reports a three-phase load above the incoming rating', () => {
    // A single-phase board already had a per-circuit check; a three-phase one had no aggregate
    // check, so the phase totals were displayed but never compared with the incoming rating.
    const project = createProject('Перегруз по L1', 'demo', { phase: 3, inputCurrent: 40 })
    project.circuits = [1, 2, 3].map((index) => ({ ...circuit(), id: `c${index}`, name: `Цепь ${index}`, current: 20, phase: 1 }))

    const flagged = validateProject(project, definitions).filter((issue) => issue.ruleCode === 'electrical.phase-load.preliminary')
    expect(flagged.map((issue) => issue.id)).toEqual(['phase-load-l1'])
    expect(flagged[0].message).toContain('60 А')
  })

  it('stays quiet while every phase is under the incoming rating', () => {
    const project = createProject('В норме', 'demo', { phase: 3, inputCurrent: 40 })
    project.circuits = [1, 2, 3].map((index) => ({ ...circuit(), id: `c${index}`, name: `Цепь ${index}`, current: 10, phase: 1 }))

    const flagged = validateProject(project, definitions).filter((issue) => issue.ruleCode === 'electrical.phase-load.preliminary')
    expect(flagged).toEqual([])
  })

  it('does not read device ratings as load on a board with no circuits', () => {
    // phaseBalance falls back to summing the rated current of every device when a project has no
    // circuits. A sum of protective ratings is not a load, so this must not raise the alarm —
    // otherwise every freshly seeded board would come out overloaded.
    const project = createProject('Без цепей', 'demo', { phase: 3, inputCurrent: 16 })
    project.devices = ['ekf-mcb-4p-b32', 'ekf-mcb-3p-c25', 'ekf-mcb-1p-b16'].map((id, index) => createDevice(definitions.get(id)!, 0, index * 4))

    const flagged = validateProject(project, definitions).filter((issue) => issue.ruleCode === 'electrical.phase-load.preliminary')
    expect(flagged).toEqual([])
  })
})

describe('requested ENMAS catalog scope', () => {
  it('contains the named families and excludes the unrequested DC series', () => {
    const series = new Set(allCatalog.map((item) => item.series))
    expect(series.has('NB1-63H')).toBe(true)
    expect(series.has('NL1')).toBe(true)
    expect(series.has('NB1L')).toBe(true)
    expect(series.has('NB310L')).toBe(true)
    expect(series.has('NJVA1-63')).toBe(true)
    expect(series.has('FORK')).toBe(true)
    expect(series.has('NU6-IIG')).toBe(true)
    expect(series.has('ШК')).toBe(true)
    expect(series.has('КБР')).toBe(true)
    expect(series.has('КСВ')).toBe(true)
    expect(series.has('NGU')).toBe(true)
    expect(series.has('PSU-DIN-24V-5A')).toBe(true)
    expect(allCatalog.some((item) => item.name.includes('NB1-63DC'))).toBe(false)
    expect(builtinCatalog.some((item) => item.name.includes('NB1-63DC'))).toBe(false)
  })
})


describe('circuit completeness with shared physical feeders', () => {
  const setup = () => {
    const project = createProject('Общий ввод', 'demo')
    const product = definitions.get('ekf-rccb-4p-40')!
    const source = { ...createDevice(product, 0, 0), instanceId: 'source' }
    const target = { ...createDevice(product, 1, 0), instanceId: 'target' }
    project.devices = [source, target]
    project.circuits = [circuit({ protectionDeviceId: target.instanceId, targetDeviceId: target.instanceId })]
    project.connections = [{
      id: 'shared-feed', kind: 'bus', circuitId: '', fromBus: 'L', toDeviceId: target.instanceId,
      toSide: 'top', terminal: 0, color: '#a44d37', thickness: 2, label: 'Общий ввод',
    }]
    return project
  }
  const missing = (project: ReturnType<typeof setup>) => validateProject(project, definitions)
    .filter((entry) => entry.ruleCode === 'circuit.connection.missing'
      || (entry.ruleCode === 'circuit.bus.completeness.preliminary' && entry.context.bus === 'L'))

  it('recognizes a shared feed for multiple circuits without changing its owner', () => {
    const project = setup()
    project.circuits.push(circuit({ id: 'second', protectionDeviceId: 'target', targetDeviceId: 'target' }))
    const original = structuredClone(project.connections)
    expect(missing(project)).toEqual([])
    expect(project.connections).toEqual(original)
    project.connections = []
    expect(missing(project)).toHaveLength(4)
  })

  it('recognizes a feeder owned by another circuit', () => {
    const project = setup()
    project.connections[0]!.kind = 'circuit'
    project.connections[0]!.circuitId = 'other'
    project.circuits.push(circuit({ id: 'other', protectionDeviceId: 'target', targetDeviceId: 'target' }))
    expect(missing(project)).toEqual([])
  })

  it('recognizes a reverse-drawn wire at the target input', () => {
    const project = setup()
    Object.assign(project.connections[0]!, {
      kind: 'busbar', fromDeviceId: 'target', fromSide: 'top', fromTerminal: 0,
      toDeviceId: 'source', toSide: 'bottom',
    })
    expect(missing(project)).toEqual([])
  })

  it.each<Partial<Connection>>([
    { toSide: 'bottom' }, { terminal: 1 }, { toDeviceId: 'source' },
  ])('does not count an unrelated clamp carrying the same bus: %j', (patch) => {
    const project = setup()
    Object.assign(project.connections[0]!, patch)
    expect(missing(project)).toHaveLength(2)
  })

  it.each<Partial<Connection>>([
    { terminal: 99 }, { terminal: 3 }, { fromDeviceId: 'deleted' },
    { kind: 'busbar', fromDeviceId: 'source', fromTerminal: 99 },
  ])('does not count an invalid connection even when it names the circuit: %j', (patch) => {
    const project = setup()
    Object.assign(project.connections[0]!, { kind: 'circuit', circuitId: project.circuits[0]!.id }, patch)
    expect(missing(project)).toHaveLength(2)
  })

  it('keeps valid legacy circuit-owned wires on an explicitly chosen contact', () => {
    const project = setup()
    Object.assign(project.connections[0]!, { kind: 'circuit', circuitId: project.circuits[0]!.id, terminal: 1, toSide: 'bottom' })
    expect(missing(project)).toEqual([])
  })

  it('falls back to protection when an old circuit has no stored target or own wire', () => {
    const project = setup()
    delete project.circuits[0]!.targetDeviceId
    expect(missing(project)).toEqual([])
  })

  it('prefers the historical circuit target over its protection device', () => {
    const project = setup()
    delete project.circuits[0]!.targetDeviceId
    project.circuits[0]!.protectionDeviceId = 'source'
    project.connections.unshift({
      ...project.connections[0]!, id: 'invalid-old-wire', kind: 'circuit',
      circuitId: project.circuits[0]!.id, terminal: 99,
    })
    expect(missing(project)).toEqual([])
  })

  it('reports an explicitly missing target instead of silently falling back to protection', () => {
    const project = setup()
    project.circuits[0]!.targetDeviceId = 'deleted'
    const issues = validateProject(project, definitions)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'circuit.target.missing', level: 'error', context: expect.objectContaining({ targetDeviceId: 'deleted' }) }),
    ]))
    expect(missing(project)).toHaveLength(2)
  })
})
