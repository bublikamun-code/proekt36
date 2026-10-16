import builtinJson from './builtin.json' with { type: 'json' }
import enmasJson from './enmas.generated.json' with { type: 'json' }
import type { Category } from '../../domain/types'
import { assertCatalogFile, assertCatalogUniqueness } from './schema'

export { validateCatalogFile, validateCatalogUniqueness } from './schema'

/**
 * Bump when the catalogue shape or product set changes. The JSON files under src/data/catalog/
 * are the data; tools/generate-enmas.mjs regenerates the ENMAS combinatorics.
 */
export const CATALOG_REVISION = '2026-09-29.2'

export const categoryLabels: Record<Category, string> = {
  MCB: 'Автоматы', RCCB: 'УЗО', RCBO: 'Дифавтоматы', SPD: 'УЗИП',
  relay: 'Реле и контакторы', terminals: 'Клеммы', busbar: 'Шины', meter: 'Счётчики', PSU: 'Блоки питания',
}

const builtinCatalog = assertCatalogFile('builtin.json', builtinJson)
const enmasSeriesCatalog = assertCatalogFile('enmas.generated.json', enmasJson)
assertCatalogUniqueness([
  { file: 'builtin.json', items: builtinCatalog },
  { file: 'enmas.generated.json', items: enmasSeriesCatalog },
])

export { builtinCatalog, enmasSeriesCatalog }
export const allCatalog = [...builtinCatalog, ...enmasSeriesCatalog]
