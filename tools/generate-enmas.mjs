// Generates src/data/catalog/enmas.generated.json from the ENMAS / CHINT series
// combinatorics. Run `npm run catalog:generate` after changing series scope here, and
// commit the resulting JSON — the file is data, this script is its provenance.
// `npm run catalog:check` fails when the committed file drifted from this generator.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'src/data/catalog/enmas.generated.json')

const skuFull = {
  nb1: (poles, current, curve) => `NB1-63H-${poles}P-${current}A-${curve}`,
  nl1: (poles, current, ma) => `NL1-${poles}P-${current}A-${ma}mA`,
  nb1l: (poles, current, curve, ma) => `NB1L-${poles === 1 ? '1P+N' : '2P'}-${current}A-${curve}-${ma}mA`,
  nb310l: (poles, current, curve, ma) => `NB310L-${poles === 3 ? '3P+N' : '2P'}-${current}A-${curve}-${ma}mA`,
  njva: (series) => series,
  fork: (poles, current) => `FORK-${poles}P-${current}A`,
  nu6: (poles, uc) => `NU6-IIG-${poles}P-${uc}V`,
}

const device = (product) => ({
  id: product.id,
  name: product.name,
  brand: 'ENMAS / CHINT',
  sku: product.sku,
  category: product.category,
  moduleWidth: product.moduleWidth,
  poles: product.poles,
  ratedCurrent: product.ratedCurrent,
  voltage: product.voltage,
  bus: product.bus,
  price: product.price,
  weight: product.weight,
  height: product.height,
  depth: product.depth,
  series: product.series,
  tripCurve: product.tripCurve,
  residualCurrentMa: product.residualCurrentMa,
  terminalCount: product.terminalCount,
  sourceUrl: product.sourceUrl,
  verificationStatus: product.verificationStatus,
})

const enmas = (id, name, sku, category, moduleWidth, poles, ratedCurrent, options = {}) => device({
  id,
  name,
  sku,
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
  series: options.series ?? sku,
  tripCurve: options.tripCurve,
  residualCurrentMa: options.residualCurrentMa,
  terminalCount: options.terminalCount,
  sourceUrl: options.sourceUrl,
  verificationStatus: options.verificationStatus ?? 'verified',
})

const NB1_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/modulnye_avtomaticheskie_vyklyuchateli/nb1_63_h/'
const NL1_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/vyklyuchateli_differentsialnogo_toka/nl1/'
const NB1L_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/differentsialnye_avtomaticheskie_vyklyuchateli/nb1l/'
const NB310L_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/differentsialnye_avtomaticheskie_vyklyuchateli/nb310l/'
const NJVA_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_signalizatsii_i_upravleniya/rele_kontrolya_napryazheniya_i_toka/'
const FORK_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/modulnye_avtomaticheskie_vyklyuchateli/nb_nxb_aksessuary/'
const NU6_SOURCE = 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/ustroystva_zashchity_ot_impulsnykh_perenapryazheniy/nu6_g/'

const products = []

for (const poles of [1, 2, 3, 4]) {
  for (const ratedCurrent of [1, 2, 3, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63]) {
    for (const curve of ['B', 'C', 'D']) {
      products.push(enmas(
        `enmas-nb1-63h-${poles}p-${ratedCurrent}a-${curve.toLowerCase()}`,
        `NB1-63H ${poles}P ${ratedCurrent}A ${curve}`,
        skuFull.nb1(poles, ratedCurrent, curve),
        'MCB', poles, poles, ratedCurrent,
        {
          series: 'NB1-63H',
          tripCurve: curve,
          // Only the B curve has a photographed datasheet behind it; C and D follow the series.
          verificationStatus: curve === 'B' ? 'template' : 'verified',
          sourceUrl: NB1_SOURCE,
          height: 80,
          depth: 78,
        },
      ))
    }
  }
}

for (const poles of [2, 4]) {
  for (const ratedCurrent of [25, 40, 63]) {
    for (const residualCurrentMa of [10, 30, 100, 300]) {
      products.push(enmas(
        `enmas-nl1-${poles}p-${ratedCurrent}a-${residualCurrentMa}ma`,
        `NL1 ${poles}P ${ratedCurrent}A ${residualCurrentMa}mA`,
        skuFull.nl1(poles, ratedCurrent, residualCurrentMa),
        'RCCB', poles, poles, ratedCurrent,
        {
          series: 'NL1',
          residualCurrentMa,
          verificationStatus: residualCurrentMa === 30 || residualCurrentMa === 300 ? 'verified' : 'template',
          sourceUrl: NL1_SOURCE,
          height: 86,
          depth: 79,
        },
      ))
    }
  }
}

for (const poles of [1, 2]) {
  for (const ratedCurrent of [6, 10, 16, 20, 25, 32, 40]) {
    for (const curve of ['B', 'C']) {
      for (const residualCurrentMa of [30, 100, 300]) {
        products.push(enmas(
          `enmas-nb1l-${poles}p-${ratedCurrent}a-${curve.toLowerCase()}-${residualCurrentMa}ma`,
          `NB1L ${poles === 1 ? '1P+N' : '2P'} ${ratedCurrent}A ${curve} ${residualCurrentMa}mA`,
          skuFull.nb1l(poles, ratedCurrent, curve, residualCurrentMa),
          'RCBO', 2, 2, ratedCurrent,
          {
            series: 'NB1L',
            tripCurve: curve,
            residualCurrentMa,
            verificationStatus: 'verified',
            sourceUrl: NB1L_SOURCE,
            height: 86,
            depth: 77,
          },
        ))
      }
    }
  }
}

for (const poles of [2, 3]) {
  for (const ratedCurrent of [6, 10, 16, 20, 25, 32, 40]) {
    for (const curve of ['B', 'C']) {
      for (const residualCurrentMa of [30, 300]) {
        const label = poles === 3 ? '3P+N' : '2P'
        products.push(enmas(
          `enmas-nb310l-${poles}p-${ratedCurrent}a-${curve.toLowerCase()}-${residualCurrentMa}ma`,
          `NB310L ${label} ${ratedCurrent}A ${curve} ${residualCurrentMa}mA`,
          skuFull.nb310l(poles, ratedCurrent, curve, residualCurrentMa),
          'RCBO', poles === 3 ? 4 : 2, poles === 3 ? 4 : 2, ratedCurrent,
          {
            series: 'NB310L',
            tripCurve: curve,
            residualCurrentMa,
            verificationStatus: 'verified',
            sourceUrl: NB310L_SOURCE,
            height: 86,
            depth: 77,
          },
        ))
      }
    }
  }
}

for (const [series, current, poles, width] of [['NJVA1-63', 63, 2, 2], ['NJVA1-100', 100, 4, 4]]) {
  products.push(enmas(
    `enmas-${series.toLowerCase()}-${poles}p`,
    `${series} ${poles === 2 ? '1P+N' : '3P+N'} реле напряжения`,
    skuFull.njva(series),
    'relay', width, poles, current,
    {
      verificationStatus: 'verified',
      sourceUrl: NJVA_SOURCE,
      height: 84,
      depth: 66,
    },
  ))
}

for (const poles of [1, 2, 3, 4]) {
  for (const ratedCurrent of [63, 100]) {
    products.push(enmas(
      `enmas-fork-${poles}p-${ratedCurrent}a`,
      `FORK ${poles}P ${ratedCurrent}A, 12 модулей`,
      skuFull.fork(poles, ratedCurrent),
      'busbar', 12, poles, ratedCurrent,
      { series: 'FORK', verificationStatus: 'verified', sourceUrl: FORK_SOURCE, height: 54, depth: 52 },
    ))
  }
}

for (const poles of [1, 2, 3, 4]) {
  for (const uc of [385, 440]) {
    products.push(enmas(
      `enmas-nu6-iig-${poles}p-${uc}v`,
      `NU6-IIG ${poles}P Uc ${uc}V`,
      skuFull.nu6(poles, uc),
      'SPD', poles, poles, 63,
      { series: 'NU6-IIG', verificationStatus: 'verified', sourceUrl: NU6_SOURCE, height: 82, depth: 70 },
    ))
  }
}

for (const [id, name, series, width, current] of [
  ['shk', 'Клемма ШК', 'ШК', 1, 16],
  ['kbr', 'Клемма КБР', 'КБР', 1, 32],
  ['ksv', 'Клемма КСВ', 'КСВ', 1, 32],
  ['ngu', 'Нулевая шина NGU в изоляторе', 'NGU', 12, 63],
]) {
  products.push(enmas(
    `enmas-template-${id}`,
    `${name} · шаблон`,
    series,
    'terminals', width, 1, current,
    { verificationStatus: 'template', height: 70, depth: 55 },
  ))
}

for (const [id, name, series, width, current] of [
  ['psu-24v-5a', 'Блок питания 24 В / 5 А', 'PSU-DIN-24V-5A', 4, 5],
  ['psu-12v-2a', 'Блок питания 12 В / 2 А', 'PSU-DIN-12V-2A', 3, 2],
]) {
  products.push(enmas(
    `enmas-template-${id}`,
    `${name} · параметры уточняются`,
    series,
    'PSU', width, 2, current,
    { verificationStatus: 'template', bus: 'N', height: 90, depth: 70 },
  ))
}

const payload = JSON.stringify(products, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8')
  if (current !== payload) {
    console.error('enmas.generated.json устарел: запустите `npm run catalog:generate` и закоммитьте результат')
    process.exit(1)
  }
  console.log(`enmas.generated.json актуален (${products.length} записей)`)
} else {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, payload)
  console.log(`записано ${products.length} записей → ${target}`)
}
