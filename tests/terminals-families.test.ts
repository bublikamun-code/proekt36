import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import {
  CHINT_FACE_HEIGHTS,
  CHINT_TERMINAL_SCREWS,
  FACE_MODULE_MM,
  WIRE_COLORS,
  chintFaceKind,
  deviceTerminals,
  facePlacementMm,
  faceSizeMm,
  genericFaceHeightMm,
  genericTerminalPockets,
  hasSharedToggle,
  sameTerminal,
  terminalAnchorMm,
  terminalColumnCenterMm,
  terminalColumnForPole,
  terminalDisplayName,
  terminalKey,
  usesChintPlatform,
  wireColor,
} from '../src/domain/terminals'
import type { ChintKind } from '../src/domain/terminals'
import type { DeviceDefinition } from '../src/domain/types'

const base: DeviceDefinition = {
  id: 'probe', name: 'Проба', brand: 'CHINT', sku: 'NB1-63/1P', category: 'MCB',
  moduleWidth: 1, poles: 1, ratedCurrent: 16, voltage: 230, bus: 'L',
  price: 0, weight: 0, height: 82, depth: 70,
}
const chint = (over: Partial<DeviceDefinition> = {}): DeviceDefinition => ({ ...base, ...over })

describe('семейства лиц CHINT', () => {
  it('выбирает чертёж по коду серии, а не по порядку в каталоге', () => {
    const cases: Array<[string, ChintKind]> = [
      ['NBH8LE-40/2P', 'nbh8le'],
      ['NBH8-63/3P', 'nbh8'],
      ['NB2LE-40/2P', 'nb2le'],
      ['NB1L-63/2P', 'nb1l40'],
      ['NB1L-40/4P', 'nb1l40'],
      ['NB1L-2P', 'nb1l'],
      ['NB310L-3P', 'nb310l'],
      ['NL1-40/2P', 'nl1'],
      ['NB1-63/1P', 'nb1'],
      ['', 'nb1'],
    ]

    for (const [series, kind] of cases) {
      expect(chintFaceKind(chint({ series }))).toBe(kind)
    }
  })

  it('читает код серии из артикула, когда отдельного поля нет', () => {
    expect(chintFaceKind(chint({ series: undefined, sku: 'nb2le-40/2p' }))).toBe('nb2le')
    expect(chintFaceKind(chint({ series: '', sku: 'NL1-40/1P' }))).toBe('nl1')
  })

  it('рисует аппарат на платформе CHINT только для автоматов, УЗО и дифавтоматов', () => {
    expect(usesChintPlatform(chint({ category: 'MCB' }))).toBe(true)
    expect(usesChintPlatform(chint({ category: 'RCCB' }))).toBe(true)
    expect(usesChintPlatform(chint({ category: 'RCBO' }))).toBe(true)
    expect(usesChintPlatform(chint({ category: 'SPD' }))).toBe(false)
    expect(usesChintPlatform(chint({ category: 'terminals' }))).toBe(false)
    expect(usesChintPlatform(chint({ brand: 'EKF', category: 'MCB' }))).toBe(false)
    expect(usesChintPlatform(chint({ brand: '', category: 'MCB' }))).toBe(false)
  })

  it('берёт высоту лица из таблицы чертёжей, а не из паспортной высены корпуса', () => {
    expect(faceSizeMm(chint({ series: 'NB1-63/1P', height: 82 })).heightMm).toBe(CHINT_FACE_HEIGHTS.nb1)
    expect(faceSizeMm(chint({ series: 'NB2LE-40/2P', height: 82 })).heightMm).toBe(CHINT_FACE_HEIGHTS.nb2le)
    // The generic chassis is the only one that follows the product's own height.
    expect(faceSizeMm(chint({ brand: 'EKF', height: 110 })).heightMm).toBe(110)
    expect(genericFaceHeightMm(chint({ brand: 'EKF', height: 10 }))).toBe(45)
    expect(genericFaceHeightMm(chint({ brand: 'EKF', height: 900 }))).toBe(260)
  })

  it('не рисует уже известную таблицу креплений и не теряет в ней семейство', () => {
    expect(new Set(Object.keys(CHINT_FACE_HEIGHTS))).toEqual(new Set(Object.keys(CHINT_TERMINAL_SCREWS)))
    for (const kind of Object.keys(CHINT_TERMINAL_SCREWS) as ChintKind[]) {
      const screws = CHINT_TERMINAL_SCREWS[kind]
      expect(screws.topMm).toBeGreaterThan(0)
      expect(screws.bottomMm).toBeGreaterThan(screws.topMm)
      expect(screws.bottomMm).toBeLessThan(CHINT_FACE_HEIGHTS[kind])
    }
  })

  it('выводит ширину лица из числа модулей, а неразобранную ширину считает одним модулем', () => {
    expect(faceSizeMm(chint({ moduleWidth: 4 })).widthMm).toBe(4 * FACE_MODULE_MM)
    // A product loaded from a half-written file can carry no width at all; the face still has to
    // be one module wide rather than zero, or the drawing collapses instead of rendering.
    expect(faceSizeMm(chint({ moduleWidth: 0 })).widthMm).toBe(FACE_MODULE_MM)
    expect(faceSizeMm(chint({ moduleWidth: Number.NaN })).widthMm).toBe(FACE_MODULE_MM)
  })
})

describe('посадка нарисованного лица в корпус', () => {
  it('вписывает лицо в бокс и центрирует остаток по обеим осям', () => {
    // A 36×90 mm box around a 2-module NB1 face (36×86 mm) is limited by its width, so the
    // face is drawn at 1:1 and the 4 mm left over above and below becomes a vertical margin.
    const product = chint({ moduleWidth: 2, series: 'NB1-63/2P' })
    const fit = facePlacementMm(product, 36, 90)

    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.offsetXMm).toBeCloseTo(0, 6)
    expect(fit.offsetYMm).toBeCloseTo(2, 6)
  })

  it('ужимает лицо по более тесной оси, а не растягивает его под бокс', () => {
    // A 54×86 mm three-pole face in a 40 mm wide box is limited by its width, so the leftover
    // height becomes a vertical margin; in a tall box the same face keeps its 1:1 width and the
    // leftover height is the whole difference.
    const product = chint({ moduleWidth: 3, poles: 3, series: 'NB1-63/3P' })
    const narrow = facePlacementMm(product, 40, 86)
    const tall = facePlacementMm(product, 90, 400)

    expect(narrow.scale).toBeCloseTo(40 / 54, 6)
    expect(narrow.offsetXMm).toBeCloseTo(0, 6)
    expect(narrow.offsetYMm).toBeCloseTo((86 - 86 * (40 / 54)) / 2, 6)
    expect(tall.scale).toBeCloseTo(90 / 54, 6)
    expect(tall.offsetYMm).toBeGreaterThan(100)
  })

  it('кладёт клемму на тот же screw, что и рисунок лица, с учётом посадки', () => {
    const product = chint({ moduleWidth: 3, poles: 3, series: 'NB1-63/3P' })
    const fit = facePlacementMm(product, 54, 90)
    // The three-pole face numbers its clamps 1/3/5 over 2/4/6, so poles 1 and 3 are the top row.
    const first = terminalAnchorMm(product, 1, 'top')!
    const third = terminalAnchorMm(product, 3, 'top')!

    expect(first).toEqual({ x: 9, y: CHINT_TERMINAL_SCREWS.nb1.topMm })
    expect(third.x).toBe(27)
    expect(fit.offsetYMm + first.y * fit.scale).toBeLessThan(90)
  })

  it('разводит клеммы соседних полюсов и не накладывает их', () => {
    const product = chint({ moduleWidth: 4, poles: 4, series: 'NB1-63/4P' })
    // Above four columns the markings interleave, so the top row carries poles 1, 3, 5 and 7.
    const xs = [1, 3, 5, 7].map((pole) => terminalAnchorMm(product, pole, 'top')!.x)

    expect(new Set(xs).size).toBe(4)
    expect([...xs].sort((left, right) => left - right)).toEqual(xs)
  })

  it('не уводит клемму спаренного рычага за пределы лица', () => {
    // A 1P+N device is one module wider than its pole count, so the terminal model counts more
    // columns than the device has poles. Anchoring on the pole pitch drops the extra columns off
    // the right-hand edge of the face, and a wire drawn there ends in mid-air.
    const linked = chint({ category: 'RCBO', moduleWidth: 4, poles: 2, series: 'NB1L-40/2P' })
    const face = faceSizeMm(linked)
    const xs = deviceTerminals(linked).map((info) => terminalAnchorMm(linked, info.pole, info.side)!.x)

    expect(xs).toHaveLength(8)
    expect(Math.max(...xs)).toBeLessThan(face.widthMm)
    expect(Math.min(...xs)).toBeGreaterThan(0)
    expect(new Set(xs).size).toBe(4)
  })

  it('не рисует клемму на шине и на зажимном блоке — их подключают не к винту', () => {
    expect(terminalAnchorMm(chint({ category: 'busbar', moduleWidth: 12 }), 1, 'top')).toBeNull()
    expect(terminalAnchorMm(chint({ category: 'terminals', moduleWidth: 6 }), 1, 'top')).toBeNull()
  })

  it('сажает винты в карманы, которые остаются внутри корпуса', () => {
    const pockets = genericTerminalPockets(FACE_MODULE_MM, 82, 2)

    for (const rect of [pockets.top, pockets.bottom]) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(FACE_MODULE_MM)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.y + rect.height).toBeLessThanOrEqual(82)
    }
    expect(pockets.screw.topY).toBeGreaterThan(pockets.top.y)
    expect(pockets.screw.topY).toBeLessThan(pockets.top.y + pockets.top.height)
    expect(pockets.screw.bottomY).toBeGreaterThan(pockets.bottom.y)
    expect(pockets.screw.bottomY).toBeLessThan(pockets.bottom.y + pockets.bottom.height)
  })

  it('не сжимает карман до нечитаемого размера на одноместном аппарате', () => {
    const narrow = genericTerminalPockets(FACE_MODULE_MM, 82, 4)
    const wide = genericTerminalPockets(4 * FACE_MODULE_MM, 82, 4)

    expect(narrow.top.width).toBeGreaterThan(0)
    expect(wide.top.width).toBeGreaterThan(narrow.top.width)
  })
})

describe('адресация клемм', () => {
  const threePole = chint({ moduleWidth: 3, poles: 3, series: 'NB1-63/3P' })

  it('находит колонку клеммы на обоих рядах, а не только на верхнем', () => {
    // On a 3P breaker the top row reads 1/3/5 and the bottom 2/4/6, so looking only at the top
    // would send a wire to the bottom pole 2 to the column of the top pole 2 — which is 3.
    expect(terminalColumnForPole(threePole, 1)).toBe(0)
    expect(terminalColumnForPole(threePole, 3)).toBe(1)
    expect(terminalColumnForPole(threePole, 5)).toBe(2)
    expect(terminalColumnForPole(threePole, 2)).toBe(0)
    expect(terminalColumnForPole(threePole, 4)).toBe(1)
    expect(terminalColumnForPole(threePole, 6)).toBe(2)
  })

  it('находит колонку нулевой клеммы 1P+N по её маркировке N', () => {
    const rccb = chint({ category: 'RCCB', moduleWidth: 2, poles: 1, series: 'NB1LE-40/2P' })

    expect(terminalColumnForPole(rccb, 0)).toBe(1)
    expect(deviceTerminals(rccb).map((item) => item.label)).toContain('N')
  })

  it('зажимает номер вне диапазона в крайнюю колонку, а не выдаёт избыточный модуль', () => {
    expect(terminalColumnForPole(threePole, 0)).toBe(0)
    expect(terminalColumnForPole(threePole, 99)).toBe(2)
  })

  it('центрирует клемму в своей колонке нарисованного лица', () => {
    const product = chint({ moduleWidth: 4 })
    const face = faceSizeMm(product).widthMm
    const centres = [1, 2, 3, 4].map((pole) => terminalColumnCenterMm(product, pole, face))

    expect(centres).toEqual([face * 0.125, face * 0.375, face * 0.625, face * 0.875])
    // A pole the device does not have still has to land in a column, not off the face.
    expect(terminalColumnCenterMm(threePole, 99, face)).toBeCloseTo((face / 3) * 2.5, 6)
  })

  it('различает клеммы одного аппарата по стороне и номеру', () => {
    const top = { deviceId: 'qf01', pole: 1, side: 'top' as const }
    const bottom = { deviceId: 'qf01', pole: 1, side: 'bottom' as const }
    const other = { deviceId: 'qf02', pole: 1, side: 'top' as const }

    expect(terminalKey(top)).not.toBe(terminalKey(bottom))
    expect(terminalKey(top)).not.toBe(terminalKey(other))
    expect(sameTerminal(top, { ...top })).toBe(true)
    expect(sameTerminal(top, bottom)).toBe(false)
    expect(sameTerminal(undefined, top)).toBe(false)
    expect(sameTerminal(top, undefined)).toBe(false)
  })

  it('подписывает клемму адресом аппарата, а для нулевой пишет N', () => {
    expect(terminalDisplayName({ deviceId: 'qf01', pole: 3, side: 'top' }, 'QF01')).toBe('QF01:3 верх')
    expect(terminalDisplayName({ deviceId: 'qf01', pole: 0, side: 'bottom' }, 'QF01')).toBe('QF01:N низ')
    // An apparatus without an address still has to be nameable.
    expect(terminalDisplayName({ deviceId: 'abc', pole: 1, side: 'top' }, '')).toBe('abc:1 верх')
  })

  it('связывает рычаг с числом модулей только у автоматов, УЗО и дифавтоматов', () => {
    expect(hasSharedToggle(chint({ category: 'MCB', moduleWidth: 2, poles: 1 }))).toBe(true)
    expect(hasSharedToggle(chint({ category: 'MCB', moduleWidth: 1, poles: 1 }))).toBe(false)
    expect(hasSharedToggle(chint({ category: 'terminals', moduleWidth: 2, poles: 1 }))).toBe(false)
    expect(hasSharedToggle(chint({ category: 'MCB', moduleWidth: 3, poles: 0 }))).toBe(true)
  })
})

describe('цвет провода на схеме', () => {
  it('различает фазы, ноль и землю по тому, что несёт провод', () => {
    expect(wireColor({ fromBus: 'L', phase: 1 })).toBe(WIRE_COLORS.phase1)
    expect(wireColor({ fromBus: 'L', phase: 2 })).toBe(WIRE_COLORS.phase2)
    expect(wireColor({ fromBus: 'L', phase: 3 })).toBe(WIRE_COLORS.phase3)
    expect(wireColor({ fromBus: 'N' })).toBe(WIRE_COLORS.neutral)
    expect(wireColor({ fromBus: 'PE' })).toBe(WIRE_COLORS.pe)
    expect(wireColor({})).toBe(WIRE_COLORS.phase1)
  })

  it('уважает явный цвет цепи, но перемычку красит только её собственным цветом', () => {
    expect(wireColor({ fromBus: 'L', color: '#c65c3b' })).toBe('#c65c3b')
    expect(wireColor({ kind: 'jumper', color: '' })).toBe(WIRE_COLORS.jumper)
    expect(wireColor({ kind: 'busbar', color: '#aeb8b4' })).toBe('#aeb8b4')
  })
})

describe('каждый товар каталога', () => {
  const catalogue = allCatalog

  it('имеет конечные координаты клемм, когда рисуется на платформе CHINT или на общем корпусе', () => {
    const bad: string[] = []
    for (const product of catalogue) {
      const face = faceSizeMm(product)
      const boxWidth = product.moduleWidth * FACE_MODULE_MM
      const fit = facePlacementMm(product, boxWidth, face.heightMm)
      for (const info of deviceTerminals(product)) {
        const anchor = terminalAnchorMm(product, info.pole, info.side)
        if (!anchor) continue
        const x = fit.offsetXMm + anchor.x * fit.scale
        const y = fit.offsetYMm + anchor.y * fit.scale
        if (![x, y, face.widthMm, face.heightMm].every(Number.isFinite)) bad.push(`${product.id}:${info.pole}${info.side}`)
        if (x < -0.001 || y < -0.001 || x > boxWidth + 0.001 || y > face.heightMm + 0.001) {
          bad.push(`${product.id}:${info.pole}${info.side} вне корпуса`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('не рисует две клеммы с одинаковой маркировкой на одном аппарате', () => {
    const clashes = catalogue.flatMap((product) => {
      const seen = new Set<string>()
      return deviceTerminals(product)
        .filter((info) => {
          const key = `${info.side}:${info.label}`
          if (seen.has(key)) return true
          seen.add(key)
          return false
        })
        .map((info) => `${product.id}:${info.side}:${info.label}`)
    })

    expect(clashes).toEqual([])
  })
})
