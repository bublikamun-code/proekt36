import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { createWorkspaceBackup, describeBackupRestore, readWorkspaceBackup, type RestoredWorkspaceBackup } from '../src/domain/projectBackup'
import { modelWord } from '../src/domain/plural'

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

describe('описание восстановления', () => {
  const backup = (pendingLocalCad: string[]): RestoredWorkspaceBackup => ({
    projects: [createProject('Щиток', 'apartment')],
    currentProjectId: null,
    pendingLocalCad,
  })

  it('архив говорит, что модель вернётся, а не что её нет в копии', () => {
    // This is the regression: the archive carries the geometry, and the dialog used to claim the
    // files "не входят" anyway — which was both wrong and unreachable in the other direction.
    const text = describeBackupRestore(backup(['model-1']), ['model-1'])
    expect(text).toContain('Архив вернёт 1 модель в локальную библиотеку')
    expect(text).not.toContain('файлы которых в копию не входят')
  })

  it('модели без архива остаются предметом предупреждения', () => {
    const text = describeBackupRestore(backup(['model-1', 'model-2', 'model-3', 'model-4', 'model-5']), [])
    expect(text).toContain('5 позиций опираются')
    expect(text).toContain('файлы которых в копию не входят')
    // A long list is cut down, so the dialog cannot grow past its own width.
    expect(text).toContain('и ещё 2')
    expect(text).not.toContain('Архив вернёт')
  })

  it('частичное совпадение: вернутся три, не вернутся две', () => {
    const text = describeBackupRestore(backup(['model-1', 'model-2', 'model-3', 'model-4', 'model-5']), ['model-1', 'model-2', 'model-3'])
    expect(text).toContain('Архив вернёт 3 модели')
    expect(text).toContain('2 позиций опираются')
    expect(text).toContain('model-4')
    expect(text).not.toContain('model-1,')
  })

  it('копия без зависимостей не добавляет ничего лишнего', () => {
    const text = describeBackupRestore(backup([]), [])
    expect(text).toBe('Копия содержит 1 проект. Текущий список проектов будет заменён; локальная библиотека CAD-моделей останется доступна.')
  })
})

describe('русские числительные', () => {
  it('склоняет «модель» так же, как «проект»', () => {
    // A count next to the noun is the one place where a wrong form is impossible to miss in a
    // printed report or a dialog, so both words share the same rules.
    expect(modelWord(1)).toBe('модель')
    expect(modelWord(2)).toBe('модели')
    expect(modelWord(5)).toBe('моделей')
    expect(modelWord(11)).toBe('моделей')
    expect(modelWord(12)).toBe('моделей')
    expect(modelWord(14)).toBe('моделей')
    expect(modelWord(21)).toBe('модель')
    expect(modelWord(22)).toBe('модели')
    expect(modelWord(25)).toBe('моделей')
    expect(modelWord(101)).toBe('модель')
    expect(modelWord(0)).toBe('моделей')
  })
})
