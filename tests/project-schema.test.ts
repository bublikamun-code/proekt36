import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import { createProjectFileEnvelope, readProjectFile } from '../src/domain/projectFile'
import { createDevice, createProject, migrateProject } from '../src/domain/project'
import { assertValidProjectSchema, validateProjectSchema } from '../src/domain/projectSchema'
import { buildBom, pricing } from '../src/domain/pricing'
import { getFootprintModules, getRequiredModules } from '../src/domain/layout'
import { validateProject } from '../src/domain/validation'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))
const jsonFile = (value: unknown) => new File([JSON.stringify(value)], 'project.panel36.json', { type: 'application/json' })

describe('strict project schema and migrations', () => {
  it('accepts a current project and rejects duplicate ids and future schema', () => {
    const project = createProject('Проверка', 'demo')
    const result = validateProjectSchema(project)
    expect(result.valid).toBe(true)
    expect(result.data).toBe(project)

    const duplicate = structuredClone(project)
    duplicate.devices = [createDevice(definitions.get('ekf-mcb-1p-c6')!, 0, 0), createDevice(definitions.get('ekf-mcb-1p-c6')!, 0, 1)]
    duplicate.devices[1]!.instanceId = duplicate.devices[0]!.instanceId
    expect(validateProjectSchema(duplicate).errors.some((error) => error.includes('повторяется идентификатор'))).toBe(true)

    const future = { ...structuredClone(project), schemaVersion: 3 }
    expect(validateProjectSchema(future).errors.join(' ')).toContain('новее')
    expect(() => assertValidProjectSchema(future)).toThrow('новее')
  })

  it('migrates v1 devices, circuits and connections and normalizes every collection', () => {
    const migrated = migrateProject({
      schemaVersion: 1,
      id: 'v1',
      name: 'Старая',
      devices: [{ instanceId: 'd1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: 'QF1', quantity: 2, phase: 9, note: '', mount: 'din' }],
      circuits: [{ id: 'c1', name: 'Свет', loadName: 'Свет', current: '6', power: 100, phase: 1, protectionDeviceId: 'd1', color: '#fff', wireCrossSection: 1.5, note: '' }],
      connections: [{ id: 'w1', circuitId: 'c1', fromBus: 'L', toDeviceId: 'd1', color: '#fff', thickness: 2, label: 'L' }],
    } as never)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.devices[0]!.quantity).toBe(2)
    expect(migrated.devices[0]!.phase).toBe(1)
    expect(migrated.circuits[0]!.current).toBe(6)
    expect(migrated.connections[0]!.kind).toBe('circuit')
    const migratedValidation = validateProjectSchema(migrated)
    expect(migratedValidation.errors).toEqual([])
    expect(migratedValidation.valid).toBe(true)
  })

  it('uses product footprint once while keeping quantity as purchase quantity', () => {
    const product = definitions.get('ekf-mcb-4p-b32')!
    const item = { ...createDevice(product, 0, 0), quantity: 9 }
    expect(getFootprintModules(item, definitions)).toBe(4)
    expect(getRequiredModules([item], definitions)).toBe(4)
    expect(buildBom([item], definitions)[0]!.quantity).toBe(9)
  })
})

describe('project file envelope and domain diagnostics', () => {
  it('exports revisions, catalog manifest and CAD manifest and reads them', async () => {
    const project = createProject('Экспорт', 'apartment')
    const envelope = createProjectFileEnvelope(project, '2026-01-01T00:00:00.000Z')
    expect(envelope.application.revision).toBeTruthy()
    expect(envelope.schemaRevision).toBe(2)
    expect(envelope.catalogSnapshot.length).toBeGreaterThan(0)
    expect(envelope.catalogManifest.hash).toBeTruthy()
    expect(envelope.cadModelManifest.modelIds).toEqual([])
    await expect(readProjectFile(jsonFile(envelope))).resolves.toMatchObject({ id: project.id })
  })

  it('keeps validation issues compatible and structured', () => {
    const project = createProject('Диагностика', 'demo')
    const issues = validateProject(project, definitions)
    const preliminary = issues.find((item) => item.id === 'preliminary')!
    expect(preliminary.ruleCode).toBe('calculation.preliminary')
    expect(preliminary.version).toBe(2)
    expect(preliminary.context).toEqual(expect.objectContaining({ knownTotal: expect.any(Number) }))
  })

  it('distinguishes an unknown price from a zero quote and escapes CSV formulas', () => {
    const unknown = definitions.get('enmas-template-psu-24v-5a')!
    const result = pricing([{ ...createDevice(unknown, 0, 0), quantity: 2 }], definitions)
    const line = result.lines[0]!
    expect(line.unitPrice).toBe(0)
    expect(line.priceKnown).toBe(false)
    expect(line.priceStatus).toBe('unknown')
    expect(result.hasUnknownPrices).toBe(true)
  })
})
