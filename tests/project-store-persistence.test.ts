import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createProject } from '../src/domain/project'
import { CURRENT_PROJECT_KEY } from '../src/storage/projectRepository'
import { PERSIST_DELAY_MS, useProjectStore } from '../src/stores/project'
import { getRowCapacity, getRowUsage } from '../src/domain/layout'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  failOn: string | null = null
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.failOn === key) {
      const error = new Error('quota reached')
      error.name = 'QuotaExceededError'
      throw error
    }
    this.values.set(key, value)
  }
  removeItem(key: string) { this.values.delete(key) }
  set(key: string, value: unknown) { this.values.set(key, JSON.stringify(value)) }
  setRaw(key: string, value: string) { this.values.set(key, value) }
  raw(key: string) { return this.values.get(key) ?? null }
}

const setupBrowserStorage = (storage: MemoryStorage) => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: { documentElement: { dataset: {} } }, configurable: true })
}

/** The suite runs in the node environment, so window events need a stand-in. */
const setupPageLifecycle = () => {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const windowStub = {
    addEventListener(type: string, handler: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    removeEventListener(type: string, handler: (event: Event) => void) {
      listeners.get(type)?.delete(handler)
    },
    dispatch(type: string) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler({ type } as Event)
    },
  }
  Object.defineProperty(globalThis, 'window', { value: windowStub, configurable: true })
  return windowStub
}

afterEach(() => {
  vi.useRealTimers()
})

describe('project store persistence and history', () => {
  it('keeps undo and redo history scoped to each project and persists the current id', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const first = createProject('Первый')
    const second = createProject('Второй')
    storage.set('panel36.projects.v2', [first, second])
    storage.setRaw(CURRENT_PROJECT_KEY, second.id)
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()

    expect(store.currentProjectId).toBe(second.id)
    const secondOriginal = store.currentProject.settings.reserveModules
    const firstOriginal = first.settings.reserveModules
    store.updateSettings({ reserveModules: secondOriginal + 1 })
    expect(store.undoStack).toHaveLength(1)
    store.switchProject(first.id)
    expect(store.undoStack).toHaveLength(0)
    store.updateSettings({ reserveModules: firstOriginal + 1 })
    expect(store.undoStack).toHaveLength(1)
    store.switchProject(second.id)
    expect(store.undoStack).toHaveLength(1)
    store.undo()
    expect(store.currentProject.settings.reserveModules).toBe(secondOriginal)
    store.switchProject(first.id)
    store.undo()
    expect(store.currentProject.settings.reserveModules).toBe(firstOriginal)

    store.switchProject(second.id)
    await nextTick()
    expect(storage.raw(CURRENT_PROJECT_KEY)).toBe(second.id)
    await store.flushPersistence()
    expect(store.storageStatus).toBe('saved')
    store.$dispose()
  })

  it('debounces writes and keeps a failed write visible instead of claiming saved', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    storage.failOn = 'panel36.projects.v2'
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()
    store.updateSettings({ reserveModules: store.currentProject.settings.reserveModules + 1 })
    await nextTick()
    expect(store.storageStatus).toBe('saving')
    await vi.advanceTimersByTimeAsync(449)
    expect(storage.raw('panel36.projects.v2')).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(store.storageStatus).toBe('save-failed')
    expect(store.storageError).toContain('переполнено')
    expect(storage.raw('panel36.projects.v2')).toBeNull()
    store.$dispose()
  })

  it('flushes the debounced write when the page is hidden before the timer fires', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const lifecycle = setupPageLifecycle()
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()
    const reserve = store.currentProject.settings.reserveModules

    store.updateSettings({ reserveModules: reserve + 3 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS - 1)
    // Still inside the debounce window, so nothing has been written yet. Deriving the step from
    // the constant keeps this true whatever the delay is tuned to, rather than restating 450 here.
    expect(storage.raw('panel36.projects.v2')).toBeNull()

    lifecycle.dispatch('pagehide')
    expect(JSON.parse(storage.raw('panel36.projects.v2')!)[0].settings.reserveModules).toBe(reserve + 3)
    expect(store.storageStatus).toBe('saved')
    store.$dispose()
  })
})

describe('busbar wiring on insert', () => {
  const panel = () => {
    const project = createProject('Шины')
    project.devices = [
      { instanceId: 'bus-1', productId: 'enmas-fork-4p-63a', row: 0, slot: 0, address: 'FORK1', quantity: 1, phase: 1, marking: '', note: '', mount: 'busbar' },
      { instanceId: 'mcb-1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: 'QF1', quantity: 1, phase: 1, marking: '', note: '', mount: 'din' },
      { instanceId: 'mcb-2', productId: 'iek-mcb-1p-c10', row: 0, slot: 2, address: 'QF2', quantity: 1, phase: 1, marking: '', note: '', mount: 'din' },
    ]
    return project
  }

  it('places an apparatus without inferring a physical FORK connection', () => {
    const storage = new MemoryStorage()
    storage.set('panel36.projects.v2', [panel()])
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()

    expect(store.currentProject.connections).toEqual([])
    store.addDevice('ekf-mcb-1p-b16', 0, 4)

    const added = store.currentProject.devices.find((item) => item.productId === 'ekf-mcb-1p-b16')
    const links = store.currentProject.connections
    expect(added).toBeDefined()
    expect(links).toHaveLength(0)
    expect(links.map((item) => item.toDeviceId)).not.toContain('mcb-1')
    expect(links.map((item) => item.toDeviceId)).not.toContain('mcb-2')
    store.$dispose()
  })

  it('folds a run of arrow-key nudges into one undo step that returns to where the gesture began', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const project = createProject('Ряд')
    project.devices = [0, 1, 2].map((slot) => ({
      instanceId: `mcb-${slot}`, productId: 'ekf-mcb-1p-c6', row: 0, slot, address: `QF${slot + 1}`,
      quantity: 1, phase: 1, marking: '', note: '', mount: 'din' as const,
    }))
    storage.set('panel36.projects.v2', [project])
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()
    const slotOf = (id: string) => store.currentProject.devices.find((item) => item.instanceId === id)?.slot

    store.selectedDeviceId = 'mcb-2'
    store.nudgeSelectedDevice(0, -1)
    vi.advanceTimersByTime(120)
    store.nudgeSelectedDevice(0, -1)
    expect(slotOf('mcb-2')).toBe(0)
    expect(store.undoStack).toHaveLength(1)

    // One undo has to undo the whole gesture, not just its last step.
    store.undo()
    expect(slotOf('mcb-2')).toBe(2)
    expect(slotOf('mcb-0')).toBe(0)
    expect(store.undoStack).toHaveLength(0)
    store.$dispose()
  })

  it('starts a new undo step once the nudge run has gone stale', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const project = createProject('Ряд')
    project.devices = [0, 1, 2].map((slot) => ({
      instanceId: `mcb-${slot}`, productId: 'ekf-mcb-1p-c6', row: 0, slot, address: `QF${slot + 1}`,
      quantity: 1, phase: 1, marking: '', note: '', mount: 'din' as const,
    }))
    storage.set('panel36.projects.v2', [project])
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()
    const slotOf = (id: string) => store.currentProject.devices.find((item) => item.instanceId === id)?.slot

    store.selectedDeviceId = 'mcb-2'
    store.nudgeSelectedDevice(0, -1)
    vi.advanceTimersByTime(900)
    store.nudgeSelectedDevice(0, -1)

    expect(store.undoStack).toHaveLength(2)
    store.undo()
    expect(slotOf('mcb-2')).toBe(1)
    store.$dispose()
  })

  it('undoes placement beside a busbar in a single step', () => {
    const storage = new MemoryStorage()
    storage.set('panel36.projects.v2', [panel()])
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()

    store.addDevice('ekf-mcb-1p-b16', 0, 4)
    expect(store.undoStack).toHaveLength(1)
    store.undo()

    expect(store.currentProject.devices).toHaveLength(3)
    expect(store.currentProject.connections).toEqual([])
    store.$dispose()
  })

  it('does not wire a non-protection device to the busbar', () => {
    const storage = new MemoryStorage()
    storage.set('panel36.projects.v2', [panel()])
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    const store = useProjectStore()

    store.addDevice('shk', 0, 5)

    expect(store.currentProject.connections).toEqual([])
    store.$dispose()
  })
})

/**
 * A click in the catalogue names no position, so the store looks down the rows for the first one
 * that will take the device. This was found while porting the panels to the new board: with row 1
 * full and row 2 half empty, every click failed with «не хватает места в ряду».
 */
describe('размещение по клику', () => {
  const freshStore = () => {
    const storage = new MemoryStorage()
    setupBrowserStorage(storage)
    setActivePinia(createPinia())
    return useProjectStore()
  }

  // One module wide, so a slot count and a module count are the same thing here.
  const PRODUCT = 'ekf-mcb-1p-b16'
  const fillRow = (store: ReturnType<typeof useProjectStore>, row: number) => {
    for (let slot = 0; slot < getRowCapacity(store.currentProject); slot += 1) {
      store.addDevice(PRODUCT, row, slot)
    }
    return PRODUCT
  }

  it('находит свободный ряд ниже заполненного', () => {
    const store = freshStore()
    store.newProject('Ряды', 'apartment')
    const productId = fillRow(store, 0)
    expect(getRowUsage(0, store.currentProject, store.definitions).used).toBe(getRowCapacity(store.currentProject))

    store.addDevice(productId)
    expect(store.toast?.tone).toBe('ok')
    expect(store.currentProject.devices.some((device) => device.row === 1)).toBe(true)
    store.$dispose()
  })

  it('не ищет другой ряд, когда позиция указана явно', () => {
    const store = freshStore()
    store.newProject('Ряды', 'apartment')
    const productId = fillRow(store, 0)

    const before = store.currentProject.devices.length
    store.addDevice(productId, 0, 0)
    // A drop lands where it was dropped or not at all, even when the row below has plenty of room.
    expect(store.currentProject.devices).toHaveLength(before)
    expect(store.toast?.tone).toBe('error')
    expect(store.toast?.text).toContain('места')
    store.$dispose()
  })
})
