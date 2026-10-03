import type { Category, DeviceDefinition } from '../domain/types'

/** Bump when the catalog shape or product set changes. */
export const CATALOG_REVISION = '2026-10-01.1'

/**
 * Built-in positions are real products with real prices, but their parameters were carried over
 * from the first slice of the project and never compared against a manufacturer datasheet. They
 * are marked `unverified` for that reason, and deliberately carry no `sourceUrl`: the catalogue
 * tells the reader how far each position has been checked, and claiming a source for one nobody
 * read would make the whole list read as better sourced than it is. The `enmasDevice` and
 * `sampleDevice` builders below mark their rows from the series they were generated from.
 */
const device = (
  id: string, name: string, brand: string, sku: string, category: Category,
  moduleWidth: number, poles: number, ratedCurrent: number, price: number,
  weight: number, voltage: 230 | 400 = 400, bus: DeviceDefinition['bus'] = 'L',
): DeviceDefinition => ({
  id, name, brand, sku, category, moduleWidth, poles, ratedCurrent, voltage, bus,
  price, weight, height: 82, depth: 70,
  color: category === 'MCB' ? '#f3f4ef' : category === 'SPD' ? '#e7b957' : '#f7f5ef',
  verificationStatus: 'unverified',
})

/**
 * Positions that stay out of the working catalogue but are still recognised when a project names
 * them. An imported file may reference a device this build does not stock; the importer has to
 * recognise the id rather than report the file as broken, and the workspace shows it as a missing
 * position the user can replace. They are kept here so that promise does not depend on this list
 * staying short.
 */
export const referenceCatalog: DeviceDefinition[] = [
  device('iek-mcb-1p-c10', 'BAO-10 1P C10', 'IEK', 'BAO-10-1P-C10', 'MCB', 1, 1, 10, 286, 0.13, 230),
  device('iek-mcb-1p-c32', 'BAO-10 1P C32', 'IEK', 'BAO-10-1P-C32', 'MCB', 1, 1, 32, 305, 0.14, 230),
  device('iek-mcb-2p-b20', 'VAO-10 2P B20', 'IEK', 'VAO-10-2P-B20', 'MCB', 2, 2, 20, 524, 0.25),
  device('iek-mcb-3p-c32', 'VAO-10 3P C32', 'IEK', 'VAO-10-3P-C32', 'MCB', 3, 3, 32, 812, 0.39),
  device('schneider-mcb-3p-b25', 'iC60N 3P B25', 'Schneider Electric', 'A9F74225', 'MCB', 3, 3, 25, 2260, 0.42),
  device('schneider-mcb-4p-c40', 'iC60N 4P C40', 'Schneider Electric', 'A9F74440', 'MCB', 4, 4, 40, 2980, 0.52),
  device('abb-mcb-2p-c20', 'S200 2P C20', 'ABB', '2CDS252001R0167', 'MCB', 2, 2, 20, 620, 0.23),
  device('abb-mcb-3p-b25', 'S200 3P B25', 'ABB', '2CDS253001R0254', 'MCB', 3, 3, 25, 1980, 0.41),
  device('dkc-mcb-1p-c16', 'DNM-10 1P C16', 'DKC', 'DNM10-1P-C16', 'MCB', 1, 1, 16, 240, 0.11, 230),
  device('dekraft-mcb-2p-c25', 'АВТ 2P C25', 'DEKraft', 'AVT-2P-C25', 'MCB', 2, 2, 25, 470, 0.23),
  device('iek-rccb-2p-40', 'FI-10 2P 40A 30mA', 'IEK', 'FI-10-2P-40-30', 'RCCB', 2, 2, 40, 1640, 0.25),
  device('schneider-rccb-2p-25', 'ID RCCB 2P 25A 30mA', 'Schneider Electric', 'A9D71225', 'RCCB', 2, 2, 25, 4380, 0.25),
  device('abb-rccb-4p-63', 'F202 AC-63/0.03', 'ABB', '2CSF202001R0630', 'RCCB', 4, 4, 63, 6120, 0.48),
  device('iek-rcbo-1p-b16', 'DI-10 1P B16 6kA 30mA', 'IEK', 'DI-10-1P-B16-30', 'RCBO', 2, 1, 16, 1510, 0.23, 230),
  device('schneider-rcbo-1p-c20', 'iID 1P C20 30mA', 'Schneider Electric', 'A9D64120', 'RCBO', 2, 1, 20, 5120, 0.24, 230),
  device('schneider-spd-t2-4p', 'PRD 4P 15kA T2', 'Schneider Electric', 'PRD4P15NPE', 'SPD', 4, 4, 63, 11900, 0.63),
  device('abb-spd-t2-3p-n-pe', 'T2-T3 3P+N+PE 20kA', 'ABB', '2CDE653011R0100', 'SPD', 4, 4, 63, 9800, 0.66),
  device('ekf-contactor-2p-25', 'KM-10 2P 25A 230В', 'EKF', 'KM10-2P-25-AC', 'relay', 2, 2, 25, 2240, 0.29, 230, 'N'),
  device('abb-contactor-3p-50', 'AF09-30-10-13', 'ABB', '1SBL171001R1310', 'relay', 3, 3, 50, 4290, 0.38),
  device('schneider-relay-2c', 'RXM 2CO 10A', 'Schneider Electric', 'RXMAB2AB', 'relay', 1, 2, 10, 2860, 0.17, 230, 'N'),
  device('dekraft-terminal-1p', 'Клемма ПБ 4 мм²', 'DEKraft', 'ПБ-4', 'terminals', 1, 1, 41, 105, 0.04, 400, 'N'),
  device('iek-meter-1p', 'СЭТ 1P 230В', 'IEK', 'СЭТ-1П', 'meter', 3, 1, 32, 2480, 0.32, 230),
  device('abb-meter-3p', 'EQM-B 3P 65A', 'ABB', 'EQMB-3P-65', 'meter', 6, 3, 65, 14200, 0.52),
  device('meanwell-psu-24v-10a', 'DRP-24V10W', 'MEAN WELL', 'DRP-24V10W', 'PSU', 5, 2, 10, 9200, 0.61, 230, 'N'),
]

export const categoryLabels: Record<Category, string> = {
  MCB: 'Автоматы', RCCB: 'УЗО', RCBO: 'Дифавтоматы', SPD: 'УЗИП',
  relay: 'Реле и контакторы', terminals: 'Клеммы', busbar: 'Шины', meter: 'Счётчики', PSU: 'Блоки питания',
}

/**
 * The working catalogue: one position per kind, plus the pole variants that change how the device
 * is wired.
 *
 * The full built-in list and the generated ENMAS/CHINT series stay in this file, because a project
 * imported from elsewhere may name any of them and the importer has to recognise those ids. What
 * the workspace *loads* is this short list — see `workspaceCatalog`. Listing several hundred
 * positions that differ only in a rating nobody chooses on purpose is a list nobody reads, and it
 * was the reason the catalogue panel and the demo drifted apart.
 */
export const builtinCatalog: DeviceDefinition[] = [
  device('ekf-mcb-1p-c6', 'AVO-10 1P C6', 'EKF', 'AVO-10-1P-C06', 'MCB', 1, 1, 6, 248, 0.12, 230),
  device('ekf-mcb-1p-b16', 'AVO-10 1P B16', 'EKF', 'AVO-10-1P-B16', 'MCB', 1, 1, 16, 254, 0.12, 230),
  device('ekf-mcb-2p-c16', 'AVO-10 2P C16', 'EKF', 'AVO-10-2P-C16', 'MCB', 2, 2, 16, 492, 0.24),
  device('ekf-mcb-3p-c25', 'AVO-10 3P C25', 'EKF', 'AVO-10-3P-C25', 'MCB', 3, 3, 25, 714, 0.37),
  device('ekf-mcb-4p-b32', 'AVO-10 4P B32', 'EKF', 'AVO-10-4P-B32', 'MCB', 4, 4, 32, 936, 0.48),
  device('ekf-rccb-2p-25', 'FI-10 2P 25A 30mA', 'EKF', 'FI-10-2P-25-30', 'RCCB', 2, 2, 25, 1820, 0.25),
  device('ekf-rccb-4p-40', 'FI-10 4P 40A 30mA', 'EKF', 'FI-10-4P-40-30', 'RCCB', 4, 4, 40, 2740, 0.44),
  device('ekf-rcbo-1p-c16', 'DI-10 1P C16 6kA 30mA', 'EKF', 'DI-10-1P-C16-30', 'RCBO', 2, 1, 16, 1490, 0.23, 230),
  device('ekf-spd-t1-3p-n-pe', 'DV-T1 3P+N+PE 25kA', 'EKF', 'DV-T1-3PNPE-25', 'SPD', 4, 4, 63, 7480, 0.72),
  // Single-phase board, single-phase surge protection. The price is deliberately zero: this row was
  // added to make the demo board electrically right, and a number nobody checked is exactly what
  // the catalogue is not allowed to show. Zero reads as «уточняется» and never as free.
  device('ekf-spd-t1-2p', 'DV-T1 1P+N 25kA', 'EKF', 'DV-T1-1PN-25', 'SPD', 2, 2, 40, 0, 0.44, 230),
  device('iek-relay-4c', 'RKM-1 4CO 16A', 'IEK', 'RKM-1-4CO-16', 'relay', 1, 4, 16, 1320, 0.14, 230, 'N'),
  device('iek-terminal-1p-gray', 'Клемма ПВ 1,5 мм²', 'IEK', 'ПВ-1.5', 'terminals', 1, 1, 16, 82, 0.03, 400, 'N'),
  device('iek-terminal-1p-blue', 'Клемма ЗБИ 1,5 мм²', 'IEK', 'ЗБИ-1.5', 'terminals', 1, 1, 16, 98, 0.03, 400, 'PE'),
  device('ekf-terminal-1p-gray', 'Клемма КВ 2,5 мм²', 'EKF', 'КВ-2.5', 'terminals', 1, 1, 32, 92, 0.04, 400, 'L'),
  device('ekf-meter-3p', 'СЭТ-р 3x220/380', 'EKF', 'СЭТ-Р-МАСТЕР', 'meter', 6, 3, 100, 4850, 0.45),
  device('schneider-psu-24v-5a', 'Phaseo 24V 5A', 'Schneider Electric', 'PHPS0124AC', 'PSU', 4, 2, 5, 12600, 0.56, 230, 'N'),
]


const enmasDevice = (
  id: string,
  name: string,
  category: Category,
  series: string,
  moduleWidth: number,
  poles: number,
  ratedCurrent: number,
  options: Partial<DeviceDefinition> = {},
): DeviceDefinition => ({
  id,
  name,
  brand: 'ENMAS / CHINT',
  sku: series,
  category,
  moduleWidth,
  poles,
  ratedCurrent,
  voltage: options.voltage ?? (poles >= 3 ? 400 : 230),
  bus: options.bus ?? 'L',
  price: options.price ?? 0,
  weight: options.weight ?? 0,
  height: options.height ?? 82,
  depth: options.depth ?? 78,
  color: options.color ?? (category === 'SPD' ? '#e7b957' : category === 'busbar' ? '#aeb8b4' : '#f7f5ef'),
  series,
  verificationStatus: options.verificationStatus ?? 'verified',
  sourceUrl: options.sourceUrl,
  tripCurve: options.tripCurve,
  residualCurrentMa: options.residualCurrentMa,
  terminalCount: options.terminalCount,
})

const enmasCatalog: DeviceDefinition[] = []
const addEnmas = (product: DeviceDefinition) => enmasCatalog.push(product)

const nb1Poles = [1, 2, 3, 4] as const
const nb1Currents = [1, 2, 3, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63] as const
for (const poles of nb1Poles) {
  for (const ratedCurrent of nb1Currents) {
    for (const curve of ['B', 'C', 'D'] as const) {
      const template = curve === 'B'
      addEnmas(enmasDevice(`enmas-nb1-63h-${poles}p-${ratedCurrent}a-${curve.toLowerCase()}`, `NB1-63H ${poles}P ${ratedCurrent}A ${curve}`, 'MCB', 'NB1-63H', poles, poles, ratedCurrent, {
        tripCurve: curve,
        verificationStatus: template ? 'template' : 'verified',
        sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/modulnye_avtomaticheskie_vyklyuchateli/nb1_63_h/',
        height: 80,
        depth: 78,
      }))
    }
  }
}

for (const poles of [2, 4] as const) {
  for (const ratedCurrent of [25, 40, 63] as const) {
    for (const residualCurrentMa of [10, 30, 100, 300] as const) {
      addEnmas(enmasDevice(`enmas-nl1-${poles}p-${ratedCurrent}a-${residualCurrentMa}ma`, `NL1 ${poles}P ${ratedCurrent}A ${residualCurrentMa}mA`, 'RCCB', 'NL1', poles, poles, ratedCurrent, {
        residualCurrentMa,
        verificationStatus: residualCurrentMa === 30 || residualCurrentMa === 300 ? 'verified' : 'template',
        sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/vyklyuchateli_differentsialnogo_toka/nl1/',
        height: 86,
        depth: 79,
      }))
    }
  }
}

for (const poles of [1, 2] as const) {
  for (const ratedCurrent of [6, 10, 16, 20, 25, 32, 40] as const) {
    for (const curve of ['B', 'C'] as const) {
      for (const residualCurrentMa of [30, 100, 300] as const) {
        addEnmas(enmasDevice(`enmas-nb1l-${poles}p-${ratedCurrent}a-${curve.toLowerCase()}-${residualCurrentMa}ma`, `NB1L ${poles === 1 ? '1P+N' : '2P'} ${ratedCurrent}A ${curve} ${residualCurrentMa}mA`, 'RCBO', 'NB1L', 2, poles === 1 ? 2 : 2, ratedCurrent, {
          tripCurve: curve,
          residualCurrentMa,
          verificationStatus: 'verified',
          sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/differentsialnye_avtomaticheskie_vyklyuchateli/nb1l/',
          height: 86,
          depth: 77,
        }))
      }
    }
  }
}

for (const poles of [2, 3] as const) {
  for (const ratedCurrent of [6, 10, 16, 20, 25, 32, 40] as const) {
    for (const curve of ['B', 'C'] as const) {
      for (const residualCurrentMa of [30, 300] as const) {
        const name = poles === 3 ? '3P+N' : '2P'
        addEnmas(enmasDevice(`enmas-nb310l-${poles}p-${ratedCurrent}a-${curve.toLowerCase()}-${residualCurrentMa}ma`, `NB310L ${name} ${ratedCurrent}A ${curve} ${residualCurrentMa}mA`, 'RCBO', 'NB310L', poles === 3 ? 4 : 2, poles === 3 ? 4 : 2, ratedCurrent, {
          tripCurve: curve,
          residualCurrentMa,
          verificationStatus: 'verified',
          sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/differentsialnye_avtomaticheskie_vyklyuchateli/nb310l/',
          height: 86,
          depth: 77,
        }))
      }
    }
  }
}

for (const [series, current, poles, width] of [['NJVA1-63', 63, 2, 2], ['NJVA1-100', 100, 4, 4]] as const) {
  addEnmas(enmasDevice(`enmas-${series.toLowerCase()}-${poles}p`, `${series} ${poles === 2 ? '1P+N' : '3P+N'} реле напряжения`, 'relay', series, width, poles, current, {
    verificationStatus: 'verified',
    sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_signalizatsii_i_upravleniya/rele_kontrolya_napryazheniya_i_toka/',
    height: 84,
    depth: 66,
  }))
}

for (const poles of [1, 2, 3, 4] as const) {
  for (const ratedCurrent of [63, 100] as const) {
    addEnmas(enmasDevice(`enmas-fork-${poles}p-${ratedCurrent}a`, `FORK ${poles}P ${ratedCurrent}A, 12 модулей`, 'busbar', 'FORK', 12, poles, ratedCurrent, {
      verificationStatus: 'verified',
      sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/modulnye_avtomaticheskie_vyklyuchateli/nb_nxb_aksessuary/',
      color: '#aeb8b4',
      height: 54,
      depth: 52,
    }))
  }
}

for (const poles of [1, 2, 3, 4] as const) {
  for (const uc of [385, 440] as const) {
    addEnmas(enmasDevice(`enmas-nu6-iig-${poles}p-${uc}v`, `NU6-IIG ${poles}P Uc ${uc}V`, 'SPD', 'NU6-IIG', poles, poles, 63, {
      verificationStatus: 'verified',
      sourceUrl: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/ustroystva_zashchity_ot_impulsnykh_perenapryazheniy/nu6_g/',
      color: '#e7b957',
      height: 82,
      depth: 70,
    }))
  }
}

for (const [id, name, series, width, poles, current] of [
  ['shk', 'Клемма ШК', 'ШК', 1, 1, 16],
  ['kbr', 'Клемма КБР', 'КБР', 1, 1, 32],
  ['ksv', 'Клемма КСВ', 'КСВ', 1, 1, 32],
  ['ngu', 'Нулевая шина NGU в изоляторе', 'NGU', 12, 1, 63],
] as const) {
  addEnmas(enmasDevice(`enmas-template-${id}`, `${name} · шаблон`, 'terminals', series, width, poles, current, {
    verificationStatus: 'template',
    sourceUrl: undefined,
    height: 70,
    depth: 55,
  }))
}

for (const [id, name, series, width, current] of [
  ['psu-24v-5a', 'Блок питания 24 В / 5 А', 'PSU-DIN-24V-5A', 4, 5],
  ['psu-12v-2a', 'Блок питания 12 В / 2 А', 'PSU-DIN-12V-2A', 3, 2],
] as const) {
  addEnmas(enmasDevice(`enmas-template-${id}`, `${name} · параметры уточняются`, 'PSU', series, width, 2, current, {
    verificationStatus: 'template',
    bus: 'N',
    height: 90,
    depth: 70,
  }))
}

const sampleDevice = (
  id: string,
  name: string,
  sku: string,
  moduleWidth: number,
  poles: number,
  options: Partial<DeviceDefinition> = {},
): DeviceDefinition => ({
  id,
  name,
  brand: 'City9 · тестовый образец',
  sku,
  category: 'MCB',
  moduleWidth,
  poles,
  ratedCurrent: 16,
  voltage: 230,
  bus: 'L',
  price: 0,
  weight: 0.16,
  height: 82,
  depth: 74,
  color: '#f3f4ef',
  series: 'CITY9-MCB',
  tripCurve: 'C',
  verificationStatus: 'template',
  ...options,
})

export const sampleCatalog: DeviceDefinition[] = [
  sampleDevice('city9-mcb-1p-c16', 'City9 MCB 1P C16', 'CITY9-MCB-1P-C16', 1, 1),
  sampleDevice('city9-mcb-2p-c16', 'City9 MCB 2P C16', 'CITY9-MCB-2P-C16', 2, 2, {
    modelPreviewUrl: '/models/city9-mcb-2p.glb',
    modelPreviewRotationY: -Math.PI / 2,
  }),
]

export const enmasSeriesCatalog = enmasCatalog
export const allCatalog = [...builtinCatalog, ...referenceCatalog, ...enmasCatalog, ...sampleCatalog]
/** What the workspace loads: the short list, the City9 model samples, and whatever the user imported. */
export const workspaceCatalog = [...builtinCatalog, ...sampleCatalog]
export const catalogCategories = Object.keys(categoryLabels) as Category[]
