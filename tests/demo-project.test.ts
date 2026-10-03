import { describe, expect, it } from 'vitest'
import { demoProject } from '../src/data/demoProject'
import { workspaceCatalog } from '../src/data/catalog'
import { getEnclosureMinimum, getFreeSlots, getRowCapacity, getRowUsage } from '../src/domain/layout'
import { buildBom } from '../src/domain/pricing'
import { phaseBalance } from '../src/domain/electrical'
import { validateProject } from '../src/domain/validation'

/**
 * The demo is a fixture of the *working* catalogue, not of the full generated one. It used to name
 * ENMAS/CHINT positions that the workspace does not load, which made every device on the demo
 * board render as a missing product — the fixture had drifted from the app it was supposed to
 * demonstrate. This test is what would have caught that.
 */
const definitions = new Map(workspaceCatalog.map((product) => [product.id, product]))

describe('read-only demo project fixture', () => {
  it('names only positions the workspace can actually resolve', () => {
    const products = demoProject.devices.map((device) => definitions.get(device.productId))
    expect(products.every(Boolean)).toBe(true)
    expect(demoProject.devices.some((device) => device.productId.includes('city9'))).toBe(false)
    expect(demoProject.devices.some((device) => device.productId.includes('nb1-63dc'))).toBe(false)
  })

  it('wires every circuit on all three buses', () => {
    for (const circuit of demoProject.circuits) {
      const buses = demoProject.connections.filter((item) => item.circuitId === circuit.id).map((item) => item.fromBus)
      expect([...new Set(buses)].sort()).toEqual(['L', 'N', 'PE'])
    }
    // At least one connection leaves a device rather than the busbar, so the cascade routing has a
    // fixture of its own.
    expect(demoProject.connections.some((item) => item.fromDeviceId)).toBe(true)
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
    const qfiLine = lines.find((line) => line.productId === 'ekf-rcbo-1p-c16')
    expect(qfiLine?.quantity).toBe(3)
    expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(demoProject.devices.length)
    // Prices are the catalogue's, never computed here. The single position with no confirmed price
    // has to stay unknown rather than become zero, because zero reads as "free".
    for (const line of lines) {
      expect(line.unitPrice).toBe(definitions.get(line.productId)?.price ?? 0)
    }
    const unknown = lines.filter((line) => !line.priceKnown)
    expect(unknown.map((line) => line.productId)).toEqual(['ekf-spd-t1-2p'])
    expect(unknown.every((line) => line.unitPrice === 0 && line.total === 0)).toBe(true)
  })

  it('has no critical layout or circuit validation issues', () => {
    const issues = validateProject(demoProject, definitions)
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(issues.filter((issue) => issue.level === 'warning')).toEqual([])
    // One position in the working catalogue has no confirmed price, so the demo reports exactly
    // that. It is information, not a defect: the alternative would be a made-up number.
    expect(issues.map((issue) => issue.ruleCode)).toEqual(['calculation.preliminary'])
    expect(issues[0]!.message).toContain('уточняется')
    expect(phaseBalance(demoProject, definitions)).toMatchObject({ totals: [38, 0, 0], spread: 0 })
  })
})
