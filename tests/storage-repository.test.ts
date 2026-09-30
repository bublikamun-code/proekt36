import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { PROJECT_SCHEMA_VERSION } from '../src/domain/projectSchema'
import { CURRENT_PROJECT_KEY, LEGACY_MODELS_KEY, LEGACY_PROJECTS_KEY, MODELS_BACKUP_KEY, MODELS_KEY, PROJECTS_BACKUP_KEY, PROJECTS_KEY, RECOVERY_KEY, WorkspaceRepository } from '../src/storage/projectRepository'

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

const project = (name: string) => createProject(name, 'demo')
const emptyLibrary = { assets: [], products: [], bindings: {} }

describe('workspace repository', () => {
  it('migrates legacy projects and keeps a valid backup without overwriting a damaged primary', () => {
    const storage = new MemoryStorage()
    const legacy = { name: 'Старый щит', preset: 'house', settings: { inputCurrent: 63, phase: 3, rows: 8, reserveModules: 4, enclosureWidth: 600, enclosureHeight: 600, enclosureDepth: 100 }, devices: [], circuits: [], connections: [] }
    const valid = project('Резервная копия')
    storage.set(PROJECTS_KEY, [{ schemaVersion: 2, id: 'broken' }])
    storage.set(PROJECTS_BACKUP_KEY, [valid])
    storage.setRaw(CURRENT_PROJECT_KEY, valid.id)

    const repository = new WorkspaceRepository(storage)
    const result = repository.load([project('Fallback')])

    expect(result.projects).toEqual([valid])
    expect(result.currentProjectId).toBe(valid.id)
    expect(result.recovery[0]?.sourceKey).toBe(PROJECTS_KEY)
    expect(result.recovery[0]?.preserved).toBe(true)
    expect(JSON.parse(storage.raw(RECOVERY_KEY)!).records[0].raw).toBe('[{"schemaVersion":2,"id":"broken"}]')

    repository.save({ projects: [valid], models: emptyLibrary, currentProjectId: valid.id })
    expect(repository.recoveryData[0]?.sourceKey).toBe(PROJECTS_KEY)
    expect(JSON.parse(storage.raw(PROJECTS_KEY)!)).toEqual([valid])
    expect(JSON.parse(storage.raw(PROJECTS_BACKUP_KEY)!)).toEqual([valid])

    const legacyRepository = new WorkspaceRepository(storage)
    storage.set(PROJECTS_KEY, null as never)
    storage.set(PROJECTS_BACKUP_KEY, null as never)
    storage.set(LEGACY_PROJECTS_KEY, [legacy])
    const legacyResult = legacyRepository.load([project('Fallback')])
    expect(legacyResult.projects[0]).toMatchObject({ name: 'Старый щит', schemaVersion: PROJECT_SCHEMA_VERSION })
  })

  it('refuses to repair a damaged record found in the current storage key', () => {
    const storage = new MemoryStorage()
    const healthy = project('Рабочая панель')
    // A record in panel36.projects.v3 that is not current-schema was never written by this
    // build, so it is damage. Migrating it used to hand the user an empty project with a
    // fresh id and a new timestamp — the original content simply gone.
    storage.set(PROJECTS_KEY, [{ schemaVersion: 1, id: 'legacy-lookalike', name: 'Потеряется', devices: [{ instanceId: 'a', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0 }] }, healthy])
    storage.set(PROJECTS_BACKUP_KEY, [healthy])

    const repository = new WorkspaceRepository(storage)
    const result = repository.load([project('Fallback')])

    // One damaged record takes the list with it rather than being dropped on its own, and
    // the whole raw text is kept so the user can get their bytes back.
    expect(result.projects.map((item) => item.id)).toEqual([healthy.id])
    const preserved = result.recovery.find((item) => item.sourceKey === PROJECTS_KEY)!
    expect(JSON.parse(preserved.raw)[0].name).toBe('Потеряется')
    expect(preserved.reason).toContain('schemaVersion')
    // Nothing re-saved the mangled record over the user's data.
    expect(JSON.parse(storage.raw(PROJECTS_KEY)!)[0].id).toBe('legacy-lookalike')
  })

  it('still migrates a v1 record stored under the legacy key', () => {
    const storage = new MemoryStorage()
    const legacy = { name: 'Старый щит', preset: 'house', devices: [], circuits: [], connections: [] }
    storage.setRaw(LEGACY_PROJECTS_KEY, JSON.stringify([legacy]))

    const result = new WorkspaceRepository(storage).load([project('Fallback')])

    expect(result.projects[0]).toMatchObject({ name: 'Старый щит', schemaVersion: PROJECT_SCHEMA_VERSION })
    expect(result.recovery).toHaveLength(0)
  })

  it('migrates a v2 panel out of the superseded key instead of calling it damage', () => {
    const storage = new MemoryStorage()
    const v2 = project('Щит до шин')
    storage.setRaw('panel36.projects.v2', JSON.stringify([{ ...v2, schemaVersion: 2, busAssemblies: undefined, combs: undefined }]))

    const result = new WorkspaceRepository(storage).load([project('Fallback')])

    expect(result.projects[0]).toMatchObject({ name: 'Щит до шин', schemaVersion: PROJECT_SCHEMA_VERSION })
    expect(result.projects[0]!.busAssemblies).toEqual([
      { id: 'bus-n-bottom', kind: 'N', placement: 'bottom', label: 'N' },
      { id: 'bus-pe-bottom', kind: 'PE', placement: 'bottom', label: 'PE' },
    ])
    expect(result.recovery).toHaveLength(0)
  })

  it('keeps the previous valid snapshot as a backup and reports quota errors', () => {
    const storage = new MemoryStorage()
    const first = project('Первый')
    const second = project('Второй')
    const repository = new WorkspaceRepository(storage)
    repository.save({ projects: [first], models: emptyLibrary, currentProjectId: first.id })
    repository.save({ projects: [second], models: emptyLibrary, currentProjectId: second.id })
    expect(JSON.parse(storage.raw(PROJECTS_BACKUP_KEY)!)[0].id).toBe(first.id)

    storage.failOn = PROJECTS_KEY
    expect(() => repository.save({ projects: [first], models: emptyLibrary, currentProjectId: first.id })).toThrow('quota reached')
    expect(JSON.parse(storage.raw(PROJECTS_KEY)!)[0].id).toBe(second.id)
  })

  it('skips the models key on a project-only save once the library is stored', () => {
    const storage = new MemoryStorage()
    const first = project('Первый')
    const repository = new WorkspaceRepository(storage)
    repository.save({ projects: [first], models: emptyLibrary, currentProjectId: first.id }, { modelsDirty: true })
    expect(storage.raw(MODELS_KEY)).toBe(JSON.stringify(emptyLibrary))

    // An autosave that did not touch the library must not rewrite it — quota failures on the
    // models key would otherwise break saves that never needed it.
    storage.failOn = MODELS_KEY
    expect(() => repository.save({ projects: [first], models: emptyLibrary, currentProjectId: first.id })).not.toThrow()
  })

  it('migrates the legacy model library keeping every id resolvable', () => {
    const storage = new MemoryStorage()
    const legacyModel = {
      id: 'imported-uuid',
      name: 'Мой аппарат',
      brand: 'ABB',
      sku: 'S201-C16',
      category: 'MCB',
      moduleWidth: 1,
      rows: 2,
      height: 85,
      depth: 70,
      poles: 1,
      ratedCurrent: 16,
      voltage: 230,
      bus: 'L',
      price: 0,
      weight: 0.12,
      fileName: 's201.glb',
      fileType: 'glb',
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    storage.set(LEGACY_MODELS_KEY, [legacyModel])

    const result = new WorkspaceRepository(storage).load([project('Fallback')])

    // The asset and the product stub share the pre-split id, so PlacedDevice.productId
    // written before the migration keeps resolving to the stub.
    expect(result.models.assets).toHaveLength(1)
    expect(result.models.assets[0]).toMatchObject({ id: 'imported-uuid', source: 'local', format: 'glb', fileName: 's201.glb' })
    expect(result.models.products).toHaveLength(1)
    expect(result.models.products[0]).toMatchObject({ id: 'imported-uuid', imported: true, modelId: 'imported-uuid', moduleWidth: 1, category: 'MCB' })
    expect(result.recovery).toHaveLength(0)
  })

  it('refuses a v2 library record with broken geometry instead of loading NaN', () => {
    const storage = new MemoryStorage()
    const first = project('Рабочая панель')
    storage.set(PROJECTS_KEY, [first])
    storage.set(MODELS_KEY, {
      assets: [],
      products: [{ id: 'broken', name: 'Сломанный', brand: '', sku: '', category: 'MCB', moduleWidth: 'abc', poles: 1, ratedCurrent: 16, voltage: 230, bus: 'L', price: 0, weight: 0, height: 82, depth: 70, imported: true, modelId: 'broken' }],
      bindings: {},
    })

    const result = new WorkspaceRepository(storage).load([first])

    expect(result.models).toEqual({ assets: [], products: [], bindings: {} })
    expect(result.recovery[0]?.sourceKey).toBe(MODELS_KEY)
  })

  it('falls back to the v2 models backup when the primary record is damaged', () => {
    const storage = new MemoryStorage()
    const asset = { id: 'asset-1', name: 'Ассет', source: 'local', format: 'glb', transform: { scale: 1, rotationY: 0 }, fileName: 'a.glb', createdAt: '2026-09-01T00:00:00.000Z' }
    const product = { id: 'asset-1', name: 'Ассет', brand: '', sku: '', category: 'MCB', moduleWidth: 1, poles: 1, ratedCurrent: 16, voltage: 230, bus: 'L', price: 0, weight: 0, height: 82, depth: 70, imported: true, modelId: 'asset-1' }
    storage.setRaw(MODELS_KEY, 'not json')
    storage.set(MODELS_BACKUP_KEY, { assets: [asset], products: [product], bindings: {} })

    const result = new WorkspaceRepository(storage).load([project('Fallback')])

    expect(result.models.assets.map((item) => item.id)).toEqual(['asset-1'])
    expect(result.models.products.map((item) => item.id)).toEqual(['asset-1'])
    expect(result.recovery[0]?.sourceKey).toBe(MODELS_KEY)
  })
})
