import { DEVICE_CATEGORIES } from './types'
import type { Category, DeviceDefinition, VerificationStatus } from './types'

/** The JSON data files are edited by hand and generated; this is the shape gate between them. */
export interface CatalogIssue {
  file: string
  index: number
  id: string
  message: string
}

const STATUSES: readonly VerificationStatus[] = ['verified', 'unverified', 'template', 'legacy']

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** Collects every violated invariant; an empty list means the file may enter the bundle. */
export const validateCatalogFile = (file: string, items: unknown[]): CatalogIssue[] => {
  const issues: CatalogIssue[] = []
  items.forEach((item, index) => {
    const product = item as Partial<DeviceDefinition>
    const id = typeof product.id === 'string' ? product.id : ''
    const reject = (message: string) => issues.push({ file, index, id, message })
    if (!isText(product.id)) reject('пустой id')
    if (!isText(product.name)) reject('пустое имя')
    if (!isText(product.brand)) reject('пустой бренд')
    if (typeof product.sku !== 'string' || !product.sku.trim()) reject('пустой артикул')
    if (!(DEVICE_CATEGORIES as readonly string[]).includes(String(product.category))) reject(`неизвестная категория ${String(product.category)}`)
    if (!isNumber(product.moduleWidth, 0.5, 24)) reject('moduleWidth вне 0.5–24')
    if (!isNumber(product.poles, 1, 12) || !Number.isInteger(product.poles)) reject('poles должен быть целым 1–12')
    if (!isNumber(product.ratedCurrent, 0.1, 10_000)) reject('ratedCurrent вне диапазона')
    if (product.voltage !== 230 && product.voltage !== 400) reject('voltage только 230 или 400')
    if (product.bus !== 'L' && product.bus !== 'N' && product.bus !== 'PE') reject('bus только L, N или PE')
    if (!isNumber(product.price, 0, 10_000_000)) reject('price вне диапазона')
    if (!isNumber(product.weight, 0, 1000)) reject('weight вне диапазона')
    if (!isNumber(product.height, 1, 2000)) reject('height вне диапазона')
    if (!isNumber(product.depth, 1, 2000)) reject('depth вне диапазона')
    if (product.verificationStatus !== undefined && !STATUSES.includes(product.verificationStatus)) reject('недопустимый verificationStatus')
    if (product.modelId !== undefined && !isText(product.modelId)) reject('пустой modelId')
    if (product.tripCurve !== undefined && !['B', 'C', 'D'].includes(product.tripCurve)) reject('кривая только B, C, D')
  })
  return issues
}

export const validateCatalogUniqueness = (files: Array<{ file: string; items: DeviceDefinition[] }>): CatalogIssue[] => {
  const issues: CatalogIssue[] = []
  const ids = new Map<string, string>()
  const skus = new Map<string, string>()
  for (const { file, items } of files) {
    items.forEach((product, index) => {
      const knownId = ids.get(product.id)
      if (knownId) issues.push({ file, index, id: product.id, message: `id повторяет файл ${knownId}` })
      else ids.set(product.id, file)
      const skuKey = `${product.brand}::${product.sku}`
      const knownSku = skus.get(skuKey)
      if (knownSku) issues.push({ file, index, id: product.id, message: `brand+sku повторяют запись из ${knownSku}` })
      else skus.set(skuKey, file)
    })
  }
  return issues
}

export const assertCatalogUniqueness = (files: Array<{ file: string; items: DeviceDefinition[] }>): void => {
  const issues = validateCatalogUniqueness(files)
  if (issues.length) {
    const details = issues.map((issue) => `${issue.file}[${issue.index}] ${issue.id || '?'}: ${issue.message}`).join('; ')
    throw new Error(`Каталог повреждён: ${details}`)
  }
}

/** Validates one file and hands back the typed products; a poisoned record aborts the import. */
export const assertCatalogFile = (file: string, items: unknown[]): DeviceDefinition[] => {
  const issues = validateCatalogFile(file, items)
  if (issues.length) {
    const details = issues.map((issue) => `${issue.file}[${issue.index}] ${issue.id || '?'}: ${issue.message}`).join('; ')
    throw new Error(`Каталог повреждён: ${details}`)
  }
  return items as DeviceDefinition[]
}

export const asCategory = (value: string): Category => value as Category
