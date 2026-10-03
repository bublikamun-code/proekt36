import { describe, expect, it } from 'vitest'
import { builtinCatalog } from '../src/data/catalog'
import { createDevice, createProject } from '../src/domain/project'
import { phaseBalance } from '../src/domain/electrical'
import { validateProject } from '../src/domain/validation'
import type { Circuit, Connection } from '../src/domain/types'

const definitions = new Map(builtinCatalog.map((item) => [item.id, item]))
const protection = definitions.get('ekf-mcb-1p-b16')!
const target = definitions.get('ekf-terminal-1p-gray')!

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1',
  name: 'Цепь 1',
  loadName: 'Розетка',
  current: 10,
  power: 0,
  phase: 1,
  protectionDeviceId: 'protection-1',
  color: '#c65c3b',
  wireCrossSection: 1.5,
  note: '',
  ...patch,
})

const connection = (patch: Partial<Connection> = {}): Connection => ({
  id: 'connection-1',
  circuitId: 'circuit-1',
  fromBus: 'L',
  toDeviceId: 'target-1',
  color: '#c65c3b',
  thickness: 2,
  label: 'Цепь 1',
  ...patch,
})

describe('circuits and connections', () => {
  it('validates protection, phase, current and connection references', () => {
    const project = createProject('Проверка цепей', 'demo', { phase: 1 })
    project.devices = [
      { ...createDevice(protection, 0, 0), instanceId: 'protection-1' },
      { ...createDevice(target, 1, 0), instanceId: 'target-1' },
    ]
    project.circuits = [circuit({ current: 20, phase: 2, protectionDeviceId: 'missing' })]
    project.connections = []

    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.title === 'Не выбрано защитное устройство')).toBe(true)
    expect(issues.some((issue) => issue.title === 'Фаза цепи не совпадает с сетью')).toBe(true)
    expect(issues.some((issue) => issue.title === 'Цепь не подключена')).toBe(true)
  })

  it('reports stale, duplicate and unlabeled connections', () => {
    const project = createProject('Проверка связей', 'demo', { phase: 1 })
    project.devices = [
      { ...createDevice(protection, 0, 0), instanceId: 'protection-1' },
      { ...createDevice(target, 1, 0), instanceId: 'target-1' },
    ]
    project.circuits = [circuit()]
    project.connections = [
      connection({ id: 'valid-connection', label: 'Фаза QF01' }),
      connection({ id: 'duplicate-connection', label: 'Фаза QF01' }),
      connection({ id: 'missing-device', toDeviceId: 'missing-device', label: 'Устройство удалено' }),
      connection({ id: 'missing-circuit', circuitId: 'missing-circuit', label: 'Цепь удалена' }),
      connection({ id: 'missing-label', label: '' }),
      connection({ id: 'missing-bus', fromBus: 'X' as 'L', label: 'Неизвестная шина' }),
    ]

    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id === 'connection-duplicate-duplicate-connection')).toBe(true)
    expect(issues.some((issue) => issue.id === 'connection-device-missing-device')).toBe(true)
    expect(issues.some((issue) => issue.id === 'connection-circuit-missing-circuit')).toBe(true)
    expect(issues.some((issue) => issue.id === 'connection-label-missing-label')).toBe(true)
    expect(issues.some((issue) => issue.id === 'connection-bus-missing-bus')).toBe(true)
  })

  it('reports an over-current circuit when a protection device exists', () => {
    const project = createProject('Проверка перегрузки', 'demo', { phase: 3 })
    project.devices = [
      { ...createDevice(protection, 0, 0), instanceId: 'protection-1' },
      { ...createDevice(target, 1, 0), instanceId: 'target-1' },
    ]
    project.circuits = [circuit({ current: 20, phase: 3 })]
    project.connections = [connection()]

    const issues = validateProject(project, definitions)
    expect(issues.some((issue) => issue.id === 'circuit-overload-circuit-1')).toBe(true)
  })

  it('calculates three-phase and single-phase balance from circuit currents', () => {
    const project = createProject('Баланс', 'house', { phase: 3 })
    project.circuits = [
      circuit({ id: 'c1', current: 10, phase: 1 }),
      circuit({ id: 'c2', current: 10, phase: 2 }),
      circuit({ id: 'c3', current: 10, phase: 3 }),
    ]
    expect(phaseBalance(project, definitions).totals).toEqual([10, 10, 10])
    expect(phaseBalance(project, definitions).spread).toBe(0)

    project.settings.phase = 1
    project.circuits = [circuit({ id: 'single', current: 16, phase: 1 })]
    expect(phaseBalance(project, definitions).totals).toEqual([16, 0, 0])
    expect(phaseBalance(project, definitions).spread).toBe(0)
  })
})
