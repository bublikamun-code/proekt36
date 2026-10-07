import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { allCatalog } from '../src/data/catalog'
import { demoProject } from '../src/data/demoProject'
import { createDevice, migrateProject } from '../src/domain/project'
import { validateProjectSchema } from '../src/domain/projectSchema'
import { validateProject } from '../src/domain/validation'
import { useProjectStore } from '../src/stores/project'

const setup = () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const store = useProjectStore()
  store.importProject({ ...structuredClone(demoProject), connections: [], circuits: [] })
  return store
}

const mountFork = (store: ReturnType<typeof setup>, row = 1) => {
  const product = allCatalog.find((item) => item.id === 'enmas-fork-1p-63a')!
  store.definitions.set(product.id, product)
  const fork = createDevice(product, row, 0)
  store.currentProject.devices.push(fork)
  return fork
}

const snapshot = (store: ReturnType<typeof setup>) => JSON.stringify(store.currentProject)

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('connection integrity across store commands', () => {
  it('refuses a circuit L feed into a PE terminal without creating a circuit or undo entry', () => {
    const store = setup()
    const before = snapshot(store)
    const undoCount = store.undoStack.length
    expect(store.addCircuit('demo-xt02')).toBe(false)
    expect(snapshot(store)).toBe(before)
    expect(store.undoStack).toHaveLength(undoCount)
  })

  it('shares an existing physical L feeder across new circuits and preserves it on circuit deletion', () => {
    const store = setup()
    expect(store.connectFromBus('L', 'demo-qf03', 0, 'top')).toBe(true)
    const feeder = { ...store.currentProject.connections[0]! }
    const first = store.addCircuit('demo-qf03')
    const second = store.addCircuit('demo-qf03')
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(store.currentProject.circuits).toHaveLength(2)
    expect(store.currentProject.connections).toEqual([feeder])
    if (typeof first !== 'object' || typeof second !== 'object') throw new Error('Expected two circuits')
    store.deleteCircuit(first.id)
    store.deleteCircuit(second.id)
    expect(store.currentProject.connections).toEqual([feeder])
  })

  it('creates one feeder when circuits are added repeatedly to the same breaker', () => {
    const store = setup()
    expect(store.addCircuit('demo-qf03')).toBeTruthy()
    expect(store.addCircuit('demo-qf03')).toBeTruthy()
    expect(store.currentProject.circuits).toHaveLength(2)
    expect(store.currentProject.connections).toHaveLength(1)
    expect(store.currentProject.connections[0]).toMatchObject({ fromBus: 'L', toDeviceId: 'demo-qf03' })
  })

  it('keeps a device-to-device L feeder when a circuit is assigned to its target', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf01', 'L', 'demo-qf03', 0)).toBe(true)
    const feeder = { ...store.currentProject.connections[0]! }
    expect(store.addCircuit('demo-qf03')).toBeTruthy()
    expect(store.currentProject.connections).toEqual([feeder])
  })

  it('adds neutral after reusing a device feeder without creating parallel L power', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf01', 'L', 'demo-qfi01')).toBe(true)
    const circuit = store.addCircuit('demo-qfi01')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    store.selectDevice(null)
    expect(store.addConnection(circuit.id)).toBe(true)
    expect(store.currentProject.connections.map((item) => item.fromBus)).toEqual(['L', 'N'])
    expect(store.currentProject.connections[0]).toMatchObject({ fromDeviceId: 'demo-qf01' })
    expect(store.currentProject.connections[1]).toMatchObject({ circuitId: circuit.id, toDeviceId: 'demo-qfi01' })
  })

  it('allows restoring L when an imported circuit wire names a nonexistent clamp', () => {
    const store = setup()
    const circuit = store.addCircuit('demo-qfi01')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    const saved = JSON.parse(snapshot(store))
    saved.connections[0].terminal = 15
    const damagedWireId = saved.connections[0].id
    store.importProject(saved)
    store.selectDevice(null)
    expect(store.addConnection(circuit.id)).toBe(true)
    expect(store.currentProject.connections).toHaveLength(2)
    expect(store.currentProject.connections[0]).toMatchObject({ id: damagedWireId, terminal: 15 })
    const repaired = store.currentProject.connections[1]!
    expect(repaired).toMatchObject({ circuitId: circuit.id, fromBus: 'L', toDeviceId: 'demo-qfi01' })
    expect(repaired.terminal).toBeUndefined()
    expect(validateProject(store.currentProject, store.definitions)
      .filter((item) => item.context?.connectionId === repaired.id)).toEqual([])
  })

  it('preserves a terminal-block circuit target through JSON migration and import with cleared selection', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf03', 'L', 'demo-xt03')).toBe(true)
    const circuit = store.addCircuit('demo-xt03')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    const saved = JSON.parse(snapshot(store))
    expect(saved.circuits[0]).toMatchObject({ targetDeviceId: 'demo-xt03' })
    expect(validateProjectSchema(saved).valid).toBe(true)
    const migrated = migrateProject(saved)
    expect(migrated.circuits[0]).toMatchObject({ targetDeviceId: 'demo-xt03' })
    store.importProject(migrated)
    store.selectDevice(null)
    expect(store.currentProject.circuits[0]).toMatchObject({ targetDeviceId: 'demo-xt03' })
    const before = snapshot(store)
    // XT03 already has L and cannot accept N or PE. Falling back to the unrelated
    // protection would incorrectly add a new L wire to that breaker.
    expect(store.addConnection(circuit.id)).toBe(false)
    expect(snapshot(store)).toBe(before)
  })

  it('recognises a reused physical feeder in circuit diagnostics and still reports missing N and PE', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf01', 'L', 'demo-qfi01')).toBe(true)
    const circuit = store.addCircuit('demo-qfi01')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    const issues = validateProject(store.currentProject, store.definitions)
      .filter((item) => item.context?.circuitId === circuit.id)
    expect(issues.some((item) => item.ruleCode === 'circuit.connection.missing')).toBe(false)
    const missingBuses = issues.filter((item) => item.ruleCode === 'circuit.bus.completeness.preliminary')
      .map((item) => item.context?.bus)
    expect(missingBuses).toEqual(['N', 'PE'])
  })

  it('retains the shared feeder as independent wiring when its original circuit is deleted', () => {
    const store = setup()
    store.selectDevice('demo-qf03')
    const first = store.addCircuit('demo-qf03')
    const second = store.addCircuit('demo-qf03')
    if (typeof first !== 'object' || typeof second !== 'object') throw new Error('Expected two circuits')
    const feederId = store.currentProject.connections[0]!.id
    store.deleteCircuit(first.id)
    expect(store.currentProject.circuits.map((item) => item.id)).toEqual([second.id])
    expect(store.currentProject.connections).toHaveLength(1)
    expect(store.currentProject.connections[0]).toMatchObject({
      id: feederId, circuitId: '', kind: 'bus', fromBus: 'L', toDeviceId: 'demo-qf03',
    })
    store.undo()
    expect(store.currentProject.circuits).toHaveLength(2)
    expect(store.currentProject.connections[0]).toMatchObject({ id: feederId, circuitId: first.id })
  })

  it.each(['demo-xt03', 'demo-qf03'])('atomically removes dependent circuits and their wires when deleting %s', (deviceId) => {
    const store = setup()
    store.selectDevice('demo-qf03')
    const dependent = store.addCircuit('demo-xt03')
    const unrelated = store.addCircuit('demo-qfi02')
    if (typeof dependent !== 'object' || typeof unrelated !== 'object') throw new Error('Expected two circuits')
    store.selectDevice('demo-xt02')
    expect(store.addConnection(dependent.id)).toBe(true)
    const independentWire = { ...store.currentProject.connections.find((item) => item.circuitId === unrelated.id)! }
    const before = snapshot(store)
    const undoCount = store.undoStack.length
    store.selectDevice(deviceId)
    store.deleteSelected()
    expect(store.currentProject.devices.some((item) => item.instanceId === deviceId)).toBe(false)
    expect(store.currentProject.circuits.map((item) => item.id)).toEqual([unrelated.id])
    expect(store.currentProject.connections).toEqual([independentWire])
    expect(store.undoStack).toHaveLength(undoCount + 1)
    const saved = JSON.parse(snapshot(store))
    expect(validateProjectSchema(saved).valid).toBe(true)
    store.undo()
    expect(snapshot(store)).toBe(before)
    store.importProject(migrateProject(saved))
    expect(validateProjectSchema(store.currentProject).valid).toBe(true)
    expect(store.currentProject.circuits.map((item) => item.id)).toEqual([unrelated.id])
    expect(store.currentProject.connections).toEqual([independentWire])
  })

  it('preserves a shared target feeder even when the remaining circuit has different protection', () => {
    const store = setup()
    store.selectDevice('demo-qf02')
    const first = store.addCircuit('demo-xt03')
    store.selectDevice('demo-qf03')
    const second = store.addCircuit('demo-xt03')
    if (typeof first !== 'object' || typeof second !== 'object') throw new Error('Expected two circuits')
    expect(first.protectionDeviceId).not.toBe(second.protectionDeviceId)
    const feederId = store.currentProject.connections[0]!.id
    expect(store.currentProject.connections).toHaveLength(1)
    store.deleteCircuit(first.id)
    expect(store.currentProject.circuits.map((item) => item.id)).toEqual([second.id])
    expect(store.currentProject.connections).toHaveLength(1)
    expect(store.currentProject.connections[0]).toMatchObject({ id: feederId, circuitId: '', toDeviceId: 'demo-xt03', kind: 'bus' })
  })

  it('removes an unshared target feeder even when another circuit uses the same protection', () => {
    const store = setup()
    const first = store.addCircuit('demo-qf03')
    const second = store.addCircuit('demo-qf02')
    if (typeof first !== 'object' || typeof second !== 'object') throw new Error('Expected two circuits')
    expect(store.updateCircuit(second.id, { protectionDeviceId: first.protectionDeviceId })).toBe(true)
    const survivor = { ...store.currentProject.connections.find((item) => item.circuitId === second.id)! }
    expect(store.currentProject.connections).toHaveLength(2)
    store.deleteCircuit(first.id)
    expect(store.currentProject.circuits.map((item) => item.id)).toEqual([second.id])
    expect(store.currentProject.connections).toEqual([survivor])
  })

  it('adds neutral only where it exists and refuses to invent PE on a residual current breaker', () => {
    const store = setup()
    const circuit = store.addCircuit('demo-qfi01')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    store.selectDevice('demo-qfi01')
    expect(store.addConnection(circuit.id)).toBe(true)
    expect(store.currentProject.connections.map((item) => item.fromBus)).toEqual(['L', 'N'])
    const before = snapshot(store)
    expect(store.addConnection(circuit.id)).toBe(false)
    expect(snapshot(store)).toBe(before)
  })

  it('uses the selected PE block for an additional circuit conductor', () => {
    const store = setup()
    const circuit = store.addCircuit('demo-qf03')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    store.selectDevice('demo-xt02')
    expect(store.addConnection(circuit.id)).toBe(true)
    expect(store.currentProject.connections[1]).toMatchObject({
      circuitId: circuit.id, fromBus: 'PE', toDeviceId: 'demo-xt02',
    })
    expect(store.currentProject.connections.some((item) => item.fromBus === 'N')).toBe(false)
  })

  it('does not duplicate a manual neutral feed when adding a circuit conductor', () => {
    const store = setup()
    const circuit = store.addCircuit('demo-qfi01')
    if (typeof circuit !== 'object') throw new Error('Expected a circuit')
    expect(store.connectFromBus('N', 'demo-qfi01')).toBe(true)
    store.selectDevice('demo-qfi01')
    const before = snapshot(store)
    expect(store.addConnection(circuit.id)).toBe(false)
    expect(snapshot(store)).toBe(before)
  })

  it.each([0, 1])('does not infer electrical contact with a FORK in row %i when placing equipment', (row) => {
    const store = setup()
    mountFork(store, row)
    expect(store.addDevice('ekf-mcb-1p-c6', 1, 5).ok).toBe(true)
    expect(store.currentProject.connections).toEqual([])
  })

  it('validates explicit busbar connections and recognises duplicates created by the wire tool', () => {
    const store = setup()
    const fork = mountFork(store)
    store.addBusbarConnection(fork.instanceId, 'demo-xt02')
    expect(store.currentProject.connections).toEqual([])
    store.addBusbarConnection(fork.instanceId, 'demo-qf03')
    expect(store.currentProject.connections).toHaveLength(1)
    expect(store.connectOnBoard(fork.instanceId, 'L', 'demo-qf03')).toBe(false)
    store.addBusbarConnection(fork.instanceId, 'demo-qf03')
    expect(store.currentProject.connections).toHaveLength(1)
    expect(store.connectOnBoard(fork.instanceId, 'L', 'demo-qf02')).toBe(true)
    store.addBusbarConnection(fork.instanceId, 'demo-qf02')
    expect(store.currentProject.connections).toHaveLength(2)
  })

  it('allows a jumper between distinct contacts of one block but rejects its reverse and a same-contact loop', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-xt03', 'L', 'demo-xt03', 1, {
      fromSide: 'top', fromTerminal: 0, toSide: 'top',
    })).toBe(true)
    expect(store.connectOnBoard('demo-xt03', 'L', 'demo-xt03', 0, {
      fromSide: 'top', fromTerminal: 1, toSide: 'top',
    })).toBe(false)
    expect(store.connectOnBoard('demo-xt03', 'L', 'demo-xt03', 0, {
      fromSide: 'top', fromTerminal: 0, toSide: 'top',
    })).toBe(false)
    expect(store.currentProject.connections).toHaveLength(1)
    const id = store.currentProject.connections[0]!.id
    const before = snapshot(store)
    expect(store.updateConnection(id, { terminal: 0 })).toBe(false)
    expect(snapshot(store)).toBe(before)
    expect(store.updateConnection(id, { terminal: 0, toSide: 'bottom' })).toBe(true)
    store.undo()
    expect(snapshot(store)).toBe(before)
  })

  it('revalidates both endpoints when editing a source contact or bus', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf03', 'L', 'demo-xt03', 0)).toBe(true)
    const id = store.currentProject.connections[0]!.id
    const before = snapshot(store)
    expect(store.updateConnection(id, { fromTerminal: 8 })).toBe(false)
    expect(store.updateConnection(id, { fromBus: 'N', toDeviceId: 'demo-xt01' })).toBe(false)
    expect(snapshot(store)).toBe(before)
    expect(store.updateConnection(id, { label: 'Питание', thickness: 3 })).toBe(true)
  })
})
