import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enmasSeriesCatalog, sampleCatalog } from '../src/data/catalog'

const modelPath = resolve(process.cwd(), 'public/models/city9-mcb-2p.glb')

 describe('City9 test model catalog', () => {
  it('keeps City9 samples separate from the official ENMAS series', () => {
    expect(sampleCatalog.map((item) => item.id)).toEqual(['city9-mcb-1p-c16', 'city9-mcb-2p-c16'])
    expect(sampleCatalog.every((item) => item.brand.includes('тестовый'))).toBe(true)
    expect(enmasSeriesCatalog.some((item) => item.id.startsWith('city9-'))).toBe(false)
  })

  it('keeps explicit physical module widths', () => {
    expect(sampleCatalog.map((item) => item.moduleWidth)).toEqual([1, 2])
    expect(sampleCatalog.map((item) => item.poles)).toEqual([1, 2])
  })

  it('bundles the real 2P STEP-derived GLB for the 2D preview', () => {
    const twoPole = sampleCatalog.find((item) => item.id === 'city9-mcb-2p-c16')
    expect(twoPole?.modelPreviewUrl).toBe('/models/city9-mcb-2p.glb')
    expect(twoPole?.modelPreviewRotationY).toBe(-Math.PI / 2)
    expect(existsSync(modelPath)).toBe(true)
    expect(statSync(modelPath).size).toBeGreaterThan(1_000_000)
  })
})
