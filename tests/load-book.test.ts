import { describe, expect, it } from 'vitest'
import { CIRCUIT_KIND_LABELS, LOAD_BOOK, loadBookRow } from '../src/domain/loadBook'
import { circuitLoadMath, circuitCurrentA } from '../src/domain/electrical'
import { CIRCUIT_KINDS, type Circuit } from '../src/domain/types'

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'c1',
  name: 'Цепь 1',
  loadName: 'Розетка',
  current: 0,
  power: 0,
  phase: 1,
  phaseCount: 1,
  protectionDeviceId: 'protection-1',
  color: '#c65c3b',
  wireCrossSection: 2.5,
  note: '',
  ...patch,
})

describe('справочник типовых нагрузок', () => {
  it('покрывает все виды линии и держит коэффициенты в физическом диапазоне', () => {
    for (const kind of CIRCUIT_KINDS) {
      const row = LOAD_BOOK[kind]
      expect(row.kind).toBe(kind)
      expect(row.powerFactor).toBeGreaterThan(0)
      expect(row.powerFactor).toBeLessThanOrEqual(1)
      expect(row.demandFactor).toBeGreaterThan(0)
      expect(row.demandFactor).toBeLessThanOrEqual(1)
      expect(row.minSectionMm2).toBeGreaterThanOrEqual(0.5)
      // Ни одна строка не притворяется проверенной, пока источник не зафиксирован со
      // специалистом — это правило продукта (ELECTRICIAN_TOOL.md, раздел 3).
      expect(row.status).toBe('preliminary')
      expect(row.note.length).toBeGreaterThan(10)
    }
    expect(LOAD_BOOK.power.minSectionMm2).toBe(2.5)
    expect(LOAD_BOOK.power.minRatingA).toBe(16)
    for (const kind of CIRCUIT_KINDS) expect(LOAD_BOOK[kind].minRatingA).toBeGreaterThanOrEqual(6)
  })

  it('даёт одну строку по умолчанию и общие метки видов линии', () => {
    expect(loadBookRow(undefined).kind).toBe('power')
    expect(loadBookRow('light').kind).toBe('light')
    for (const kind of CIRCUIT_KINDS) expect(CIRCUIT_KIND_LABELS[kind]).toBeTruthy()
  })
})

describe('расчётный ток линии', () => {
  it('выводит ток из мощности по справочнику вида линии', () => {
    // Розетки: kс 0,8, cos φ 0,95 → 3500·0,8/(230·0,95) ≈ 12,81 А.
    const power = circuitLoadMath(circuit({ power: 3500, kind: 'power' }))
    expect(power.basis).toBe('derived')
    expect(power.amps).toBeCloseTo((3500 * 0.8) / (230 * 0.95), 3)
    expect(power.status).toBe('preliminary')
    expect(power.factorSource).toBe('book')
    expect(power.explanation).toContain('3,5 кВт')
    expect(power.explanation).toContain('0,80')
    expect(circuitCurrentA(circuit({ power: 3500, kind: 'power' }))).toBeCloseTo(power.amps, 6)
  })

  it('освещение и DC считаются со своими строками', () => {
    // Свет: kс 1, cos φ 0,92 → 800/(230·0,92) ≈ 3,78 А.
    expect(circuitLoadMath(circuit({ power: 800, kind: 'light' })).amps).toBeCloseTo(800 / (230 * 0.92), 3)
    // DC: cos φ не применим (1), kс 0,8.
    expect(circuitLoadMath(circuit({ power: 500, kind: 'dc' })).amps).toBeCloseTo((500 * 0.8) / 230, 3)
    expect(circuitLoadMath(circuit({ power: 500, kind: 'dc' })).explanation).toContain('230 В')
  })

  it('трёхфазная линия делится на √3·400 с теми же коэффициентами', () => {
    // 7000·0,8/(√3·400·0,95) ≈ 8,51 А на фазу.
    const threePhase = circuitLoadMath(circuit({ power: 7000, phaseCount: 3, kind: 'power' }))
    expect(threePhase.amps).toBeCloseTo((7000 * 0.8) / (Math.sqrt(3) * 400 * 0.95), 3)
    expect(threePhase.explanation).toContain('400 В')
  })

  it('ручные коэффициенты перекрывают справочник построчно', () => {
    const manual = circuitLoadMath(circuit({ power: 3500, kind: 'power', powerFactor: 1, demandFactor: 1 }))
    expect(manual.amps).toBeCloseTo(3500 / 230, 3)
    expect(manual.factorSource).toBe('manual')
    expect(manual.explanation).toContain('ручной ввод')
    // Одно перекрытие: cos φ задан, kс — из справочника.
    const half = circuitLoadMath(circuit({ power: 3500, kind: 'power', powerFactor: 0.5 }))
    expect(half.amps).toBeCloseTo((3500 * 0.8) / (230 * 0.5), 3)
    expect(half.factorSource).toBe('manual')
  })

  it('заявленный ток приоритетен, пустая линия — недостаточно данных', () => {
    const stated = circuitLoadMath(circuit({ current: 16, power: 3500, kind: 'power' }))
    expect(stated.basis).toBe('stated')
    expect(stated.amps).toBe(16)
    expect(stated.status).toBe('stated')
    expect(stated.explanation).toContain('вручную')

    const silent = circuitLoadMath(circuit())
    expect(silent.basis).toBe('insufficient')
    expect(silent.amps).toBe(0)
    expect(silent.status).toBe('insufficient')
  })

  it('вид линии без записи в схеме читается как розеточный', () => {
    // Объект без kind (например, из старого кода до нормализации) — не повод падать.
    const legacy = circuitLoadMath({ current: 0, power: 4600, phaseCount: 1 })
    expect(legacy.kindLabel).toBe('Розетки')
    expect(legacy.amps).toBeCloseTo((4600 * 0.8) / (230 * 0.95), 3)
  })
})
