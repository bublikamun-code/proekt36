import { describe, expect, it } from 'vitest'
import { deviceTerminals, terminalColumns, terminalKey, terminalLabel } from '../src/domain/terminals'
import { builtinCatalog } from '../src/data/catalog'
import type { DeviceDefinition } from '../src/domain/types'

const product = (patch: Partial<DeviceDefinition>): DeviceDefinition => ({
  id: 'test', name: 'Тест', brand: 'Тест', sku: 'T-1', category: 'MCB', moduleWidth: 1, poles: 1,
  ratedCurrent: 16, voltage: 230, bus: 'L', price: 0, weight: 0, height: 82, depth: 70,
  ...patch,
})

describe('terminalColumns', () => {
  it('gives a 1P breaker one column per side', () => {
    expect(terminalColumns(product({ category: 'MCB', moduleWidth: 1, poles: 1 }))).toBe(1)
  })

  it('gives a 1P+N RCCB two columns so the N pole gets its own clamp', () => {
    expect(terminalColumns(product({ category: 'RCCB', moduleWidth: 2, poles: 1 }))).toBe(2)
  })

  it('gives a 3P breaker three columns', () => {
    expect(terminalColumns(product({ category: 'MCB', moduleWidth: 3, poles: 3 }))).toBe(3)
  })

  it('draws no clamps on a busbar or a terminal block', () => {
    expect(terminalColumns(product({ category: 'busbar', moduleWidth: 12, poles: 1 }))).toBe(0)
    expect(terminalColumns(product({ category: 'terminals', moduleWidth: 1, poles: 1 }))).toBe(0)
  })
})

describe('terminalLabel', () => {
  it('numbers a 1P breaker 1 over 2', () => {
    expect(terminalLabel(product({ category: 'MCB', moduleWidth: 1, poles: 1 }), 0, 1, false)).toBe('1')
    expect(terminalLabel(product({ category: 'MCB', moduleWidth: 1, poles: 1 }), 0, 1, true)).toBe('2')
  })

  it('marks the N pole of a 1P+N RCCB as N, not as 2', () => {
    const rccb = product({ category: 'RCCB', moduleWidth: 2, poles: 1 })
    expect(terminalLabel(rccb, 0, 2, false)).toBe('1')
    expect(terminalLabel(rccb, 1, 2, false)).toBe('N')
    expect(terminalLabel(rccb, 0, 2, true)).toBe('3')
    expect(terminalLabel(rccb, 1, 2, true)).toBe('4')
  })

  it('interleaves 1/3/5 over 2/4/6 on a three-pole breaker', () => {
    const mcb = product({ category: 'MCB', moduleWidth: 3, poles: 3 })
    expect([0, 1, 2].map((column) => terminalLabel(mcb, column, 3, false))).toEqual(['1', '3', '5'])
    expect([0, 1, 2].map((column) => terminalLabel(mcb, column, 3, true))).toEqual(['2', '4', '6'])
  })
})

describe('deviceTerminals', () => {
  it('lists the top row before the bottom one', () => {
    const terminals = deviceTerminals(product({ category: 'MCB', moduleWidth: 3, poles: 3 }))
    expect(terminals.map((item) => `${item.label}${item.side === 'top' ? '↑' : '↓'}`))
      .toEqual(['1↑', '3↑', '5↑', '2↓', '4↓', '6↓'])
  })

  it('types the N pole as neutral so a phase wire cannot land on it', () => {
    const terminals = deviceTerminals(product({ category: 'RCCB', moduleWidth: 2, poles: 1 }))
    expect(terminals.find((item) => item.label === 'N')?.type).toBe('neutral')
    expect(terminals.find((item) => item.label === '1')?.type).toBe('phase')
  })

  it('keeps the N pole of a PSU out of the phase group', () => {
    const terminals = deviceTerminals(product({ category: 'PSU', moduleWidth: 2, poles: 2 }))
    expect(terminals.filter((item) => item.type === 'neutral').map((item) => item.label)).toEqual(['N', 'N'])
  })

  it('returns nothing for a busbar', () => {
    expect(deviceTerminals(product({ category: 'busbar', moduleWidth: 12, poles: 1 }))).toEqual([])
  })

  it('covers every catalogue breaker without a missing pole', () => {
    const definitions = new Map(builtinCatalog.map((item) => [item.id, item]))
    for (const item of definitions.values()) {
      if (item.category !== 'MCB' && item.category !== 'RCCB' && item.category !== 'RCBO') continue
      const columns = terminalColumns(item)
      if (!columns) continue
      const terminals = deviceTerminals(item)
      expect(terminals, `${item.id} терминалы`).toHaveLength(columns * 2)
      expect(terminals.filter((item) => item.side === 'top')).toHaveLength(columns)
    }
  })
})

describe('terminalKey', () => {
  it('distinguishes the top and bottom clamps of one pole', () => {
    const deviceId = 'd1'
    expect(terminalKey({ deviceId, pole: 1, side: 'top' })).not.toBe(terminalKey({ deviceId, pole: 1, side: 'bottom' }))
  })
})
