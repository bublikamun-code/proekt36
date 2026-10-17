import { describe, expect, it } from 'vitest'
import { circuitLoadMath } from '../src/domain/electrical'
import { suggestCable, suggestProtection } from '../src/domain/sizing'
import { normalizeCircuit } from '../src/domain/project'
import { PROJECT_SCHEMA_VERSION, validateProjectSchema } from '../src/domain/projectSchema'
import { phaseBalance, validateProject } from '../src/domain/validation'
import { workspaceCatalog } from '../src/data/catalog'
import type { Circuit, DeviceDefinition, PanelProject } from '../src/domain/types'

/**
 * Эталонные щиты (ELECTRICIAN_TOOL.md, раздел 3) — приёмочные объекты расчётного ядра.
 * Ведомости пересчитаны вручную по формулам, указанным в комментариях, и зафиксированы
 * как ожидания: расхождение с эталоном не закрывается правкой теста, а разбирается.
 * Коэффициенты — строки справочника нагрузок (статус «предварительно»), поэтому и весь
 * расчёт — предварительный, до фиксации источника со специалистом.
 */

const definitions = new Map(workspaceCatalog.map((item) => [item.id, item]))

const circuit = (patch: Partial<Circuit>): Circuit => normalizeCircuit({ kind: 'power', wireCrossSection: 2.5, ...patch })

// Минимальный набор определений для проверок защиты: RCBO для розеточных линий,
// простой автомат для света — категории те же, что раздаёт каталог.
const mcb = (id: string, ratedCurrent: number): DeviceDefinition => ({
  id, name: `MCB ${ratedCurrent}`, brand: 'Тест', sku: id, category: 'MCB', moduleWidth: 1,
  poles: 1, ratedCurrent, voltage: 230, bus: 'L', price: 0, weight: 0, height: 80, depth: 70, tripCurve: 'C',
})
const rcbo = (id: string, ratedCurrent: number): DeviceDefinition => ({
  ...mcb(id, ratedCurrent), category: 'RCBO', poles: 2,
})

const shieldDevice = (instanceId: string, product: DeviceDefinition, slot: number) => ({
  instanceId, productId: product.id, row: 0, slot, address: instanceId.toUpperCase(), quantity: 1, phase: 1 as const, note: '', marking: '', mount: 'din' as const,
})

const shield = (name: string, settings: Partial<PanelProject['settings']>): PanelProject => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: 'ref',
  name,
  preset: 'demo',
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  settings: { inputCurrent: 40, phase: 1, enclosureWidth: 300, enclosureHeight: 300, enclosureDepth: 100, rows: 1, reserveModules: 0, ...settings },
  devices: [],
  circuits: [],
  connections: [],
  busAssemblies: [],
  combs: [],
  rooms: [],
})

describe('ЩС-1 · квартира-студия: 1ф 40 А, 12 модулей, 8 линий', () => {
  const project = shield('ЩС-1', { inputCurrent: 40, phase: 1, rows: 1 })
  // Ведомость: линия → мощность → Iр → защита → кабель. Числа посчитаны руками.
  const lines: Array<{ name: string; watts: number; kind: 'power' | 'light'; amps: number; rating: number; curve: 'B' | 'C'; section: number }> = [
    { name: 'Розетки кухни', watts: 3500, kind: 'power', amps: 12.81, rating: 16, curve: 'C', section: 2.5 },
    { name: 'Розетки комнаты', watts: 2500, kind: 'power', amps: 9.15, rating: 16, curve: 'C', section: 2.5 },
    { name: 'Свет', watts: 800, kind: 'light', amps: 3.78, rating: 6, curve: 'B', section: 1.5 },
    { name: 'Варочная панель', watts: 6000, kind: 'power', amps: 21.97, rating: 25, curve: 'C', section: 2.5 },
    { name: 'Духовка', watts: 3500, kind: 'power', amps: 12.81, rating: 16, curve: 'C', section: 2.5 },
    { name: 'Холодильник', watts: 400, kind: 'power', amps: 1.46, rating: 16, curve: 'C', section: 2.5 },
    { name: 'Стиральная машина', watts: 2200, kind: 'power', amps: 8.05, rating: 16, curve: 'C', section: 2.5 },
    { name: 'Водонагреватель', watts: 2000, kind: 'power', amps: 7.32, rating: 16, curve: 'C', section: 2.5 },
  ]

  it('считает каждую линию и предлагает ведомости защиты и кабеля', () => {
    for (const line of lines) {
      const math = circuitLoadMath(circuit({ id: line.name, name: line.name, loadName: line.name, power: line.watts, kind: line.kind, protectionDeviceId: 'qf0' }))
      expect(math.amps, line.name).toBeCloseTo(line.amps, 2)
      expect(math.basis, line.name).toBe('derived')
      const protection = suggestProtection(math.amps, line.kind)
      expect(protection.ratingA, line.name).toBe(line.rating)
      expect(protection.curve, line.name).toBe(line.curve)
      // Длины трасс не заданы — сечение по Iдд и монтажному минимуму, падение не проверено.
      const cable = suggestCable({ amps: math.amps, ratingA: line.rating, lengthM: 0, system: 1, kind: line.kind })
      expect(cable.sectionMm2, line.name).toBe(line.section)
      expect(cable.dropChecked, line.name).toBe(false)
    }
  })

  it('с заданными трассами проверяет падение и оставляет сечение', () => {
    // Кухня: 12 м, 2,5 мм² → 2·12·12,81·0,0175/2,5 = 2,15 В = 0,94 % из 4 %.
    const kitchen = suggestCable({ amps: 12.81, ratingA: 16, lengthM: 12, system: 1, kind: 'power' })
    expect(kitchen.sectionMm2).toBe(2.5)
    expect(kitchen.dropPercent).toBeCloseTo(0.94, 2)
    // Варочная: 15 м — 2·15·21,97·0,0175/2,5 = 4,61 В = 2,01 %: в лимите на том же сечении.
    const cooker = suggestCable({ amps: 21.97, ratingA: 25, lengthM: 15, system: 1, kind: 'power' })
    expect(cooker.sectionMm2).toBe(2.5)
    expect(cooker.dropPercent).toBeCloseTo(2.01, 2)
  })

  it('раскладывает нагрузку в одну корзину L1 и молчит о вводе: линии по отдельности его не превышают', () => {
    project.circuits = lines.map((line, index) => circuit({
      id: `c${index + 1}`, name: line.name, loadName: line.name, power: line.watts,
      kind: line.kind, phase: 1, protectionDeviceId: 'qf0',
    }))
    const totals = phaseBalance(project, definitions).totals
    expect(totals[0]).toBeCloseTo(lines.reduce((sum, line) => sum + line.amps, 0), 1)
    expect(totals[1]).toBe(0)
    expect(totals[2]).toBe(0)
    // Каждая линия в отдельности ниже 40 А — агрегатного предупреждения на 1ф-щите нет.
    expect(validateProject(project, definitions).filter((issue) => issue.ruleCode === 'circuit.current.input.preliminary')).toEqual([])
  })

  it('розеточная линия на простом автомате без УЗО в щите — предупреждение', () => {
    const defs = new Map<string, DeviceDefinition>([
      ['mcb-c16', mcb('mcb-c16', 16)],
      ['mcb-b6', mcb('mcb-b6', 6)],
      ['rcbo-40', rcbo('rcbo-40', 40)],
    ])
    const socketLines = lines.filter((line) => line.kind === 'power')
    project.devices = [
      shieldDevice('mcb1', defs.get('mcb-c16')!, 0),
      shieldDevice('qf-light', defs.get('mcb-b6')!, 2),
    ]
    project.circuits = lines.map((line, index) => circuit({
      id: `c${index + 1}`, name: line.name, loadName: line.name, power: line.watts, kind: line.kind,
      phase: 1, protectionDeviceId: line.kind === 'light' ? 'qf-light' : 'mcb1',
    }))
    // Все семь розеточных линий на обычных автоматах, УЗО в щите нет — по одной предупреждению на каждую.
    expect(validateProject(project, defs).filter((issue) => issue.ruleCode === 'protection.rccd.line.preliminary')).toHaveLength(socketLines.length)
    // Поставили дифавтомат и перевели розетки на него — предупреждения уходят.
    project.devices.push(shieldDevice('rcbo1', defs.get('rcbo-40')!, 4))
    for (const item of project.circuits) {
      if ((item.kind ?? 'power') === 'power') item.protectionDeviceId = 'rcbo1'
    }
    expect(validateProject(project, defs).filter((issue) => issue.ruleCode.startsWith('protection.rccd.line'))).toEqual([])
  })
})

describe('ЩС-2 · двухкомнатная с 3ф плитой: 3ф 25 А, 36 модулей, 16 линий', () => {
  const project = shield('ЩС-2', { inputCurrent: 25, phase: 3, rows: 1 })

  it('считает трёхфазную плиту по √3·400 и раскладывает её во все три корзины', () => {
    // 7500·0,8/(√3·400·0,95) = 6000/658,18 ≈ 9,12 А на каждую фазу.
    const cooker = circuitLoadMath(circuit({ id: 'cooker', name: 'Плита 3ф', loadName: 'Плита', power: 7500, phaseCount: 3, kind: 'power', protectionDeviceId: 'qf0' }))
    expect(cooker.amps).toBeCloseTo(9.12, 2)
    const protection = suggestProtection(cooker.amps, 'power')
    // Минимум розеток тянет 9,12 А не на 10, а на практические 16 А.
    expect(protection.ratingA).toBe(16)
    expect(protection.curve).toBe('C')
    // 12 м, 2,5 мм²: √3·12·9,12·0,0175/2,5 = 1,33 В = 0,33 % из 4 %.
    const cable = suggestCable({ amps: cooker.amps, ratingA: 16, lengthM: 12, system: 3, kind: 'power' })
    expect(cable.sectionMm2).toBe(2.5)
    expect(cable.dropPercent).toBeCloseTo(0.33, 2)

    project.circuits = [circuit({ id: 'cooker', name: 'Плита 3ф', loadName: 'Плита', power: 7500, phaseCount: 3, phase: 1, kind: 'power', protectionDeviceId: 'qf0' })]
    expect(phaseBalance(project, definitions).totals.map((value) => Number(value.toFixed(2)))).toEqual([9.12, 9.12, 9.12])
  })

  it('ведёт однофазные линии по трём фазам и показывает разброс', () => {
    // Ведомость однофазной части: фаза → (мощности в ваттах).
    const byPhase: Record<1 | 2 | 3, Array<[string, number, 'power' | 'light']>> = {
      1: [['Розетки зала', 2500, 'power'], ['Свет зала', 600, 'light'], ['Розетки спальни', 2000, 'power'], ['Свет спальни', 500, 'light'], ['Кондиционер', 1500, 'power'], ['Стиральная машина', 2200, 'power']],
      2: [['Духовка', 3500, 'power'], ['Розетки кухни', 2500, 'power'], ['Свет кухни', 400, 'light'], ['Холодильник', 400, 'power'], ['Посудомоечная машина', 2000, 'power']],
      3: [['Водонагреватель', 2000, 'power'], ['Розетки прихожей', 1000, 'power'], ['Свет прихожей', 300, 'light'], ['Розетки балкона', 1000, 'power']],
    }
    project.circuits = ([1, 2, 3] as const).flatMap((phase) => byPhase[phase].map(([name, watts, kind], index) => circuit({
      id: `p${phase}-${index + 1}`, name, loadName: name, power: watts, kind, phase, protectionDeviceId: 'qf0',
    })))
    // Ручная сверка корзин (каждая сумма = Σ P·kс/218,5 или /211,6 для света):
    // L1 = 35,23 А; L2 = 32,64 А; L3 = 16,07 А. Разброс = (35,23 − 16,07)/35,23 ≈ 54 %.
    const totals = phaseBalance(project, definitions).totals
    expect(totals[0]).toBeCloseTo(35.23, 1)
    expect(totals[1]).toBeCloseTo(32.64, 1)
    expect(totals[2]).toBeCloseTo(16.07, 1)
    expect(phaseBalance(project, definitions).spread).toBe(54)
  })
})

describe('коэффициенты в файле проекта', () => {
  it('нормализация и схема переживают ручные перекрытия', () => {
    const circuit = normalizeCircuit({ id: 'c1', name: 'Цепь', loadName: 'Нагрузка', protectionDeviceId: 'qf1', powerFactor: 0.98, demandFactor: 0.6 })
    expect(circuit.powerFactor).toBe(0.98)
    expect(circuit.demandFactor).toBe(0.6)
    // Мусор и выход за диапазон — «нет перекрытия», не падение.
    const fallback = normalizeCircuit({ id: 'c2', name: 'Цепь', loadName: 'Н', protectionDeviceId: 'qf1', powerFactor: 1.4, demandFactor: 'много' })
    expect(fallback.powerFactor).toBeUndefined()
    expect(fallback.demandFactor).toBeUndefined()

    const project = shield('С коэффициентами', {})
    project.devices = [shieldDevice('qf1', { ...mcb('mcb-c16', 16), id: 'mcb-c16' }, 0)]
    project.circuits = [circuit]
    const validation = validateProjectSchema(project)
    expect(validation.errors).toEqual([])
  })
})
