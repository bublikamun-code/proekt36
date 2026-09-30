import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { builtinCatalog } from '../src/data/catalog'
import { compactRow, evaluateCabinetMigration, getFootprintModules } from '../src/domain/layout'
import { createDevice, createProject } from '../src/domain/project'
import type { PlacedDevice } from '../src/domain/types'
import { useProjectStore } from '../src/stores/project'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const setupBrowserStorage = () => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
  Object.defineProperty(globalThis, 'document', { value: { documentElement: { dataset: {} } }, configurable: true })
}

const setupStore = () => {
  setupBrowserStorage()
  setActivePinia(createPinia())
  return useProjectStore()
}

const catalog = new Map(builtinCatalog.map((product) => [product.id, product]))
const oneModule = catalog.get('ekf-mcb-1p-c6')!
const threeModule = { ...oneModule, id: 'three-module', moduleWidth: 3 }
const definitions = new Map([...catalog, [threeModule.id, threeModule]] as const)
const protection = catalog.get('ekf-mcb-1p-b16')!
const terminal = catalog.get('ekf-terminal-1p-gray')!
const asDevice = (id: string, productId: string, row: number, slot: number): PlacedDevice => ({
  ...createDevice(definitions.get(productId) ?? oneModule, row, slot),
  instanceId: id,
  productId,
  address: id,
})

const issueCodes = (plan: ReturnType<typeof evaluateCabinetMigration>) => plan.issues.map((issue) => issue.code)

afterEach(() => {
  vi.useRealTimers()
})

describe('cabinet migration planning', () => {
  it('detects missing products, invalid rows, width overflow and overlap without mutating the project', () => {
    const project = createProject('Миграция', 'apartment')
    project.devices = [
      asDevice('wide', threeModule.id, 0, 0),
      asDevice('overlap', oneModule.id, 0, 2),
      asDevice('overflow', oneModule.id, 0, 12),
      asDevice('invalid-row', oneModule.id, 1, 0),
      { ...asDevice('missing', 'deleted-product', 0, 0), mount: 'din' },
    ]
    const before = JSON.stringify(project)

    const plan = evaluateCabinetMigration(project, definitions, 'panel36-12-embedded')

    expect(plan.canApply).toBe(false)
    expect(new Set(issueCodes(plan))).toEqual(new Set(['invalid-row', 'width-overflow', 'overlap', 'missing-product']))
    expect(plan.devices).toHaveLength(project.devices.length)
    expect(JSON.stringify(project)).toBe(before)
  })

  it('packs a safe migration while preserving every device identity', () => {
    const project = createProject('Упаковка', 'apartment')
    project.devices = [
      asDevice('first', oneModule.id, 0, 1),
      asDevice('second', threeModule.id, 0, 1),
      asDevice('third', oneModule.id, 1, 0),
    ]
    const beforeIds = project.devices.map((item) => item.instanceId)

    const plan = evaluateCabinetMigration(project, definitions, 'panel36-12-embedded')

    expect(plan.canApply).toBe(true)
    expect(plan.affectedPositions).toHaveLength(2)
    expect(plan.devices.map((item) => item.instanceId)).toEqual(beforeIds)
    expect(plan.devices.filter((item) => item.mount !== 'busbar')).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: 'first', row: 0, slot: 0 }),
      expect.objectContaining({ instanceId: 'second', row: 0, slot: 1 }),
      expect.objectContaining({ instanceId: 'third', row: 0, slot: 4 }),
    ]))
  })
})

describe('staged migration commands', () => {
  it('does not lose devices while staging, cancelling, or committing', () => {
    const store = setupStore()
    store.currentProject.devices = [
      { ...asDevice('first', oneModule.id, 0, 0), quantity: 99 },
      asDevice('second', 'ekf-mcb-3p-c25', 0, 2),
    ]
    store.currentProject.devices.push(asDevice('missing', 'deleted-product', 0, 0))
    const original = JSON.stringify(store.currentProject)

    const blocked = store.stageCabinetMigration('panel36-12-embedded')
    expect(blocked.canApply).toBe(false)
    expect(store.currentProject.devices).toHaveLength(3)
    expect(store.commitCabinetMigration()).toBe(false)
    expect(store.currentProject.devices).toHaveLength(3)
    expect(JSON.stringify(store.currentProject)).toBe(original)
    store.cancelCabinetMigration()
    expect(store.cabinetMigration).toBeNull()

    store.currentProject.devices = store.currentProject.devices.filter((item) => item.productId !== 'deleted-product')
    const safe = store.stageCabinetMigration('panel36-12-embedded')
    expect(safe.canApply).toBe(true)
    expect(store.currentProject.devices).toHaveLength(2)
    expect(store.commitCabinetMigration()).toBe(true)
    expect(store.currentProject.devices.map((item) => item.instanceId)).toEqual(['first', 'second'])
    expect(store.cabinetMigration).toBeNull()
    store.$dispose()
  })

  it('cancels a stale plan instead of applying it to a changed project', () => {
    const store = setupStore()
    store.currentProject.devices = [asDevice('first', oneModule.id, 0, 0)]
    store.stageCabinetMigration('panel36-12-embedded')
    expect(store.updateSettings({ reserveModules: store.currentProject.settings.reserveModules + 1 })).toBe(true)

    expect(store.commitCabinetMigration()).toBe(false)
    expect(store.cabinetMigration).toBeNull()
    expect(store.currentProject.settings.cabinetId).not.toBe('panel36-12-embedded')
    store.$dispose()
  })
})

describe('transactional editor validation', () => {
  it('rejects invalid numeric settings and selected-device edits atomically', () => {
    const store = setupStore()
    const device = asDevice('selected', oneModule.id, 0, 0)
    store.currentProject.devices = [device]
    store.selectedDeviceId = device.instanceId
    const before = JSON.stringify(store.currentProject)
    const historyLength = store.undoStack.length

    expect(store.updateSettings({ inputCurrent: Number.NaN })).toBe(false)
    expect(store.updateSettings({ inputCurrent: Number.POSITIVE_INFINITY })).toBe(false)
    expect(store.updateSettings({ reserveModules: -1 })).toBe(false)
    expect(store.updateSettings({ rows: 1.5 })).toBe(false)
    expect(store.updateSelected({ quantity: Number.NaN })).toBe(false)
    expect(store.updateSelected({ quantity: Number.POSITIVE_INFINITY })).toBe(false)
    expect(store.updateSelected({ quantity: 4.5 })).toBe(false)
    expect(store.updateSelected({ phase: 4 as 1 })).toBe(false)
    expect(store.updateSelected({ address: 'x'.repeat(65) })).toBe(false)
    expect(store.updateSelected({ marking: 'x'.repeat(65) })).toBe(false)
    // The project schema treats `required: true` as also meaning non-blank, so an emptied
    // address has to be refused here too. It used to be accepted, and the save that followed
    // then threw inside the repository, which silently stopped autosave for the whole project.
    expect(store.updateSelected({ address: '' })).toBe(false)
    expect(store.updateSelected({ address: '   ' })).toBe(false)

    expect(JSON.stringify(store.currentProject)).toBe(before)
    expect(store.undoStack).toHaveLength(historyLength)
    store.$dispose()
  })

  it('keeps quantity separate from physical footprint while compacting', () => {
    const wide = { ...asDevice('wide', threeModule.id, 0, 4), quantity: 99 }
    const single = asDevice('single', oneModule.id, 0, 9)
    const compacted = compactRow([wide, single], 0, definitions)

    expect(getFootprintModules(wide, definitions)).toBe(3)
    expect(compacted.find((item) => item.instanceId === 'wide')?.slot).toBe(0)
    expect(compacted.find((item) => item.instanceId === 'single')?.slot).toBe(3)
    expect(compacted.find((item) => item.instanceId === 'wide')?.quantity).toBe(99)
  })

  it('validates circuit numbers, phase and protection category without partial edits', () => {
    const store = setupStore()
    const p1 = asDevice('protection', protection.id, 0, 0)
    const target = asDevice('target', terminal.id, 0, 2)
    store.currentProject.devices = [p1, target]
    store.selectedDeviceId = target.instanceId
    store.addCircuit(target.instanceId)
    const circuit = store.currentProject.circuits[0]!
    const before = JSON.stringify(store.currentProject.circuits)

    expect(store.updateCircuit(circuit.id, { current: Number.NaN })).toBe(false)
    expect(store.updateCircuit(circuit.id, { current: -1 })).toBe(false)
    expect(store.updateCircuit(circuit.id, { power: Number.POSITIVE_INFINITY })).toBe(false)
    expect(store.updateCircuit(circuit.id, { wireCrossSection: 0.49 })).toBe(false)
    expect(store.updateCircuit(circuit.id, { phase: 4 as 1 })).toBe(false)
    expect(store.updateCircuit(circuit.id, { protectionDeviceId: target.instanceId })).toBe(false)
    expect(JSON.stringify(store.currentProject.circuits)).toBe(before)

    expect(store.updateCircuit(circuit.id, { current: 12.5, power: 1500, wireCrossSection: 1.5, phase: 1 })).toBe(true)
    expect(store.currentProject.circuits[0]).toMatchObject({ current: 12.5, power: 1500, wireCrossSection: 1.5, phase: 1 })
    store.$dispose()
  })
})

describe('connection exhaustion', () => {
  it('stops after L, N and PE instead of falling back to N or duplicating a device/bus', () => {
    const store = setupStore()
    const p1 = asDevice('protection', protection.id, 0, 0)
    const target = asDevice('target', terminal.id, 0, 2)
    store.currentProject.devices = [p1, target]
    store.selectedDeviceId = target.instanceId
    store.addCircuit(target.instanceId)
    const circuitId = store.currentProject.circuits[0]!.id

    expect(store.addConnection(circuitId)).toBe(true)
    expect(store.addConnection(circuitId)).toBe(true)
    expect(store.addConnection(circuitId)).toBe(false)
    const circuitConnections = store.currentProject.connections.filter((item) => item.circuitId === circuitId)
    expect(circuitConnections).toHaveLength(3)
    expect(circuitConnections.map((item) => item.fromBus)).toEqual(['L', 'N', 'PE'])
    expect(new Set(circuitConnections.map((item) => `${item.fromBus}:${item.toDeviceId}`)).size).toBe(3)
    expect(store.addConnection(circuitId)).toBe(false)
    expect(store.currentProject.connections).toHaveLength(3)
    store.$dispose()
  })
})
