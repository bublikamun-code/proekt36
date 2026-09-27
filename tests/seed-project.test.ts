import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '../src/stores/project'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('seed project placement', () => {
  it('places all nine demo devices on the apartment cabinet', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
    Object.defineProperty(globalThis, 'document', { value: { documentElement: { dataset: {} } }, configurable: true })
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true })
    setActivePinia(createPinia())
    const store = useProjectStore()
    const project = store.projects.find((item) => item.id === 'sample-apartment')!
    expect(project.devices).toHaveLength(9)
    expect(project.settings.cabinetId).toBe('enmas-nx8-24-embedded')
    expect(project.settings.rows).toBe(2)
    const row0 = project.devices.filter((item) => item.row === 0)
    const row1 = project.devices.filter((item) => item.row === 1)
    expect(row0).toHaveLength(3)
    expect(row1).toHaveLength(6)
  })
})
