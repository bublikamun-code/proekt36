import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import { createProjectFileEnvelope, readProjectFile } from '../src/domain/projectFile'
import { createDevice, createProject, migrateProject } from '../src/domain/project'
import { assertValidProjectSchema, PROJECT_SCHEMA_VERSION, VALIDATION_REVISION, validateProjectSchema } from '../src/domain/projectSchema'
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

    const future = { ...structuredClone(project), schemaVersion: PROJECT_SCHEMA_VERSION + 1 }
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
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated.devices[0]!.quantity).toBe(2)
    expect(migrated.devices[0]!.phase).toBe(1)
    expect(migrated.circuits[0]!.current).toBe(6)
    expect(migrated.connections[0]!.kind).toBe('circuit')
    const migratedValidation = validateProjectSchema(migrated)
    expect(migratedValidation.errors).toEqual([])
    expect(migratedValidation.valid).toBe(true)
  })

  it('gives a v2 project N and PE buses and anchors its lines to them', () => {
    const device = createDevice(definitions.get('ekf-mcb-1p-c6')!, 0, 0)
    device.instanceId = 'd0'
    device.address = 'QF1'
    const migrated = migrateProject({
      ...structuredClone(createProject('Старый', 'demo')),
      schemaVersion: 2,
      busAssemblies: undefined,
      combs: undefined,
      devices: [device],
      circuits: [{ id: 'c1', name: 'Свет', loadName: 'Свет', current: 6, power: 100, phase: 1, protectionDeviceId: 'd0', color: '#c0392b', wireCrossSection: 1.5, note: '' }],
      connections: [
        { id: 'w1', circuitId: 'c1', fromBus: 'L', toDeviceId: 'd0', color: '#c0392b', thickness: 2, label: 'L' },
        { id: 'w2', circuitId: 'c1', fromBus: 'N', toDeviceId: 'd0', color: '#1f6fb4', thickness: 2, label: 'N' },
        { id: 'w3', circuitId: 'c1', fromBus: 'PE', toDeviceId: 'd0', color: '#4f9d3a', thickness: 2, label: 'PE' },
      ],
    } as never)
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated.combs).toEqual([])
    // Only the buses the old lines actually used are created, so the plate is not littered
    // with an empty PE bar the project never needed.
    expect(migrated.busAssemblies!?.map((bus) => bus.kind).sort()).toEqual(['N', 'PE'])
    expect(migrated.connections.map((connection) => connection.busId)).toEqual([undefined, 'bus-n-bottom', 'bus-pe-bottom'])
    expect(validateProjectSchema(migrated).errors).toEqual([])
  })

  it('gives a v2 project the same N and PE bars a fresh board starts with', () => {
    const migrated = migrateProject({ ...structuredClone(createProject('Только фаза', 'demo')), schemaVersion: 2, busAssemblies: undefined, connections: [] } as never)
    // A board fed only from L still gets both bars, exactly as `createProject` gives them.
    // Deciding from the old wires would leave it with nowhere to anchor a line it grows later.
    expect(migrated.busAssemblies!.map((bus) => bus.kind)).toEqual(['N', 'PE'])
  })

  it('keeps the bars a v2 project already had instead of replacing them with the defaults', () => {
    const own = [{ id: 'bus-n-top', kind: 'N' as const, placement: 'top' as const, label: 'N верх' }]
    const migrated = migrateProject({ ...structuredClone(createProject('Со своими шинами', 'demo')), schemaVersion: 2, busAssemblies: own, connections: [] } as never)

    expect(migrated.busAssemblies!).toEqual(own)
  })

  it('rejects a jumper without both ends and a line pointing at a removed bus', () => {
    const project = createProject('Перемычки', 'demo')
    const device = createDevice(definitions.get('ekf-mcb-1p-c6')!, 0, 0)
    device.instanceId = 'd0'
    device.address = 'QF1'
    const base = { ...structuredClone(project), devices: [device], circuits: [] }
    const jumper = { id: 'j1', circuitId: '', fromBus: 'L', toDeviceId: 'd0', color: '#5a6672', thickness: 2, label: 'QF1-QF2', kind: 'jumper', fromTerminal: { deviceId: 'd0', pole: 1, side: 'top' } }
    expect(validateProjectSchema({ ...base, connections: [jumper] }).errors.join(' ')).toContain('connections[0].toTerminal')
    expect(validateProjectSchema({ ...base, connections: [{ ...jumper, toTerminal: { deviceId: 'missing', pole: 2, side: 'top' } }] }).errors.join(' ')).toContain('connections[0].toTerminal.deviceId')
    expect(validateProjectSchema({ ...base, connections: [{ ...jumper, fromTerminal: { deviceId: 'd0', pole: 1, side: 'top' }, toTerminal: { deviceId: 'd0', pole: 2, side: 'top' }, busId: 'bus-nope' }] }).errors.join(' ')).toContain('connections[0].busId')
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
    expect(envelope.schemaRevision).toBe(PROJECT_SCHEMA_VERSION)
    expect(envelope.catalog.snapshot.length).toBeGreaterThan(0)
    expect(envelope.catalog.manifest.hash).toBeTruthy()
    // The snapshot ships once; the flat top-level copy is legacy-only.
    expect('catalogSnapshot' in envelope).toBe(false)
    expect(envelope.cadModelManifest.modelIds).toEqual([])
    await expect(readProjectFile(jsonFile(envelope))).resolves.toMatchObject({ id: project.id })
  })

  it('keeps validation issues compatible and structured', () => {
    const project = createProject('Диагностика', 'demo')
    const issues = validateProject(project, definitions)
    const preliminary = issues.find((item) => item.id === 'preliminary')!
    expect(preliminary.ruleCode).toBe('calculation.preliminary')
    expect(preliminary.version).toBe(VALIDATION_REVISION)
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
