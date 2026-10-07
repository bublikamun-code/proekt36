import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { allCatalog } from '../src/data/catalog'
import { demoProject } from '../src/data/demoProject'
import { buildBoardScene } from '../src/domain/boardScene'
import { createDevice, migrateProject } from '../src/domain/project'
import { validateProjectSchema } from '../src/domain/projectSchema'
import { validateProject } from '../src/domain/validation'
import { useProjectStore } from '../src/stores/project'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))
const setup = () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const store = useProjectStore()
  store.importProject({ ...structuredClone(demoProject), connections: [], circuits: [] })
  return store
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('physical wire endpoints', () => {
  it('retains both selected clamps through migration, undo, redo and geometry', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-xt03', 'L', 'demo-qf03', 0, { fromSide: 'bottom', fromTerminal: 3, toSide: 'bottom' })).toBe(true)
    const saved = JSON.parse(JSON.stringify(store.currentProject))
    expect(validateProjectSchema(saved).valid).toBe(true)
    const project = migrateProject(saved)
    expect(project.connections[0]).toMatchObject({ fromSide: 'bottom', fromTerminal: 3, toSide: 'bottom', terminal: 0 })
    const scene = buildBoardScene(project, definitions)
    const source = scene.devices.find((item) => item.instanceId === 'demo-xt03')!
    const target = scene.devices.find((item) => item.instanceId === 'demo-qf03')!
    expect(scene.wires[0]!.from).toEqual({ x: source.x + source.terminals.bottom[3]!.x, y: source.y + source.terminals.bottom[3]!.y })
    expect(scene.wires[0]!.to.y).toBe(target.y + target.terminals.bottom[0]!.y)
    store.undo()
    expect(store.currentProject.connections).toHaveLength(0)
    store.redo()
    expect(store.currentProject.connections[0]).toMatchObject(project.connections[0]!)
  })

  it('rejects reversed duplicates but allows different screws, with editable properties', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf03', 'L', 'demo-xt03', 0, { fromSide: 'top', fromTerminal: 0, toSide: 'top' })).toBe(true)
    expect(store.connectOnBoard('demo-xt03', 'L', 'demo-qf03', 0, { fromSide: 'top', fromTerminal: 0, toSide: 'top' })).toBe(false)
    expect(store.connectOnBoard('demo-qf03', 'L', 'demo-xt03', 1, { fromSide: 'top', fromTerminal: 0, toSide: 'top' })).toBe(true)
    const first = store.currentProject.connections[0]!
    expect(store.updateConnection(first.id, { thickness: 3 })).toBe(true)
    expect(store.updateConnection(first.id, { terminal: 1 })).toBe(false)
    expect(store.updateConnection(first.id, { toSide: 'bottom', terminal: 3 })).toBe(true)
    expect(validateProject(store.currentProject, definitions).filter((issue) => issue.ruleCode === 'connection.duplicate')).toEqual([])
  })

  it('checks both endpoints and rejects a missing clamp or a different bus', () => {
    const store = setup()
    expect(store.connectFromBus('PE', 'demo-qf03', 0)).toBe(false)
    expect(store.connectOnBoard('demo-xt02', 'L', 'demo-qf03', 0)).toBe(false)
    expect(store.connectFromBus('L', 'demo-xt03', 3, 'top')).toBe(false)
    expect(store.connectFromBus('L', 'demo-xt03', 3, 'bottom')).toBe(true)
    const id = store.currentProject.connections[0]!.id
    expect(store.updateConnection(id, { fromBus: 'N' })).toBe(false)
    expect(store.updateConnection(id, { terminal: -1 })).toBe(false)
    expect(store.updateConnection(id, { terminal: 1.5 })).toBe(false)
    expect(store.updateConnection(id, { terminal: 2 })).toBe(true)
  })

  it('does not shift a shared source clamp when routing a bundle', () => {
    const store = setup()
    for (const terminal of [0, 1]) expect(store.connectOnBoard('demo-qf03', 'L', 'demo-xt03', terminal)).toBe(true)
    const scene = buildBoardScene(store.currentProject, definitions)
    expect(scene.wires[0]!.from).toEqual(scene.wires[1]!.from)
    expect(scene.wires[0]!.to).not.toEqual(scene.wires[1]!.to)
  })

  it('connects a mounted busbar to a breaker and accepts a feed on its contact', () => {
    const store = setup()
    const product = definitions.get('enmas-fork-1p-63a')!
    store.definitions.set(product.id, product)
    const fork = createDevice(product, 1, 0)
    store.currentProject.devices.push(fork)
    expect(store.connectFromBus('L', fork.instanceId, 0, 'bottom')).toBe(true)
    expect(store.connectOnBoard(fork.instanceId, 'L', 'demo-qf03', 0)).toBe(true)
    const scene = buildBoardScene(store.currentProject, definitions)
    expect(scene.wires).toHaveLength(2)
    const mounted = scene.devices.find((item) => item.instanceId === fork.instanceId)!
    expect(scene.wires[0]!.to.y).toBeCloseTo(mounted.y + mounted.terminals.bottom[0]!.y)
    expect(scene.wires[1]!.from.y).toBeCloseTo(scene.wires[0]!.to.y)
  })

  it('rejects invalid side names on import', () => {
    const project = structuredClone(demoProject)
    Object.assign(project.connections[0]!, { toSide: 'left' })
    expect(validateProjectSchema(project).valid).toBe(false)
  })
})
