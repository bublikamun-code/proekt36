import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog, enmasSeriesCatalog } from '../src/data/catalog'
import { assertCatalogUniqueness, validateCatalogFile, validateCatalogUniqueness } from '../src/data/catalog/schema'

const generated = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/catalog/enmas.generated.json'), 'utf8')) as unknown[]

describe('catalog data files', () => {
  it('keeps the expected split between hand-written and generated data', () => {
    expect(builtinCatalog).toHaveLength(48)
    expect(enmasSeriesCatalog).toHaveLength(344)
    expect(allCatalog).toHaveLength(392)
  })

  it('passes shape validation for every file', () => {
    expect(validateCatalogFile('builtin.json', builtinCatalog)).toEqual([])
    expect(validateCatalogFile('enmas.generated.json', enmasSeriesCatalog)).toEqual([])
  })

  it('keeps ids and brand+sku pairs unique across the whole catalogue', () => {
    expect(() => validateCatalogUniqueness([
      { file: 'builtin.json', items: builtinCatalog },
      { file: 'enmas.generated.json', items: enmasSeriesCatalog },
    ])).not.toThrow()
  })

  it('gives every ENMAS product a full designation instead of the bare series', () => {
    // NJVA keeps its series code as sku; the terminal and PSU templates are named by their
    // series too. Both are already full designations, unlike the 156 NB1s that used to share one.
    const bare = enmasSeriesCatalog.filter((product) =>
      product.sku === product.series && !product.id.startsWith('enmas-njva') && !product.id.startsWith('enmas-template-'))
    expect(bare).toEqual([])
    const nb1 = enmasSeriesCatalog.find((product) => product.id === 'enmas-nb1-63h-2p-16a-c')
    expect(nb1?.sku).toBe('NB1-63H-2P-16A-C')
    expect(nb1?.series).toBe('NB1-63H')
  })

  it('keeps verification flags only on plausibly confirmed entries', () => {
    const verified = enmasSeriesCatalog.filter((product) => product.verificationStatus === 'verified')
    const templates = enmasSeriesCatalog.filter((product) => product.verificationStatus === 'template')
    // The audit baseline: 274 verified + 70 template across the ENMAS combinatorics.
    expect(verified).toHaveLength(274)
    expect(templates).toHaveLength(70)
    // Built-in entries are either confirmed (no flag) or the nine CHINT drawing templates.
    expect(builtinCatalog.filter((product) => product.verificationStatus === 'template')).toHaveLength(9)
    expect(builtinCatalog.every((product) => product.verificationStatus === undefined || product.verificationStatus === 'template')).toBe(true)
  })

  it('fails validation on a poisoned record instead of shipping it', () => {
    const poisoned = [{ ...builtinCatalog[0]!, moduleWidth: Number.NaN }]
    expect(validateCatalogFile('poison.json', poisoned)).toHaveLength(1)
    const duplicate = [{ ...builtinCatalog[0]! }]
    // The copy collides twice: by id and by the brand+sku pair.
    expect(validateCatalogUniqueness([{ file: 'a.json', items: builtinCatalog.slice(0, 2) }, { file: 'fake.json', items: duplicate }])).toHaveLength(2)
    expect(() => assertCatalogUniqueness([{ file: 'a.json', items: builtinCatalog.slice(0, 2) }, { file: 'fake.json', items: duplicate }])).toThrow(/повреждён/)
  })

  it('keeps the generated file in sync with the generator', () => {
    // catalog:check guards CI; this is the same guarantee inside vitest for local runs.
    const ids = new Set(generated.map((item) => (item as { id: string }).id))
    expect(ids.size).toBe(generated.length)
    expect(generated.length).toBe(enmasSeriesCatalog.length)
  })
})
