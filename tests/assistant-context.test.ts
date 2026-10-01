import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog } from '../src/data/catalog'
import { ASSISTANT_CONTEXT_REVISION, buildAssistantContext, assistantContextDisclosure, formatAssistantContext } from '../src/domain/assistantContext'
import { createProject } from '../src/domain/project'
import { validateProject } from '../src/domain/validation'
import type { PanelProject } from '../src/domain/types'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))

/** Every field the user must never see leave the browser, filled with a value we can grep for. */
const SECRET = {
  projectName: 'СЕКРЕТ-ИМЯ-ПРОЕКТА',
  projectId: 'СЕКРЕТ-ID-ПРОЕКТА',
  address: 'СЕКРЕТ-АДРЕС',
  marking: 'СЕКРЕТ-МАРКИРОВКА',
  note: 'СЕКРЕТ-ПРИМЕЧАНИЕ',
  circuitName: 'СЕКРЕТ-ИМЯ-ЦЕПИ',
  loadName: 'СЕКРЕТ-НАГРУЗКА',
  circuitNote: 'СЕКРЕТ-ЗАМЕТКА-ЦЕПИ',
  connectionLabel: 'СЕКРЕТ-ПОДПИСЬ-ПОДКЛЮЧЕНИЯ',
}

const seeded = (): PanelProject => {
  const project = createProject(SECRET.projectName, 'apartment')
  project.id = SECRET.projectId
  project.devices = [
    { instanceId: 'СЕКРЕТ-INSTANCE-1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: SECRET.address, quantity: 2, phase: 1, marking: SECRET.marking, note: SECRET.note, mount: 'din' },
    { instanceId: 'inst-2', productId: 'ekf-rccb-4p-40', row: 0, slot: 1, address: 'QF2', quantity: 1, phase: 1, marking: '', note: '', mount: 'din' },
    { instanceId: 'inst-3', productId: 'ekf-spd-t1-3p-n-pe', row: 0, slot: 5, address: 'SPD1', quantity: 1, phase: 1, marking: '', note: '', mount: 'din' },
    { instanceId: 'inst-4', productId: 'ekf-mcb-1p-b16', row: 1, slot: 0, address: 'QF4', quantity: 1, phase: 2, marking: '', note: '', mount: 'din' },
  ]
  project.circuits = [{
    id: 'circuit-1', name: SECRET.circuitName, loadName: SECRET.loadName, current: 16, power: 3500,
    phase: 1, protectionDeviceId: 'СЕКРЕТ-INSTANCE-1', color: '#c65c3b', wireCrossSection: 1.5, note: SECRET.circuitNote,
  }]
  project.connections = [
    { id: 'conn-1', circuitId: 'circuit-1', fromBus: 'L', toDeviceId: 'СЕКРЕТ-INSTANCE-1', color: '#c65c3b', thickness: 2, label: SECRET.connectionLabel },
  ]
  return project
}

describe('assistant context', () => {
  it('never carries user-entered text, identifiers or catalogue names', () => {
    const project = seeded()
    const context = buildAssistantContext(project, definitions, validateProject(project, definitions))
    const payload = `${formatAssistantContext(context)}\n${assistantContextDisclosure(context).join('\n')}`

    for (const secret of Object.values(SECRET)) {
      expect(payload).not.toContain(secret)
    }
    // Instance ids and product ids of placed devices are user data too.
    expect(payload).not.toContain('СЕКРЕТ-INSTANCE-1')
    expect(payload).not.toContain('ekf-mcb-1p-c6')
    expect(payload).not.toContain('ekf-rccb-4p-40')
    // Catalogue display names would identify the customer's bill of materials.
    expect(payload).not.toContain('AVO-10')
    expect(payload).not.toContain(builtinCatalog[0]!.sku)
  })

  it('keeps the totals an assistant actually reasons with', () => {
    const project = seeded()
    const context = buildAssistantContext(project, definitions, validateProject(project, definitions))

    expect(context.revision).toBe(ASSISTANT_CONTEXT_REVISION)
    expect(context.occupancy.devices).toBe(4)
    // Four positions, but the first record carries quantity 2, so five apparatus are on the board.
    expect(context.occupancy.devicesTotal).toBe(5)
    expect(context.occupancy.usedModules).toBe(10)
    expect(context.occupancy.capacityModules).toBe(24)
    expect(context.occupancy.byCategory.find((item) => item.category === 'MCB')?.devices).toBe(2)
    expect(context.occupancy.byRow).toHaveLength(context.panel.rows)
    expect(context.load.circuits).toBe(1)
    expect(context.load.totalCurrentA).toBe(16)
    expect(context.issues.length).toBeGreaterThan(0)
    expect(JSON.parse(formatAssistantContext(context))).toEqual(context)
  })

  it('groups repeated issues by rule code and keeps only code, level and title', () => {
    const project = seeded()
    project.devices.push({ ...project.devices[0]!, instanceId: 'inst-5', slot: 0 })
    project.devices.push({ ...project.devices[0]!, instanceId: 'inst-6', slot: 0 })
    const issues = validateProject(project, definitions)
    const context = buildAssistantContext(project, definitions, issues)

    const overlap = context.issues.find((item) => item.code === 'layout.overlap')
    expect(overlap?.count).toBeGreaterThan(1)
    expect(Object.keys(overlap!).sort()).toEqual(['code', 'count', 'level', 'title'])
    // The raw issue text interpolates the product name, which must not travel.
    const overlapIssue = issues.find((item) => item.ruleCode === 'layout.overlap')
    expect(overlapIssue?.message).toContain('AVO-10')
    expect(JSON.stringify(context)).not.toContain('AVO-10')
  })

  /**
   * An unprotected circuit keeps `protectionDeviceId: ''`. With that empty id left in the set of
   * known protection devices, every later unprotected circuit found it there and counted itself
   * as protected, so a board missing protection on every line was reported as fully protected.
   */
  it('counts every circuit without a protection device, not only the first', () => {
    const project = seeded()
    project.circuits = [
      { id: 'a', name: 'Без защиты 1', loadName: 'A', current: 16, power: 1000, phase: 1, protectionDeviceId: '', color: '#c65c3b', wireCrossSection: 1.5, note: '' },
      { id: 'b', name: 'Без защиты 2', loadName: 'B', current: 16, power: 1000, phase: 1, protectionDeviceId: '', color: '#c65c3b', wireCrossSection: 1.5, note: '' },
      { id: 'c', name: 'С защитой', loadName: 'C', current: 16, power: 1000, phase: 1, protectionDeviceId: 'inst-2', color: '#c65c3b', wireCrossSection: 1.5, note: '' },
    ]

    const context = buildAssistantContext(project, definitions, validateProject(project, definitions))

    expect(context.load.circuits).toBe(3)
    expect(context.load.circuitsWithoutProtection).toBe(2)
  })
})
