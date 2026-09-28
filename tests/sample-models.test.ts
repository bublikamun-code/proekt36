import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enmasSeriesCatalog, sampleCatalog } from '../src/data/catalog'
import { embeddedModelById } from '../src/data/models'

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

  it('binds both samples to pre-oriented embedded CAD models', () => {
    const onePole = sampleCatalog.find((item) => item.id === 'city9-mcb-1p-c16')
    const twoPole = sampleCatalog.find((item) => item.id === 'city9-mcb-2p-c16')
    expect(twoPole?.modelId).toBe('city9-mcb-2p')
    const asset = twoPole?.modelId ? embeddedModelById.get(twoPole.modelId) : undefined
    expect(asset).toMatchObject({ source: 'embedded', url: '/models/city9-mcb-2p.glb', format: 'glb' })
    // The GLB is baked with height on +Y and the face toward +Z, so the stage adds no rotation.
    expect(asset?.transform.rotationY).toBe(0)
    expect(onePole?.modelId).toBe('city9-mcb-1p')
    expect(existsSync(modelPath)).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'public/models/city9-mcb-1p.glb'))).toBe(true)
    expect(statSync(modelPath).size).toBeGreaterThan(1_000_000)
  })

  it('never references an embedded model that the manifest does not declare', () => {
    const declared = new Set(embeddedModelById.keys())
    for (const product of sampleCatalog) {
      if (product.modelId) expect(declared.has(product.modelId)).toBe(true)
    }
  })
})
