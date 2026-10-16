import type { DeviceDefinition, VerificationStatus } from './types'

type VerificationSubject = Pick<DeviceDefinition, 'imported'> & { verificationStatus?: VerificationStatus }

/**
 * The single provenance ladder used by the catalogue, the BOM and the print report.
 * Branch order matters: an imported stub with a template flag reads as an import, a
 * verified status always wins, and a missing status is "not stated" — the built-in
 * catalogue carries no status field, and calling real products historical would be untrue.
 */
export const verificationLabel = (product: VerificationSubject | null | undefined): string => {
  if (!product) return 'Статус не указан'
  if (product.verificationStatus === 'verified') return 'Подтверждено'
  if (product.imported) return 'Импорт, не проверено'
  if (product.verificationStatus === 'template') return 'Шаблон'
  if (product.verificationStatus === 'legacy') return 'Исторические данные'
  return 'Статус не указан'
}
