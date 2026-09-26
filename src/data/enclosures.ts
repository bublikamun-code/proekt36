import type { CabinetDefinition, RailDefinition, RailSlotCount } from '../domain/types'

export const railDefinitions: RailDefinition[] = [
  { id: 'rail-12', name: 'DIN-рейка 12 модулей', slots: 12, modulePitchMm: 18 },
  { id: 'rail-18', name: 'DIN-рейка 18 модулей', slots: 18, modulePitchMm: 18 },
]

/**
 * Rail housing geometry of the TEHNOPLAST C series, in millimetres. Every cabinet
 * below was taken from the manufacturer card on nvacontact.com, where the site
 * prints `высота x ширина x глубина`, so the horizontal run comes first only for
 * single-row models. `width` is always the horizontal cabinet dimension.
 */
const C_SERIES = {
  rail12WidthMm: 283,
  rail18WidthMm: 392,
  depthMm: 106,
  ip: 'IP40',
  material: 'ABS-пластик, RAL 9003',
  source: 'https://nvacontact.com/catalog/modulnye_ustroystva_na_din_reyku/shchity_modulnye_multimediynye/',
}

const uSeries = (
  id: string,
  sku: string,
  modules: number,
  rows: number,
  railSlots: RailSlotCount,
  height: number,
  slug: string,
): CabinetDefinition => ({
  id,
  name: `TEHNOPLAST U${modules}C, ${rows}×${railSlots}, IP40`,
  brand: 'TEHNOPLAST',
  sku,
  modules,
  rows,
  railId: railSlots === 12 ? 'rail-12' : 'rail-18',
  mounting: 'embedded',
  width: railSlots === 12 ? C_SERIES.rail12WidthMm : C_SERIES.rail18WidthMm,
  height,
  depth: C_SERIES.depthMm,
  ip: C_SERIES.ip,
  material: C_SERIES.material,
  sourceUrl: `${C_SERIES.source}${slug}/`,
  verificationStatus: 'verified',
})

const official = (
  id: string,
  name: string,
  sku: string,
  modules: number,
  rows: number,
  width: number,
  height: number,
  depth: number,
  sourceUrl: string,
): CabinetDefinition => ({
  id,
  name,
  brand: 'ENMAS / CHINT',
  sku,
  modules,
  rows,
  railId: 'rail-12',
  mounting: 'embedded',
  width,
  height,
  depth,
  sourceUrl,
  verificationStatus: 'verified',
})

/**
 * Approximate housing for cabinets whose real dimensions are not confirmed yet.
 * The proportions follow the same rail geometry as the verified C series, so an
 * unconfirmed entry never renders wider than it is tall by accident. It stays
 * marked as `template` and must not be presented as a real product.
 */
const profile = (
  id: string,
  modules: number,
  railSlots: RailSlotCount,
  mounting: 'embedded' | 'surface',
): CabinetDefinition => {
  const rows = modules / railSlots
  return {
    id,
    name: `Panel36 ${modules} мод. · ${railSlots} мод./рейка · ${mounting === 'embedded' ? 'встраиваемый' : 'накладной'}`,
    brand: 'Panel36',
    modules,
    rows,
    railId: railSlots === 12 ? 'rail-12' : 'rail-18',
    mounting,
    width: railSlots === 12 ? C_SERIES.rail12WidthMm : C_SERIES.rail18WidthMm,
    height: rows * 125 + 107,
    depth: mounting === 'embedded' ? C_SERIES.depthMm : 120,
    verificationStatus: 'template',
  }
}

export const cabinetDefinitions: CabinetDefinition[] = [
  official(
    'enmas-nx8-12-embedded',
    'NX8-12 IP30, 1×12, встраиваемый',
    '216033',
    12,
    1,
    310,
    200,
    105,
    'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/shkafy_i_aksessuary/korpusa_plastikovye_modulnye_ip30/nx8/modulnyy_korpus_plastikovyy_nx8_12_ip30_r/',
  ),
  official(
    'enmas-nx8-24-embedded',
    'NX8-24 IP30, 2×12, встраиваемый',
    '216037',
    24,
    2,
    310,
    350,
    105,
    'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/shkafy_i_aksessuary/korpusa_plastikovye_modulnye_ip30/nx8/modulnyy_korpus_plastikovyy_nx8_24_ip30_r/',
  ),
  // Verified TEHNOPLAST C series: 283 × 232/357/482/676 × 106 mm.
  uSeries('panel36-12-embedded', 'U12C', 12, 1, 12, 232, 'u12c_shchit_vstraivaemyy_1_ryad_12_mod_prozrach_dvertsa_ip40'),
  uSeries('panel36-18-r18-embedded', 'U18C', 18, 1, 18, 232, 'u18c_shchit_vstraivaemyy_1_ryad_18_mod_prozrach_dvertsa_ip40'),
  uSeries('panel36-24-embedded', 'U24C', 24, 2, 12, 357, 'u24c_shchit_vstraivaemyy_2_ryada_24_mod_prozrach_dvertsa_ip40'),
  uSeries('panel36-36-r12-embedded', 'U36C', 36, 3, 12, 482, 'u36c_shchit_vstraivaemyy_3_ryada_36_mod_prozrach_dvertsa_ip40'),
  uSeries('panel36-48-r12-embedded', 'U48C', 48, 4, 12, 676, 'u48c_shchit_vstraivaemyy_4_ryada_48_mod_prozrach_dvertsa_ip40'),
  ...[
    profile('panel36-12-surface', 12, 12, 'surface'),
    profile('panel36-24-surface', 24, 12, 'surface'),
    profile('panel36-36-r12-surface', 36, 12, 'surface'),
    profile('panel36-48-r12-surface', 48, 12, 'surface'),
    profile('panel36-60-r12-embedded', 60, 12, 'embedded'),
    profile('panel36-60-r12-surface', 60, 12, 'surface'),
    profile('panel36-18-r18-surface', 18, 18, 'surface'),
    profile('panel36-36-r18-embedded', 36, 18, 'embedded'),
    profile('panel36-36-r18-surface', 36, 18, 'surface'),
    profile('panel36-54-r18-embedded', 54, 18, 'embedded'),
    profile('panel36-54-r18-surface', 54, 18, 'surface'),
    profile('panel36-72-r18-embedded', 72, 18, 'embedded'),
    profile('panel36-72-r18-surface', 72, 18, 'surface'),
  ],
]

export const cabinetById = new Map(cabinetDefinitions.map((cabinet) => [cabinet.id, cabinet]))
export const railById = new Map(railDefinitions.map((rail) => [rail.id, rail]))

/** Compact physical description shown next to the cabinet name. */
export const cabinetSpecLabel = (cabinet: CabinetDefinition | undefined): string => {
  if (!cabinet) return 'Параметры не заданы'
  const status = cabinet.verificationStatus === 'template' ? ' · профиль' : ''
  return `${cabinet.width}×${cabinet.height}×${cabinet.depth} мм${status}`
}
