import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog, enmasSeriesCatalog, sampleCatalog } from '../src/data/catalog'
import { VERIFICATION_LABELS, claimsASource, verificationLabel } from '../src/domain/provenance'
import type { VerificationStatus } from '../src/domain/types'

const STATUSES = Object.keys(VERIFICATION_LABELS) as VerificationStatus[]

describe('происхождение позиций каталога', () => {
  it('у каждой позиции есть статус, а не «статус не указан»', () => {
    for (const product of allCatalog) {
      expect(product.verificationStatus, `${product.id} без verificationStatus`).toBeTruthy()
      expect(STATUSES, `${product.id}: неизвестный статус ${product.verificationStatus}`).toContain(product.verificationStatus)
    }
  })

  it('встроенные позиции помечены как непроверенные, а не как исторические', () => {
    // They are real products; calling them historical would be untrue. What is true is that
    // their parameters were never compared against a datasheet.
    expect(builtinCatalog.every((product) => product.verificationStatus === 'unverified')).toBe(true)
  })

  it('непроверенные позиции не ссылаются на источник', () => {
    // Nobody read a page for these, so pointing at one would be a claim the catalogue cannot
    // support. A template row may legitimately point at the series it was generated from.
    for (const product of allCatalog) {
      if (!claimsASource(product.verificationStatus)) {
        expect(product.sourceUrl, `${product.id} заявляет источник, хотя параметры не проверялись`).toBeUndefined()
      }
    }
    expect(allCatalog.some((product) => product.verificationStatus === 'verified' && product.sourceUrl)).toBe(true)
    expect(allCatalog.some((product) => product.verificationStatus === 'template' && product.sourceUrl)).toBe(true)
  })

  it('шаблонные позиции отличаются от проверенных статусом, а не только названием', () => {
    expect(enmasSeriesCatalog.some((product) => product.verificationStatus === 'template')).toBe(true)
    expect(enmasSeriesCatalog.some((product) => product.verificationStatus === 'verified')).toBe(true)
    expect(sampleCatalog.every((product) => product.verificationStatus === 'template')).toBe(true)
  })

  it('формулировка статуса одна и та же во всех местах', () => {
    // Four components used to carry their own copy of this switch and had drifted apart.
    expect(VERIFICATION_LABELS.verified).toBe('Подтверждено')
    expect(VERIFICATION_LABELS.unverified).toBe('Параметры не подтверждены')
    expect(verificationLabel('unverified', { sentence: true })).toBe('параметры не подтверждены')
    // A missing status means the same thing as an explicitly unverified one.
    expect(verificationLabel(undefined)).toBe(VERIFICATION_LABELS.unverified)
    // `sentence` is for a cell that runs on inside a sentence («шаблон · источник указан»).
    expect(verificationLabel('template', { sentence: true })).toBe('шаблон')
  })
})
