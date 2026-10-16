import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog, referenceCatalog, enmasSeriesCatalog } from '../src/data/catalog'
import { VERIFICATION_LABELS, claimsASource, verificationLabel } from '../src/domain/provenance'
import type { VerificationStatus } from '../src/domain/types'

const STATUSES = Object.keys(VERIFICATION_LABELS) as VerificationStatus[]

describe('происхождение позиций каталога', () => {
  it('статус позиции — либо допустимый, либо отсутствует как «никто не смотрел»', () => {
    for (const product of allCatalog) {
      if (product.verificationStatus !== undefined) {
        expect(STATUSES, `${product.id}: неизвестный статус ${product.verificationStatus}`).toContain(product.verificationStatus)
      }
    }
  })

  it('легаси-справочник помечен целиком, паспортные позиции легаси не содержат', () => {
    expect(referenceCatalog.length).toBeGreaterThan(20)
    expect(referenceCatalog.every((product) => product.verificationStatus === 'legacy')).toBe(true)
    expect(builtinCatalog.every((product) => product.verificationStatus !== 'legacy')).toBe(true)
  })

  it('непроверенные позиции не ссылаются на источник', () => {
    // Никто не читал страницу — ссылка на неё была бы заявлением, которое каталог
    // не может поддержать. Шаблонная позиция вправе указать серию-источник.
    for (const product of allCatalog) {
      const status = product.verificationStatus ?? 'unverified'
      if (!claimsASource(status)) {
        expect(product.sourceUrl, `${product.id} заявляет источник, хотя параметры не проверялись`).toBeUndefined()
      }
    }
    expect(enmasSeriesCatalog.some((product) => product.verificationStatus === 'template')).toBe(true)
  })

  it('формулировка статуса одна и та же во всех местах', () => {
    // Раньше четыре компонента держали свою копию этого switch и разъехались.
    expect(VERIFICATION_LABELS.verified).toBe('Подтверждено')
    expect(VERIFICATION_LABELS.unverified).toBe('Параметры не подтверждены')
    expect(verificationLabel('unverified', { sentence: true })).toBe('параметры не подтверждены')
    // Отсутствие статуса означает то же, что и явно указанный непроверенный.
    expect(verificationLabel(undefined, { sentence: true })).toBe('параметры не подтверждены')
    expect(VERIFICATION_LABELS.legacy).toBe('Исторические данные')
  })
})
