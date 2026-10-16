import { describe, expect, it } from 'vitest'
import { builtinCatalog } from '../src/data/catalog'
import { createDevice, createProject, migrateProject } from '../src/domain/project'
import {
  DEFAULT_DEVICE_HEIGHT_MM,
  DIN_PROFILE_HEIGHT_MM,
  PANEL_MM_TO_PX,
  PLATE_BOTTOM_MM,
  PLATE_TOP_MM,
  PLATE_WIRE_BAND_MM,
  ROW_DEVICE_CLEARANCE_MM,
  ROW_GAP_MM,
  ROW_LABEL_WIDTH_MM,
  getPanelGeometry,
} from '../src/domain/panelGeometry'
import type { DeviceDefinition, PanelProject } from '../src/domain/types'

const definitions = new Map(builtinCatalog.map((product) => [product.id, product]))
const tallProduct: DeviceDefinition = { ...definitions.get('ekf-mcb-1p-c6')!, id: 'tall-device', height: 140 }
const localDefinitions = new Map([...definitions, [tallProduct.id, tallProduct] as const])

const withDevice = (productId: string, row = 0, slot = 0): PanelProject => {
  const project = createProject('Геометрия', 'apartment', { cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' })
  project.devices = [{ ...createDevice(localDefinitions.get(productId)!, row, slot), productId, instanceId: `${productId}-${row}-${slot}` }]
  return project
}

describe('геометрия щита', () => {
  it('переводит каждый миллиметр в пиксели одним и тем же коэффициентом', () => {
    const geometry = getPanelGeometry(withDevice('ekf-mcb-1p-c6'), localDefinitions)

    expect(geometry.scale).toBe(PANEL_MM_TO_PX)
    expect(geometry.cabinetWidthPx).toBeCloseTo(geometry.cabinetWidthMm * PANEL_MM_TO_PX, 6)
    expect(geometry.railWidthPx).toBeCloseTo(geometry.railWidthMm * PANEL_MM_TO_PX, 6)
    expect(geometry.moduleWidthPx).toBeCloseTo(18 * PANEL_MM_TO_PX, 6)
    expect(geometry.rowGapPx).toBeCloseTo(ROW_GAP_MM * PANEL_MM_TO_PX, 6)
    expect(geometry.plateTopPx).toBeCloseTo(PLATE_TOP_MM * PANEL_MM_TO_PX, 6)
    expect(geometry.plateWireBandPx).toBeCloseTo(PLATE_WIRE_BAND_MM * PANEL_MM_TO_PX, 6)
    expect(geometry.rowLabelWidthPx).toBeCloseTo(ROW_LABEL_WIDTH_MM * PANEL_MM_TO_PX, 6)
  })

  it('держит рейку по центру пластины и не наезжает на подписи рядов', () => {
    const geometry = getPanelGeometry(withDevice('ekf-mcb-1p-c6'), localDefinitions)

    const left = geometry.railStartXMm
    const right = geometry.plateWidthMm - (left + geometry.railWidthMm)
    expect(left).toBeGreaterThanOrEqual(ROW_LABEL_WIDTH_MM + 2)
    expect(Math.abs(left - right)).toBeLessThan(0.001)
  })

  it('отодвигает рейку к краю, когда по центру она наехала бы на подписи рядов', () => {
    // A project without a catalogue cabinet takes its plate from the stored millimetres. The
    // legacy 17.5 mm rail keeps only an 18 mm side clearance, so on a narrow enclosure the
    // centred start would sit left of the row labels — the rail has to be pushed right instead.
    const legacy = migrateProject({ settings: { enclosureWidth: 120, enclosureHeight: 300, enclosureDepth: 100, rows: 2 } })
    const geometry = getPanelGeometry(legacy, localDefinitions)

    expect((geometry.plateWidthMm - geometry.railWidthMm) / 2).toBeLessThan(ROW_LABEL_WIDTH_MM + 2)
    expect(geometry.railStartXMm).toBe(ROW_LABEL_WIDTH_MM + 2)
    expect(geometry.railStartXPx).toBeCloseTo((ROW_LABEL_WIDTH_MM + 2) * PANEL_MM_TO_PX, 6)
  })

  it('отдаёт ряду высоту самого высокого аппарата плюс зазор, но не меньше минимума', () => {
    const project = withDevice('tall-device')
    project.settings.rows = 2
    project.devices = [
      { ...createDevice(tallProduct, 0, 0), instanceId: 'tall', productId: tallProduct.id },
      { ...createDevice(definitions.get('ekf-mcb-1p-c6')!, 1, 0), instanceId: 'low', productId: 'ekf-mcb-1p-c6' },
    ]
    const geometry = getPanelGeometry(project, localDefinitions)

    expect(geometry.rowHeightsMm[0]).toBe(tallProduct.height + ROW_DEVICE_CLEARANCE_MM)
    expect(geometry.rowHeightsMm[1]).toBe(Math.max(72, DEFAULT_DEVICE_HEIGHT_MM + ROW_DEVICE_CLEARANCE_MM))
    expect(geometry.railHeightMm).toBe(DIN_PROFILE_HEIGHT_MM)
  })

  it('разводит ряды по вертикали без наложений и оставляет сверху полосу под провода', () => {
    const project = withDevice('tall-device')
    project.settings.rows = 3
    const geometry = getPanelGeometry(project, localDefinitions)

    expect(geometry.rowTopMm[0]).toBe(PLATE_TOP_MM + PLATE_WIRE_BAND_MM)
    for (let row = 1; row < geometry.rowTopMm.length; row += 1) {
      expect(geometry.rowTopMm[row]).toBeCloseTo(
        geometry.rowTopMm[row - 1]! + geometry.rowHeightsMm[row - 1]! + ROW_GAP_MM,
        6,
      )
    }
    // The last row plus the bottom plate margin has to stay inside the plate the cabinet grew to.
    const contentBottom = geometry.rowTopMm.at(-1)! + geometry.rowHeightsMm.at(-1)! + PLATE_BOTTOM_MM
    expect(contentBottom).toBeLessThanOrEqual(geometry.cabinetHeightMm + 0.001)
  })

  it('находит середину ряда, по которой ездят указатели мыши', () => {
    const geometry = getPanelGeometry(withDevice('ekf-mcb-1p-c6'), localDefinitions)

    expect(geometry.rowCenterYMm(0)).toBeCloseTo(geometry.rowTopMm[0]! + geometry.rowHeightsMm[0]! / 2, 6)
    expect(geometry.rowCenterYPx(0)).toBeCloseTo(geometry.rowCenterYMm(0) * PANEL_MM_TO_PX, 6)
  })

  it('отвечает конечным числом на несуществующий ряд, а не на NaN', () => {
    const geometry = getPanelGeometry(withDevice('ekf-mcb-1p-c6'), localDefinitions)

    const outOfRange = [
      geometry.railTopMm(99), geometry.railTopPx(99),
      geometry.deviceTopMm(99, 'ekf-mcb-1p-c6'), geometry.deviceTopPx(99, 'ekf-mcb-1p-c6'),
      geometry.rowCenterYMm(99), geometry.rowCenterYPx(99),
      geometry.railOffsetPx(99), geometry.deviceOffsetPx(99, 'ekf-mcb-1p-c6'),
      geometry.deviceOnRailOffsetPx(99, 'ekf-mcb-1p-c6'),
    ]
    expect(outOfRange.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('сажает рейку и аппарат по центру своего ряда, поэтому разница смещений — это половина разницы высот', () => {
    const project = withDevice('tall-device')
    const geometry = getPanelGeometry(project, localDefinitions)
    const productId = tallProduct.id

    expect(geometry.deviceOffsetPx(0, productId)).toBeCloseTo(((geometry.rowHeightsMm[0]! - tallProduct.height) / 2) * PANEL_MM_TO_PX, 6)
    expect(geometry.railOffsetPx(0)).toBeCloseTo(((geometry.rowHeightsMm[0]! - geometry.railHeightMm) / 2) * PANEL_MM_TO_PX, 6)
    // The board draws devices relative to the rail, so the two offsets may not be added twice.
    expect(geometry.deviceOnRailOffsetPx(0, productId)).toBeCloseTo(
      geometry.deviceOffsetPx(0, productId) - geometry.railOffsetPx(0),
      6,
    )
    expect(geometry.railTopMm(0) + geometry.railHeightMm / 2).toBeCloseTo(geometry.rowCenterYMm(0), 6)
    expect(geometry.deviceTopMm(0, productId) + geometry.deviceHeightMm(productId) / 2).toBeCloseTo(geometry.rowCenterYMm(0), 6)
  })

  it('берёт ширину аппарата из числа модулей товара, а не из покупного количества', () => {
    const project = withDevice('ekf-mcb-3p-c25')
    project.devices[0]!.quantity = 42
    const geometry = getPanelGeometry(project, localDefinitions)

    expect(geometry.deviceWidthMm('ekf-mcb-3p-c25')).toBe(3 * geometry.modulePitchMm)
    expect(geometry.deviceWidthPx('ekf-mcb-3p-c25')).toBeCloseTo(3 * geometry.modulePitchMm * PANEL_MM_TO_PX, 6)
  })

  it('рисует оставшийся товар как одноместный корпус, а не как пустое место', () => {
    const geometry = getPanelGeometry(withDevice('ekf-mcb-1p-c6'), localDefinitions)

    expect(geometry.deviceHeightMm('товар-исчез')).toBe(DEFAULT_DEVICE_HEIGHT_MM)
    expect(geometry.deviceHeightPx('товар-исчез')).toBeCloseTo(DEFAULT_DEVICE_HEIGHT_MM * PANEL_MM_TO_PX, 6)
    expect(geometry.deviceWidthMm('товар-исчез')).toBe(geometry.modulePitchMm)
  })

  it('не даёт корпусу стать ниже содержимого, даже если паспортные миллиметры меньше', () => {
    const project = withDevice('tall-device')
    project.settings.rows = 6
    project.settings.enclosureHeight = 200
    const geometry = getPanelGeometry(project, localDefinitions)

    const content = PLATE_TOP_MM + PLATE_WIRE_BAND_MM + geometry.rowHeightsMm.reduce((sum, height) => sum + height, 0)
      + (geometry.rowHeightsMm.length - 1) * ROW_GAP_MM + PLATE_BOTTOM_MM
    expect(geometry.cabinetHeightMm).toBeGreaterThanOrEqual(content)
    expect(geometry.plateHeightMm).toBe(geometry.cabinetHeightMm - PLATE_TOP_MM - PLATE_BOTTOM_MM)
  })

  it('ведёт себя одинаково для каталожного корпуса и для старого проекта без него', () => {
    const legacy = migrateProject({ settings: { enclosureWidth: 540, enclosureHeight: 650, enclosureDepth: 110, rows: 2 } })
    const geometry = getPanelGeometry(legacy, localDefinitions)

    expect(geometry.legacy).toBe(true)
    expect(geometry.capacity).toBe(29)
    expect(geometry.modulePitchMm).toBe(17.5)
    expect(geometry.cabinetWidthMm).toBe(540)
    expect(geometry.cabinetDepthMm).toBe(110)
    expect(geometry.plateWidthMm).toBe(540 - 6)
  })

  it('проверяет каждый товар каталога на конечные координаты', () => {
    const project = createProject('Все товары', 'apartment', { cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' })
    const geometry = getPanelGeometry(project, definitions)
    const numbers = [
      ...builtinCatalog.map((product) => geometry.deviceHeightMm(product.id)),
      ...builtinCatalog.map((product) => geometry.deviceWidthMm(product.id)),
      ...builtinCatalog.map((product) => geometry.deviceHeightPx(product.id)),
      ...builtinCatalog.map((product) => geometry.deviceWidthPx(product.id)),
      ...builtinCatalog.map((product) => geometry.deviceTopMm(0, product.id)),
      ...builtinCatalog.map((product) => geometry.deviceTopPx(0, product.id)),
    ]

    expect(numbers.every((value) => Number.isFinite(value) && value > 0)).toBe(true)
  })
})
