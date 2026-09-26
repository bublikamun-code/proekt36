import { describe, expect, it } from 'vitest'
import { demoProject } from '../src/data/demoProject'
import { enmasSeriesCatalog } from '../src/data/catalog'
import { getEnclosureMinimum, getFreeSlots, getRowCapacity, getRowUsage } from '../src/domain/layout'
import { buildBom } from '../src/domain/pricing'
import { phaseBalance, validateProject } from '../src/domain/validation'

const definitions = new Map(enmasSeriesCatalog.map((product) => [product.id, product]))

describe('read-only demo project fixture', () => {
  it('uses only the explicitly supported ENMAS/CHINT catalog', () => {
    const products = demoProject.devices.map((device) => definitions.get(device.productId))
    expect(products.every(Boolean)).toBe(true)
    expect(products.every((product) => product?.brand === 'ENMAS / CHINT')).toBe(true)
    expect(demoProject.devices.some((device) => device.productId.includes('city9'))).toBe(false)
    expect(demoProject.devices.some((device) => device.productId.includes('nb1-63dc'))).toBe(false)
  })

  it('fits the selected 24-module enclosure and 12-module rail', () => {
    expect(demoProject.settings.cabinetId).toBe('enmas-nx8-24-embedded')
    expect(demoProject.settings.railId).toBe('rail-12')
    expect(getRowCapacity(demoProject)).toBe(12)
    expect(getRowUsage(0, demoProject, definitions)).toMatchObject({ used: 12, capacity: 12 })
    expect(getRowUsage(1, demoProject, definitions)).toMatchObject({ used: 3, capacity: 12 })
    expect(getFreeSlots(demoProject, definitions)).toBe(9)
    expect(getEnclosureMinimum(demoProject, definitions)).toMatchObject({ width: 310, height: 350 })
  })

  it('groups repeated devices in the preliminary BOM without inventing prices', () => {
    const lines = buildBom(demoProject.devices, definitions)
    const qfiLine = lines.find((line) => line.productId === 'enmas-nb1l-2p-16a-c-30ma')
    expect(qfiLine?.quantity).toBe(2)
    expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(demoProject.devices.length)
    expect(lines.every((line) => line.unitPrice === 0 && line.total === 0)).toBe(true)
  })

  it('has no critical layout or circuit validation issues', () => {
    const issues = validateProject(demoProject, definitions)
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(issues.filter((issue) => issue.level === 'warning')).toEqual([])
    expect(issues.some((issue) => issue.id === 'preliminary')).toBe(true)
    expect(phaseBalance(demoProject, definitions)).toMatchObject({ totals: [38, 0, 0], spread: 0 })
  })
})
