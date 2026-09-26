import { describe, expect, it } from 'vitest'
import { builtinCatalog } from '../src/data/catalog'
import { bomToCsv, buildBom, pricing } from '../src/domain/pricing'
import { createDevice } from '../src/domain/project'
import type { DeviceDefinition } from '../src/domain/types'

const definitions = new Map(builtinCatalog.map((item) => [item.id, item]))
const base = definitions.get('ekf-mcb-1p-c6')!

describe('pricing and BOM', () => {
  it('groups identical products and multiplies quantity', () => {
    const one = { ...base } as DeviceDefinition
    const map = new Map([[one.id, one]])
    const a = { ...createDevice(one, 0, 0), quantity: 2 }
    const b = { ...createDevice(one, 0, 3), quantity: 3 }
    const bom = buildBom([a, b], map)
    expect(bom).toHaveLength(1)
    expect(bom[0]!.quantity).toBe(5)
    expect(bom[0]!.total).toBe(1240)
  })

  it('sums total cost and installed mass', () => {
    const item = createDevice(base, 0, 0)
    const result = pricing([item], definitions)
    expect(result.total).toBe(248)
    expect(result.mass).toBeCloseTo(0.12)
  })
})

describe('CSV export', () => {
  const named = (name: string): DeviceDefinition => ({ ...base, id: `p-${name}`, name })
  const csvFor = (name: string) => bomToCsv([createDevice(named(name), 0, 0)], new Map([[`p-${name}`, named(name)]]))

  it('neutralises a cell a spreadsheet would evaluate as a formula', () => {
    // TAB, CR and a leading space are stripped by spreadsheets before they decide
    // whether a cell is a formula, so the guard has to see through them too. The
    // quote goes in front of the original text, which keeps the value readable.
    for (const attempt of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1', ' =1+1']) {
      expect(csvFor(attempt)).toContain(`"'${attempt}"`)
    }
  })

  it('keeps an ordinary product name readable', () => {
    const csv = csvFor('AVO-10 1P C6')
    expect(csv).toContain('"AVO-10 1P C6"')
    expect(csv).not.toContain("'AVO")
  })

  it('escapes embedded quotes so the row keeps its column count', () => {
    expect(csvFor('Гнездо "тип" X')).toContain('"Гнездо ""тип"" X"')
  })

  it('marks an unknown price as needing confirmation instead of exporting a zero', () => {
    const free = { ...base, id: 'p-free', name: 'Без цены', price: 0 }
    const csv = bomToCsv([createDevice(free, 0, 0)], new Map([['p-free', free]]))
    expect(csv).toContain('уточняется')
  })
})
