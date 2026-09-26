import type { BomLine, DeviceDefinition, PlacedDevice } from './types'

const isKnownPrice = (price: number) => Number.isFinite(price) && price > 0

export const buildBom = (placed: PlacedDevice[], definitions: Map<string, DeviceDefinition>): BomLine[] => {
  const grouped = new Map<string, BomLine>()
  for (const item of placed) {
    const product = definitions.get(item.productId)
    if (!product) continue
    // quantity is the purchase quantity. It must not be used as a layout width.
    const quantity = Math.max(1, Math.floor(item.quantity))
    const priceKnown = isKnownPrice(product.price)
    const existing = grouped.get(product.id)
    if (existing) {
      existing.quantity += quantity
      existing.weight += product.weight * quantity
      if (existing.priceKnown) existing.total = existing.unitPrice * existing.quantity
    } else {
      grouped.set(product.id, {
        productId: product.id, name: product.name, brand: product.brand, sku: product.sku,
        category: product.category, quantity, unitPrice: priceKnown ? product.price : 0,
        total: priceKnown ? product.price * quantity : 0, weight: product.weight * quantity,
        priceKnown, priceStatus: priceKnown ? 'known' : 'unknown',
      })
    }
  }
  return [...grouped.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ru'))
}

export const pricing = (placed: PlacedDevice[], definitions: Map<string, DeviceDefinition>) => {
  const lines = buildBom(placed, definitions)
  const knownTotal = lines.reduce((sum, line) => sum + (line.priceKnown ? line.total : 0), 0)
  return {
    lines,
    /** Existing callers use total; it intentionally contains only known prices. */
    total: knownTotal,
    knownTotal,
    hasUnknownPrices: lines.some((line) => !line.priceKnown),
    mass: placed.reduce((sum, item) => sum + (definitions.get(item.productId)?.weight ?? 0) * Math.max(1, item.quantity), 0),
  }
}

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value)
  // Prevent spreadsheet formula injection while retaining readable CSV. TAB and
  // CR belong on the dangerous-prefix list as well: spreadsheets strip leading
  // whitespace before deciding whether a cell is a formula.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** Safe CSV export helper. The caller can choose a locale delimiter if needed. */
export const bomToCsv = (placed: PlacedDevice[], definitions: Map<string, DeviceDefinition>, delimiter = ',') => {
  const rows: unknown[][] = [
    ['Категория', 'Наименование', 'Бренд', 'Артикул', 'Количество', 'Цена за единицу', 'Сумма', 'Вес, кг', 'Цена'],
    ...buildBom(placed, definitions).map((line) => [line.category, line.name, line.brand, line.sku, line.quantity, line.unitPrice, line.total, line.weight, line.priceStatus === 'known' ? 'известна' : 'уточняется']),
  ]
  return rows.map((row) => row.map(csvCell).join(delimiter)).join('\n')
}

export const toCsv = bomToCsv
