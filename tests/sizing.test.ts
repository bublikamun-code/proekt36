import { describe, expect, it } from 'vitest'
import { BREAKER_RATINGS_A, suggestCable, suggestProtection } from '../src/domain/sizing'

describe('подбор защиты', () => {
  it('берёт ближайший номинал ряда не ниже расчётного тока', () => {
    const suggestion = suggestProtection((3500 * 0.8) / (230 * 0.95), 'power')
    expect(suggestion.status).toBe('preliminary')
    expect(suggestion.ratingA).toBe(16)
    expect(suggestion.curve).toBe('C')
    expect(suggestion.explanation).toContain('16')
  })

  it('розеткам даёт характеристику C, свету и управлению — B', () => {
    expect(suggestProtection(14, 'power').curve).toBe('C')
    expect(suggestProtection(3.8, 'light').curve).toBe('B')
    expect(suggestProtection(2, 'control').curve).toBe('B')
    expect(suggestProtection(5, 'dc').curve).toBe('B')
  })

  it('не опускает номинал ниже практического минимума вида линии', () => {
    // Холодильник в 1,46 А не делает розеточную линию линией на 6 А: минимум розеток — 16 А.
    const fridge = suggestProtection((400 * 0.8) / (230 * 0.95), 'power')
    expect(fridge.ratingA).toBe(16)
    expect(fridge.explanation).toContain('минимума 16')
    // Свету хватает его собственного минимума: 3,78 А → 6 А без оговорки.
    expect(suggestProtection(800 / (230 * 0.92), 'light').ratingA).toBe(6)
    expect(suggestProtection(800 / (230 * 0.92), 'light').explanation).not.toContain('минимума')
  })

  it('без тока и за пределами ряда честно отказывается', () => {
    expect(suggestProtection(0, 'power').status).toBe('insufficient')
    expect(suggestProtection(-3, 'power').status).toBe('insufficient')
    const beyond = suggestProtection(130, 'power')
    expect(beyond.status).toBe('insufficient')
    expect(beyond.ratingA).toBeUndefined()
    expect(beyond.explanation).toContain('специалистом')
  })

  it('держит непрерывность ряда: каждый номинал не меньше предыдущего', () => {
    for (let index = 1; index < BREAKER_RATINGS_A.length; index += 1) {
      expect(BREAKER_RATINGS_A[index]!).toBeGreaterThan(BREAKER_RATINGS_A[index - 1]!)
    }
  })
})

describe('подбор сечения кабеля', () => {
  it('розеточная линия начинается с монтажного минимума 2,5 мм² и держит номинал защиты', () => {
    // Расчётный 12,8 А, защита 16 А: по таблице хватило бы 1,5 мм² (24 А), но розетки
    // не тоньше 2,5 мм². Без длины падение честно не проверено.
    const suggestion = suggestCable({ amps: (3500 * 0.8) / (230 * 0.95), ratingA: 16, lengthM: 0, system: 1, kind: 'power' })
    expect(suggestion.status).toBe('preliminary')
    expect(suggestion.sectionMm2).toBe(2.5)
    expect(suggestion.dropChecked).toBe(false)
    expect(suggestion.explanation).toContain('не задана')
  })

  it('свет укладывается в 1,5 мм² по таблице', () => {
    const suggestion = suggestCable({ amps: 800 / (230 * 0.92), ratingA: 6, lengthM: 0, system: 1, kind: 'light' })
    expect(suggestion.sectionMm2).toBe(1.5)
  })

  it('шагает по ряду вверх, пока падение не уложится в 4 %', () => {
    // 40 А, защита 40 А, 60 м, 1ф: 4 мм² дают 2·60·40·0,0175/4 = 21 В (9,1 %),
    // 6 мм² — 14 В (6,1 %), 10 мм² — 8,4 В (3,65 %) — годится.
    const suggestion = suggestCable({ amps: 40, ratingA: 40, lengthM: 60, system: 1, kind: 'power' })
    expect(suggestion.status).toBe('preliminary')
    expect(suggestion.sectionMm2).toBe(10)
    expect(suggestion.dropChecked).toBe(true)
    expect(suggestion.dropPercent).toBeLessThan(4)
    expect(suggestion.explanation).toContain('падению')
  })

  it('выше таблицы падения и без обоих токов отказывается, а не угадывает', () => {
    // Без расчётного тока, но с номиналом защиты кабель всё ещё можно предложить —
    // защита не должна жечь кабель даже на неизвестной нагрузке.
    expect(suggestCable({ amps: 0, ratingA: 16, lengthM: 10, system: 1 }).sectionMm2).toBe(2.5)
    expect(suggestCable({ amps: 0, ratingA: undefined, lengthM: 10, system: 1 }).status).toBe('insufficient')
    expect(suggestCable({ amps: 700, ratingA: undefined, lengthM: 5, system: 1 }).status).toBe('insufficient')
  })

  it('длина трассы входит в условие: короткая линия остаётся на базовом сечении', () => {
    // Те же 40 А на 12 м: 4 мм² дают 4,2 В (1,83 %) — рост сечения не нужен.
    const suggestion = suggestCable({ amps: 40, ratingA: 40, lengthM: 12, system: 1, kind: 'power' })
    expect(suggestion.sectionMm2).toBe(4)
    expect(suggestion.dropChecked).toBe(true)
  })

  it('трёхфазная линия платит √3 за длину, а не двойную', () => {
    // 25 А, 3ф, 50 м: 2,5 мм² → √3·50·25·0,0175/2,5 = 15,2 В (3,79 %) — в лимите.
    const suggestion = suggestCable({ amps: 25, ratingA: 25, lengthM: 50, system: 3, kind: 'power' })
    expect(suggestion.sectionMm2).toBe(2.5)
    expect(suggestion.dropPercent).toBeCloseTo((Math.sqrt(3) * 50 * 25 * 0.0175 / 2.5 / 400) * 100, 2)
  })
})
