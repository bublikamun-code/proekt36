import { describe, expect, it } from 'vitest'
import { createProject, migrateProject, migrateProjectList, PROJECT_SCHEMA_VERSION } from '../src/domain/project'
import type { PanelProject } from '../src/domain/types'

describe('project schema migration', () => {
  it('creates projects with the current schema and compatible catalog layout', () => {
    const project = createProject('Новая панель', 'apartment', { rows: 5 })

    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(project.circuits).toEqual([])
    expect(project.connections).toEqual([])
    expect(project.settings.rows).toBe(2)
    expect(project.settings.cabinetId).toBe('enmas-nx8-24-embedded')
    expect(project.settings.railId).toBe('rail-12')
  })

  it('migrates a legacy project without circuits, connections or schema version', () => {
    const legacy = {
      id: 'legacy-project',
      name: 'Старая панель',
      preset: 'house',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      settings: { inputCurrent: 0, phase: 3, rows: 99, reserveModules: -5 },
      devices: [{ instanceId: 'device-1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: 'QF01', quantity: 1, phase: 1, note: '' }],
    }

    const migrated = migrateProject(legacy as Partial<PanelProject>)

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated.id).toBe('legacy-project')
    expect(migrated.name).toBe('Старая панель')
    expect(migrated.settings.inputCurrent).toBe(1)
    expect(migrated.settings.phase).toBe(3)
    expect(migrated.settings.rows).toBe(30)
    expect(migrated.settings.reserveModules).toBe(0)
    expect(migrated.devices).toHaveLength(1)
    expect(migrated.circuits).toEqual([])
    expect(migrated.connections).toEqual([])
  })

  it('normalizes a stored project list and rejects an invalid payload', () => {
    const legacy = [{ name: 'Импорт', devices: [] }]
    const migrated = migrateProjectList(legacy)

    expect(migrated).toHaveLength(1)
    expect(migrated[0]?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated[0]?.name).toBe('Импорт')
    expect(migrateProjectList({ old: true })).toEqual([])
    expect(migrateProjectList([])).toEqual([])
  })
})
