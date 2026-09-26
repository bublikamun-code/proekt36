import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { CURRENT_PROJECT_KEY, LEGACY_PROJECTS_KEY, PROJECTS_BACKUP_KEY, PROJECTS_KEY, RECOVERY_KEY, WorkspaceRepository } from '../src/storage/projectRepository'

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

    repository.save({ projects: [valid], models: [], currentProjectId: valid.id })
    expect(repository.recoveryData[0]?.sourceKey).toBe(PROJECTS_KEY)
    expect(JSON.parse(storage.raw(PROJECTS_KEY)!)).toEqual([valid])
    expect(JSON.parse(storage.raw(PROJECTS_BACKUP_KEY)!)).toEqual([valid])

    const legacyRepository = new WorkspaceRepository(storage)
    storage.set(PROJECTS_KEY, null as never)
    storage.set(PROJECTS_BACKUP_KEY, null as never)
    storage.set(LEGACY_PROJECTS_KEY, [legacy])
    const legacyResult = legacyRepository.load([project('Fallback')])
    expect(legacyResult.projects[0]).toMatchObject({ name: 'Старый щит', schemaVersion: 2 })
  })

  it('refuses to repair a damaged record found in the current storage key', () => {
    const storage = new MemoryStorage()
    const healthy = project('Рабочая панель')
    // A record in panel36.projects.v2 that is not current-schema was never written by this
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

    expect(result.projects[0]).toMatchObject({ name: 'Старый щит', schemaVersion: 2 })
    expect(result.recovery).toHaveLength(0)
  })

  it('keeps the previous valid snapshot as a backup and reports quota errors', () => {
    const storage = new MemoryStorage()
    const first = project('Первый')
    const second = project('Второй')
    const repository = new WorkspaceRepository(storage)
    repository.save({ projects: [first], models: [], currentProjectId: first.id })
    repository.save({ projects: [second], models: [], currentProjectId: second.id })
    expect(JSON.parse(storage.raw(PROJECTS_BACKUP_KEY)!)[0].id).toBe(first.id)

    storage.failOn = PROJECTS_KEY
    expect(() => repository.save({ projects: [first], models: [], currentProjectId: first.id })).toThrow('quota reached')
    expect(JSON.parse(storage.raw(PROJECTS_KEY)!)[0].id).toBe(second.id)
  })
})
