import builtinJson from './builtin.json' with { type: 'json' }
import enmasJson from './enmas.generated.json' with { type: 'json' }
import referenceJson from './reference.json' with { type: 'json' }
import { assertCatalogFile, assertCatalogUniqueness } from './schema'
import type { Category } from './types'

export type { Category, BusType, DeviceDefinition, VerificationStatus } from './types'
export { DEVICE_CATEGORIES } from './types'
export { validateCatalogFile, validateCatalogUniqueness } from './schema'

/**
 * Bump при изменении формы или состава каталога. JSON-файлы рядом — это данные;
 * tools/generate-enmas.mjs перегенерирует комбинаторику ENMAS.
 */
export const CATALOG_REVISION = '2026-10-17.1'

export const categoryLabels: Record<Category, string> = {
  MCB: 'Автоматы', RCCB: 'УЗО', RCBO: 'Дифавтоматы', SPD: 'УЗИП',
  relay: 'Реле и контакторы', terminals: 'Клеммы', busbar: 'Шины', meter: 'Счётчики', PSU: 'Блоки питания',
}

const builtinCatalog = assertCatalogFile('builtin.json', builtinJson)
const referenceCatalog = assertCatalogFile('reference.json', referenceJson)
const enmasSeriesCatalog = assertCatalogFile('enmas.generated.json', enmasJson)
assertCatalogUniqueness([
  { file: 'builtin.json', items: builtinCatalog },
  { file: 'reference.json', items: referenceCatalog },
  { file: 'enmas.generated.json', items: enmasSeriesCatalog },
])

export { builtinCatalog, referenceCatalog, enmasSeriesCatalog }

/** Всё, что приложение способно узнать по id: паспортные, легаси и сгенерированные. */
export const allCatalog = [...builtinCatalog, ...referenceCatalog, ...enmasSeriesCatalog]

/**
 * Что можно ставить на доску: паспортные позиции плюс легаси-справочник — демо-проекты
 * и старые файлы ссылаются на них, и пользователь должен видеть заменяемую позицию,
 * а не «битую». Тонкие сгенерированные ENMAS для размещения не предлагаются.
 */
export const workspaceCatalog = [...builtinCatalog, ...referenceCatalog]

export const catalogCategories = Object.keys(categoryLabels) as Category[]
