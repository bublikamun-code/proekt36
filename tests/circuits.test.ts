import { describe, expect, it } from 'vitest'
import { workspaceCatalog } from '../src/data/catalog'
import { createDevice, createProject } from '../src/domain/project'
import { phaseBalance, validateProject } from '../src/domain/validation'
import type { Circuit, Connection } from '../src/domain/types'

const definitions = new Map(workspaceCatalog.map((item) => [item.id, item]))
const protection = definitions.get('ekf-mcb-1p-b16')!
const target = definitions.get('ekf-terminal-1p-gray')!

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1',
  name: 'Цепь 1',
  loadName: 'Розетка',
  current: 10,
  power: 0,
  phase: 1,
  phaseCount: 1,
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

  it('loads a three-phase line into all three baskets and a single-phase one only into its own', () => {
    const project = createProject('Баланс фаз линии', 'house', { phase: 3 })
    project.circuits = [
      circuit({ id: 'c1', current: 12, phase: 1 }),
      circuit({ id: 'c3ph', current: 8, phase: 3, phaseCount: 3 }),
    ]
    // The three-phase line draws 8 A from every phase; the L1 line adds only to L1.
    expect(phaseBalance(project, definitions).totals).toEqual([20, 8, 8])
  })

  it('keeps the pre-v5 «phase: 3» reading as L3 and warns instead of guessing', () => {
    const project = createProject('Неоднозначная фаза', 'house', { phase: 3 })
    project.circuits = [circuit({ id: 'old', current: 9, phase: 3, phaseAmbiguous: true })]
    expect(phaseBalance(project, definitions).totals).toEqual([0, 0, 9])
    expect(validateProject(project, definitions).some((item) => item.ruleCode === 'circuit.phase.ambiguous')).toBe(true)
  })

  it('refuses a three-phase line in a single-phase panel', () => {
    const project = createProject('Однофазный щит', 'demo', { phase: 1 })
    project.circuits = [circuit({ id: 'pump', current: 6, phase: 1, phaseCount: 3 })]
    expect(validateProject(project, definitions).some((item) => item.ruleCode === 'circuit.phase-count.mismatch')).toBe(true)
  })

  it('derives the current from the power through the load book of the line kind', () => {
    // The book row for «power» lines: kс 0,8, cos φ 0,95. The same 4600 W on any single phase:
    // 4600·0,8/(230·0,95) ≈ 16,84 А — the assigned phase must not change the arithmetic.
    const project = createProject('Ток из мощности', 'house', { phase: 3 })
    for (const phase of [1, 2, 3] as const) {
      project.circuits = [circuit({ id: `w-${phase}`, current: 0, power: 4600, phase })]
      const amps = 4600 * 0.8 / (230 * 0.95)
      expect(phaseBalance(project, definitions).totals).toEqual(phase === 1 ? [amps, 0, 0] : phase === 2 ? [0, amps, 0] : [0, 0, amps])
    }
    // A three-phase line: 4600·0,8/(√3·400·0,95) ≈ 5,59 А drawn from every phase.
    project.circuits = [circuit({ id: 'w-3ph', current: 0, power: 4600, phase: 3, phaseCount: 3 })]
    const threePhaseAmps = Number((4600 * 0.8 / (Math.sqrt(3) * 400 * 0.95)).toFixed(2))
    expect(phaseBalance(project, definitions).totals.map((value) => Number(value.toFixed(2)))).toEqual([threePhaseAmps, threePhaseAmps, threePhaseAmps])
    // Manual coefficients override the book row line by line: cos φ 1 and kс 1 read the old
    // schoolbook 20 A from the same 4600 W.
    project.circuits = [circuit({ id: 'manual', current: 0, power: 4600, phase: 1, powerFactor: 1, demandFactor: 1 })]
    expect(phaseBalance(project, definitions).totals).toEqual([20, 0, 0])
    // A stated current wins over the derived one, and a line with neither number draws nothing.
    project.circuits = [circuit({ id: 'stated', current: 10, power: 4600, phase: 1 })]
    expect(phaseBalance(project, definitions).totals).toEqual([10, 0, 0])
    project.circuits = [circuit({ id: 'silent', current: 0, power: 0, phase: 1 })]
    expect(phaseBalance(project, definitions).totals).toEqual([0, 0, 0])
  })
})
