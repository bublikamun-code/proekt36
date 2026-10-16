import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { allCatalog } from '../src/data/catalog'
import { useProjectStore } from '../src/stores/project'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const setupStore = () => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
  Object.defineProperty(globalThis, 'document', { value: { documentElement: { dataset: {} } }, configurable: true })
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true })
  setActivePinia(createPinia())
  const store = useProjectStore()
  // The store notifies through the UI on rejections; silence it for assertions on state.
  vi.spyOn(store, 'notify').mockImplementation(() => store.notify)
  return store
}

describe('preset product seeding', () => {
  it('never seeds a template entry', () => {
    const store = setupStore()
    for (const preset of ['apartment', 'house', 'workshop', 'lighting', 'demo']) {
      store.newProject(`Пресет ${preset}`, preset)
      store.applyPreset(preset)
      const placed = store.currentProject.devices
      expect(placed.length).toBeGreaterThan(0)
      for (const device of placed) {
        const product = store.definitions.get(device.productId)
        expect(product?.verificationStatus).not.toBe('template')
        expect(product?.imported).not.toBe(true)
      }
    }
  })

  it('picks the first eligible product of a category, not the last', () => {
    const store = setupStore()
    store.newProject('Квартира', 'apartment')
    store.applyPreset('apartment')
    const firstVerified = allCatalog.find((product) =>
      product.category === 'MCB' && !product.imported && product.verificationStatus !== 'template')!
    const placed = store.currentProject.devices
    const mcb = placed.find((device) => store.definitions.get(device.productId)?.category === 'MCB')
    expect(mcb?.productId).toBe(firstVerified.id)
  })
})
