import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { createWorkspaceBackup, readWorkspaceBackup } from '../src/domain/projectBackup'

const jsonFile = (value: unknown) => new File([JSON.stringify(value)], 'panel36-backup.json', { type: 'application/json' })

describe('workspace backup', () => {
  it('round-trips built-in projects and the selected project', async () => {
    const first = createProject('Квартира', 'apartment', { phase: 1, inputCurrent: 40 })
    const second = createProject('Дом', 'house', { phase: 3, inputCurrent: 63 })
    const backup = createWorkspaceBackup([first, second], [], second.id, '2026-09-24T12:00:00.000Z')

    const restored = await readWorkspaceBackup(jsonFile(backup))

    expect(restored.projects.map((project) => project.id)).toEqual([first.id, second.id])
    expect(restored.currentProjectId).toBe(second.id)
    expect(restored.projects).toEqual(backup.projects)
  })

  it('restores a project that needs a local CAD model and names the missing product', async () => {
    const project = createProject('Модель', 'apartment', { phase: 1, inputCurrent: 40 })
    project.devices.push({
      instanceId: 'custom-device',
      productId: 'local-model',
      row: 0,
      slot: 0,
      address: 'X1',
      quantity: 1,
      phase: 1,
      note: '',
      mount: 'din',
    })
    const backup = createWorkspaceBackup([project], [], project.id)

    // The archive carries no CAD binaries, but the editor draws an unknown product as a
    // labelled placeholder, so refusing the whole file would strand the user's other work.
    const restored = await readWorkspaceBackup(jsonFile(backup))
    expect(restored.projects).toHaveLength(1)
    expect(restored.pendingLocalCad).toEqual(['local-model'])
  })

  it('reports no pending CAD for a project built from the catalogue', async () => {
    const project = createProject('Квартира', 'apartment', { phase: 1, inputCurrent: 40 })
    const backup = createWorkspaceBackup([project], [], project.id)
    expect((await readWorkspaceBackup(jsonFile(backup))).pendingLocalCad).toEqual([])
  })

  it('rejects an unreadable application or catalog revision', async () => {
    const project = createProject('Квартира', 'apartment', { phase: 1, inputCurrent: 40 })
    const backup = createWorkspaceBackup([project], [], project.id)

    await expect(readWorkspaceBackup(jsonFile({ ...backup, application: { name: 'Panel36', revision: 'other' } }))).rejects.toThrow('другой версией')
    await expect(readWorkspaceBackup(jsonFile({ ...backup, catalogRevision: 'other' }))).rejects.toThrow('другой ревизии каталога')
  })

  it('accepts an older release but refuses a newer one', async () => {
    const project = createProject('Квартира', 'apartment', { phase: 1, inputCurrent: 40 })
    const backup = createWorkspaceBackup([project], [], project.id)

    // Every catalogue change bumps CATALOG_REVISION, so demanding equality would make
    // yesterday's backup permanently unreadable — the one moment the user needs it.
    const older = await readWorkspaceBackup(jsonFile({ ...backup, catalogRevision: '2020-01-01.1', application: { name: 'Panel36', revision: '0.0.9' } }))
    expect(older.projects.map((item) => item.id)).toEqual([project.id])

    await expect(readWorkspaceBackup(jsonFile({ ...backup, catalogRevision: '2999-01-01.1' }))).rejects.toThrow('более новой ревизии каталога')
    await expect(readWorkspaceBackup(jsonFile({ ...backup, application: { name: 'Panel36', revision: '9.0.0' } }))).rejects.toThrow('более новой версией приложения')
  })
})
