import { describe, expect, it } from 'vitest'
import { createProject } from '../src/domain/project'
import { createProjectFileEnvelope, readProjectFile } from '../src/domain/projectFile'

const project = () => createProject('Импорт', 'apartment', { phase: 1, inputCurrent: 40 })
const jsonFile = (value: unknown, name = 'project.json') => new File([JSON.stringify(value)], name, { type: 'application/json' })

describe('project file import', () => {
  it('reads a raw project payload', async () => {
    const source = project()
    const imported = await readProjectFile(jsonFile(source))

    expect(imported.name).toBe('Импорт')
    expect(imported.devices).toEqual([])
  })

  it('reads the Panel 36 export envelope', async () => {
    const source = project()
    const imported = await readProjectFile(jsonFile({ schema: 'panel36.project.v2', exportedAt: new Date().toISOString(), project: source }))

    expect(imported.id).toBe(source.id)
  })

  it('lists referenced local CAD models without embedding their binaries', () => {
    const source = project()
    source.devices.push({
      instanceId: 'local-device',
      productId: 'local-cad-model',
      row: 0,
      slot: 0,
      address: 'X1',
      quantity: 1,
      phase: 1,
      note: '',
      mount: 'din',
    })

    const envelope = createProjectFileEnvelope(source, '2026-09-24T12:00:00.000Z')

    expect(envelope.cadModelManifest).toEqual({ revision: '1', count: 1, modelIds: ['local-cad-model'] })
    expect(envelope.cad.binaryIncluded).toBe(false)
  })

  it('reports malformed JSON', async () => {
    await expect(readProjectFile(new File(['{broken'], 'broken.json'))).rejects.toThrow('Не удалось прочитать JSON проекта')
  })

  it('rejects files larger than 5 MB before reading them', async () => {
    const oversized = { size: 5 * 1024 * 1024 + 1, text: async () => '{}' } as File
    await expect(readProjectFile(oversized)).rejects.toThrow('Файл проекта больше 5 МБ')
  })
})
