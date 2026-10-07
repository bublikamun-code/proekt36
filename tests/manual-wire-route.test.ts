import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { demoProject } from '../src/data/demoProject'
import { buildBoardScene } from '../src/domain/boardScene'
import { migrateProject, normalizeConnection } from '../src/domain/project'
import { createProjectFileEnvelope, readProjectFile } from '../src/domain/projectFile'
import { validateProjectSchema } from '../src/domain/projectSchema'
import type { Connection } from '../src/domain/types'
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

const route = (): NonNullable<Connection['route']> => ({
  points: [{ x: 22.5, y: 35 }, { x: 210, y: 160.75 }],
  segmentLayers: ['front', 'rear', 'front'],
})

const snapshot = (store: ReturnType<typeof setup>) => JSON.stringify(store.currentProject)

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('manual wire route persistence and commands', () => {
  it('retains route anchors, layer order and contacts through normalisation and exported project import', async () => {
    const store = setup()
    expect(store.connectOnBoard('demo-xt03', 'L', 'demo-qf03', 0, {
      fromTerminal: 3, fromSide: 'bottom', toSide: 'bottom', route: route(),
    })).toBe(true)
    const wire = store.currentProject.connections[0]!
    expect(normalizeConnection(wire)).toMatchObject({ route: route(), fromTerminal: 3, toSide: 'bottom' })
    const file = new File([JSON.stringify(createProjectFileEnvelope(store.currentProject))], 'manual-route.json', { type: 'application/json' })
    const imported = await readProjectFile(file)
    expect(validateProjectSchema(imported).valid).toBe(true)
    expect(imported.connections[0]).toMatchObject({ route: route(), fromTerminal: 3, toSide: 'bottom' })
    expect(migrateProject(imported).connections[0]!.route).toEqual(route())
    store.importProject(imported)
    expect(store.currentProject.connections[0]!.route).toEqual(route())
  })

  it('accepts a manually routed bus feed and keeps route edits/reset individually undoable', () => {
    const store = setup()
    expect(store.connectFromBus('L', 'demo-qf03', 0, 'top', route())).toBe(true)
    const id = store.currentProject.connections[0]!.id
    const changed = { points: [{ x: 12, y: 48 }], segmentLayers: ['rear', 'front'] as const }
    expect(store.updateConnection(id, { route: { ...changed, segmentLayers: [...changed.segmentLayers] } })).toBe(true)
    expect(store.currentProject.connections[0]!.route).toEqual(changed)
    store.undo()
    expect(store.currentProject.connections[0]!.route).toEqual(route())
    store.redo()
    expect(store.currentProject.connections[0]!.route).toEqual(changed)
    expect(store.updateConnection(id, { route: undefined })).toBe(true)
    expect(store.currentProject.connections[0]!.route).toBeUndefined()
    expect(JSON.parse(snapshot(store)).connections[0]).not.toHaveProperty('route')
    store.undo()
    expect(store.currentProject.connections[0]!.route).toEqual(changed)
  })

  it('keeps absolute route anchors fixed when the connected apparatus moves', () => {
    const store = setup()
    expect(store.connectOnBoard('demo-qf01', 'L', 'demo-qf03', 0, { route: route() })).toBe(true)
    const before = buildBoardScene(store.currentProject, store.definitions).wires[0]!
    store.selectDevice('demo-qf03')
    store.moveSelected(1, 5)
    expect(store.selectedDevice).toMatchObject({ row: 1, slot: 5 })
    const after = buildBoardScene(store.currentProject, store.definitions).wires[0]!
    expect(after.from).toEqual(before.from)
    expect(after.to).not.toEqual(before.to)
    expect(store.currentProject.connections[0]!.route).toEqual(route())
    store.undo()
    expect(buildBoardScene(store.currentProject, store.definitions).wires[0]!.to).toEqual(before.to)
    expect(store.currentProject.connections[0]!.route).toEqual(route())
  })

  it('accepts coordinate boundaries and the maximum number of anchors', () => {
    const store = setup()
    const maximum: NonNullable<Connection['route']> = {
      points: Array.from({ length: 128 }, (_, index) => ({ x: index === 0 ? 0 : 10000, y: index })),
      segmentLayers: Array.from({ length: 129 }, (_, index) => index % 2 ? 'rear' : 'front'),
    }
    expect(store.connectFromBus('L', 'demo-qf03', 0, 'top', maximum)).toBe(true)
    expect(store.currentProject.connections[0]!.route).toEqual(maximum)
    expect(validateProjectSchema(store.currentProject).valid).toBe(true)
  })

  it('accepts a single-layer route without interior anchors', () => {
    const store = setup()
    expect(store.connectFromBus('L', 'demo-qf03', 0, 'top', { points: [], segmentLayers: ['rear'] })).toBe(true)
    expect(validateProjectSchema(store.currentProject).valid).toBe(true)
  })

  it('detaches nested caller-owned points and layers on creation and route edits', () => {
    const store = setup()
    const supplied = route()
    expect(store.connectOnBoard('demo-qf01', 'L', 'demo-qf03', 0, { route: supplied })).toBe(true)
    expect(store.connectFromBus('L', 'demo-qf02', 0, 'top', supplied)).toBe(true)
    supplied.points[0]!.x = 999
    supplied.segmentLayers[1] = 'front'
    supplied.points.push({ x: 4, y: 5 })
    expect(store.currentProject.connections.map((wire) => wire.route)).toEqual([route(), route()])

    const edited: NonNullable<Connection['route']> = { points: [{ x: 10, y: 20 }], segmentLayers: ['rear', 'front'] }
    expect(store.updateConnection(store.currentProject.connections[0]!.id, { route: edited })).toBe(true)
    const beforeMutation = snapshot(store)
    edited.points[0]!.y = 999
    edited.segmentLayers[0] = 'front'
    edited.points.length = 0
    expect(snapshot(store)).toBe(beforeMutation)
    store.undo()
    expect(store.currentProject.connections.map((wire) => wire.route)).toEqual([route(), route()])
  })

  it.each([
    ['NaN coordinate', { points: [{ x: Number.NaN, y: 0 }], segmentLayers: ['front', 'rear'] }],
    ['infinite coordinate', { points: [{ x: 0, y: Number.POSITIVE_INFINITY }], segmentLayers: ['front', 'rear'] }],
    ['negative coordinate', { points: [{ x: 1, y: -0.1 }], segmentLayers: ['front', 'rear'] }],
    ['coordinate outside limit', { points: [{ x: 10000.1, y: 1 }], segmentLayers: ['front', 'rear'] }],
    ['too many anchors', { points: Array.from({ length: 129 }, () => ({ x: 1, y: 1 })), segmentLayers: Array.from({ length: 130 }, () => 'front') }],
    ['missing segment layer', { points: [{ x: 1, y: 1 }], segmentLayers: ['front'] }],
    ['extra segment layer', { points: [], segmentLayers: ['front', 'rear'] }],
    ['unknown segment layer', { points: [], segmentLayers: ['inside'] }],
    ['sparse segment layers', { points: [{ x: 1, y: 1 }], segmentLayers: Array(2) }],
  ])('rejects %s in updates and imports without mutating project/history', (_name, invalid) => {
    const store = setup()
    expect(store.connectFromBus('L', 'demo-qf03', 0, 'top', route())).toBe(true)
    const wireId = store.currentProject.connections[0]!.id
    const before = snapshot(store)
    const undoCount = store.undoStack.length
    expect(store.updateConnection(wireId, { route: invalid as Connection['route'] })).toBe(false)
    expect(snapshot(store)).toBe(before)
    expect(store.undoStack).toHaveLength(undoCount)
    const invalidProject = JSON.parse(before)
    invalidProject.connections[0].route = invalid
    expect(validateProjectSchema(invalidProject).valid).toBe(false)
    expect(() => store.importProject(invalidProject)).toThrow()
    expect(snapshot(store)).toBe(before)
    expect(() => store.importProject({ ...invalidProject, schemaVersion: 1 })).toThrow()
    expect(snapshot(store)).toBe(before)
  })

  it('refuses malformed route creation through both drawing APIs without adding a wire', () => {
    const store = setup()
    const invalid = { points: [{ x: 12, y: 24 }], segmentLayers: [] } as Connection['route']
    const before = snapshot(store)
    const undoCount = store.undoStack.length
    expect(store.connectOnBoard('demo-qf01', 'L', 'demo-qf03', 0, { route: invalid })).toBe(false)
    expect(store.connectFromBus('L', 'demo-qf03', 0, 'top', invalid)).toBe(false)
    expect(snapshot(store)).toBe(before)
    expect(store.undoStack).toHaveLength(undoCount)
  })
})
