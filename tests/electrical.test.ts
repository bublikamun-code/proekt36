import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import { capacityForSection, sectionForAmps } from '../src/domain/conductorSpec'
import { circuitLoadCheck, conductorCheck, currentForPowerA, expectedPowerW, phaseImbalance, protectionLoads } from '../src/domain/electrical'
import { createDevice, createProject } from '../src/domain/project'
import { validateProject } from '../src/domain/validation'
import type { Circuit, PanelProject } from '../src/domain/types'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))
const product = (id: string) => definitions.get(id)!

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1', name: 'Цепь 1', loadName: 'Розетка', current: 10, power: 0, phase: 1,
  protectionDeviceId: '', color: '#c65c3b', wireCrossSection: 1.5, note: '', ...patch,
})

const codes = (project: PanelProject) => validateProject(project, definitions).map((issue) => issue.ruleCode)

describe('справочник сечений', () => {
  it('находит минимальное сечение под номинал и не выдумывает его за пределом таблицы', () => {
    expect(sectionForAmps(16)).toBe(1)
    expect(sectionForAmps(19)).toBe(1)
    expect(sectionForAmps(24)).toBe(1.5)
    expect(sectionForAmps(25)).toBe(2.5)
    expect(sectionForAmps(100)).toBe(16)
    // 580 A is the last row; anything above it this data cannot judge.
    expect(sectionForAmps(580)).toBe(240)
    expect(sectionForAmps(600)).toBeUndefined()
  })

  it('интерполирует сечение, которого нет в каталоге', () => {
    // 3 mm² arrives from an imported file: crediting it with the next larger row would pass a
    // genuinely small cable, crediting it with the smaller one would warn on a correct one.
    expect(capacityForSection(3)).toBeGreaterThan(capacityForSection(2.5))
    expect(capacityForSection(3)).toBeLessThan(capacityForSection(4))
    expect(capacityForSection(1.5)).toBe(24)
    expect(capacityForSection(1000)).toBe(580)
  })
})

describe('проверка сечения', () => {
  it('пропускает провод, который держит номинал защиты', () => {
    expect(conductorCheck(1.5, 16)).toBeNull()
    expect(conductorCheck(2.5, 25)).toBeNull()
    expect(conductorCheck(10, 63)).toBeNull()
  })

  it('называет нужное сечение, когда провод тоньше защиты', () => {
    expect(conductorCheck(1.5, 25)).toMatchObject({ actual: 1.5, required: 2.5, capacity: 24 })
    expect(conductorCheck(0.5, 63)).toMatchObject({ actual: 0.5, required: 10 })
  })

  it('молчит, когда оценить нечем', () => {
    expect(conductorCheck(1.5, 0)).toBeNull()
    expect(conductorCheck(1.5, 1000)).toBeNull()
  })
})

describe('мощность и ток цепи', () => {
  it('считает ток, который подразумевает мощность', () => {
    expect(currentForPowerA(2300, 1)).toBe(10)
    expect(currentForPowerA(0, 1)).toBe(0)
    expect(expectedPowerW(10, 1)).toBe(2300)
    // Three phases are counted against √3·400, not against 230.
    expect(expectedPowerW(10, 3)).toBeGreaterThan(6000)
  })

  it('молчит, когда цепь рассчитана с запасом', () => {
    // A 16 A socket group at 1500 W is the ordinary case, not a mistake: the circuit is designed
    // for more than it carries. A rule that flagged this would fire on nearly every real project.
    const check = circuitLoadCheck(circuit({ current: 16, power: 1500 }), 16)
    expect(check?.implied).toBeCloseTo(6.52, 2)
    expect(check).toMatchObject({ exceedsCurrent: false, exceedsProtection: false })
  })

  it('находит нагрузку тяжелее самой цепи', () => {
    const check = circuitLoadCheck(circuit({ current: 6, power: 2300 }))
    expect(check?.exceedsCurrent).toBe(true)
    expect(check?.implied).toBe(10)
  })

  it('находит нагрузку тяжелее защищающего аппарата', () => {
    expect(circuitLoadCheck(circuit({ current: 10, power: 4600 }), 16)?.exceedsProtection).toBe(true)
    expect(circuitLoadCheck(circuit({ current: 10, power: 2300 }), 16)?.exceedsProtection).toBe(false)
  })
})

describe('разброс фаз', () => {
  const threePhase = (circuits: Circuit[]) => {
    const project = createProject('Три фазы', 'house', { phase: 3, inputCurrent: 63 })
    const device = createDevice(product('ekf-mcb-3p-c25'), 0, 0)
    project.devices = [device]
    project.circuits = circuits
    return project
  }

  it('уравновешенную панель не трогает', () => {
    const project = threePhase([
      circuit({ id: 'a', current: 10, phase: 1, protectionDeviceId: '' }),
      circuit({ id: 'b', current: 10, phase: 2, protectionDeviceId: '' }),
      circuit({ id: 'c', current: 10, phase: 3, protectionDeviceId: '' }),
    ])
    expect(phaseImbalance(project, definitions)).toBeNull()
    expect(codes(project)).not.toContain('electrical.phase-imbalance.preliminary')
  })

  it('считает панель с нагрузкой на одной фазе разбалансированной только когда сравнивать не с чем', () => {
    // One loaded phase is not a spread: there is no second phase to compare it against. Reporting
    // 100 % here would fire on every freshly created three-phase panel.
    const project = threePhase([circuit({ id: 'a', current: 16, phase: 1, protectionDeviceId: '' })])
    expect(phaseImbalance(project, definitions)).toBeNull()
  })

  it('сообщает о перекосе, когда грузить есть что сравнивать', () => {
    const project = threePhase([
      circuit({ id: 'a', current: 30, phase: 1, protectionDeviceId: '' }),
      circuit({ id: 'b', current: 2, phase: 2, protectionDeviceId: '' }),
      circuit({ id: 'c', current: 0, phase: 3, protectionDeviceId: '' }),
    ])
    // A phase with no declared load at all is part of the spread: there is nothing to compare it
    // against, and the incoming breaker is rated per phase, so an idle phase is the real risk.
    expect(phaseImbalance(project, definitions)).toMatchObject({ spread: 100, totals: [30, 2, 0] })
    expect(codes(project)).toContain('electrical.phase-imbalance.preliminary')
  })
})

describe('общий защитный аппарат', () => {
  it('суммирует ток цепей, защищаемых одним аппаратом', () => {
    const project = createProject('Общий автомат', 'apartment')
    const mcb = createDevice(product('ekf-mcb-4p-b32'), 0, 0)
    project.devices = [mcb]
    project.circuits = [
      circuit({ id: 'a', name: 'Розетки', current: 20, protectionDeviceId: mcb.instanceId }),
      circuit({ id: 'b', name: 'Кухня', current: 20, protectionDeviceId: mcb.instanceId }),
    ]
    expect(protectionLoads(project, definitions).get(mcb.instanceId)).toMatchObject({ current: 40, ratedCurrent: 32 })
    // 40 A through a 32 A device: neither circuit alone exceeds it, so only the sum rule sees it.
    expect(codes(project)).toContain('circuit.shared-protection.overload')
    expect(codes(project)).not.toContain('circuit.current.over-protection')
  })

  it('не сообщает, когда аппарат рассчитан на сумму', () => {
    const project = createProject('Достаточный автомат', 'apartment')
    const mcb = createDevice(product('ekf-mcb-4p-b32'), 0, 0)
    project.devices = [mcb]
    project.circuits = [circuit({ id: 'a', current: 10, protectionDeviceId: mcb.instanceId }), circuit({ id: 'b', current: 10, protectionDeviceId: mcb.instanceId })]
    expect(codes(project)).not.toContain('circuit.shared-protection.overload')
  })

  it('одна цепь на аппарате — это и есть его номинал, а не перегрузка', () => {
    const project = createProject('Одна цепь', 'apartment')
    const mcb = createDevice(product('ekf-mcb-1p-c6'), 0, 0)
    project.devices = [mcb]
    project.circuits = [circuit({ id: 'a', current: 20, protectionDeviceId: mcb.instanceId })]
    const rules = codes(project)
    expect(rules).toContain('circuit.current.over-protection')
    expect(rules).not.toContain('circuit.shared-protection.overload')
  })
})

describe('новые правила в составе отчёта', () => {
  const withProtection = (productId: string, patch: Partial<Circuit> = {}) => {
    const project = createProject('Сечение', 'apartment')
    const mcb = createDevice(product(productId), 0, 0)
    project.devices = [mcb]
    project.circuits = [circuit({ protectionDeviceId: mcb.instanceId, ...patch })]
    return { project, rules: () => codes(project) }
  }

  it('проверяет сечение провода по номиналу защиты, а не по нагрузке', () => {
    // 0.5 mm² carries 11 A, which is enough for a 6 A device and far too little for a 16 A one —
    // even though both circuits draw the same 4 A.
    expect(withProtection('ekf-mcb-1p-c6', { current: 4, wireCrossSection: 0.5 }).rules()).not.toContain('circuit.conductor.cross-section')
    expect(withProtection('ekf-mcb-1p-b16', { current: 4, wireCrossSection: 0.5 }).rules()).toContain('circuit.conductor.cross-section')
    expect(withProtection('ekf-mcb-1p-b16', { current: 4, wireCrossSection: 1.5 }).rules()).not.toContain('circuit.conductor.cross-section')
  })

  it('находит позицию без адреса и повторяющийся адрес', () => {
    const project = createProject('Адреса', 'apartment')
    const first = createDevice(product('ekf-mcb-1p-c6'), 0, 0)
    const second = createDevice(product('ekf-mcb-1p-c6'), 0, 1)
    first.address = 'QF01'
    second.address = 'QF01'
    project.devices = [first, second]
    const rules = codes(project)
    expect(rules).toContain('device.address.duplicate')

    project.devices = [first, { ...second, address: '' }]
    expect(codes(project)).toContain('device.address.missing')
  })

  it('каждое новое правило несёт код и ревизию набора', () => {
    // One circuit that trips all three at once: a 16 A device, 0.5 mm² (11 A) and a 4.6 kW load
    // that needs 20 A — heavier than the circuit declares and heavier than the device is rated.
    const { project } = withProtection('ekf-mcb-1p-b16', { current: 6, power: 4600, wireCrossSection: 0.5 })
    const issues = validateProject(project, definitions)
    expect(issues.every((issue) => issue.ruleVersion === 3 && issue.version === 3)).toBe(true)
    expect(issues.map((issue) => issue.ruleCode)).toEqual(expect.arrayContaining([
      'circuit.conductor.cross-section',
      'circuit.power.current.mismatch',
      'circuit.power.over-protection',
    ]))
    // A message has to say which number disagrees with which, otherwise the user is left guessing
    // which of the two fields to change.
    expect(issues.find((issue) => issue.ruleCode === 'circuit.power.current.mismatch')?.message).toContain('20 А')
  })
})
