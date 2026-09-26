import { getProductFootprintModules, resolveLayout } from './layout'
import type { DeviceDefinition, PanelProject } from './types'

export const PANEL_MM_TO_PX = 1.5
export const DIN_PROFILE_HEIGHT_MM = 35
export const DEFAULT_DEVICE_HEIGHT_MM = 82
export const ROW_DEVICE_CLEARANCE_MM = 18
export const ROW_GAP_MM = 10
export const PLATE_INSET_MM = 3
export const PLATE_TOP_MM = 24
export const PLATE_BOTTOM_MM = 24
export const ROW_LABEL_WIDTH_MM = 14

const mm = (value: number) => value * PANEL_MM_TO_PX

export interface PanelGeometry {
  scale: number
  legacy: boolean
  capacity: number
  modulePitchMm: number
  cabinetWidthMm: number
  cabinetHeightMm: number
  cabinetDepthMm: number
  cabinetWidthPx: number
  cabinetHeightPx: number
  railWidthMm: number
  railWidthPx: number
  moduleWidthPx: number
  railHeightMm: number
  railHeightPx: number
  rowHeightsMm: number[]
  rowHeightsPx: number[]
  rowTopMm: number[]
  rowTopPx: number[]
  rowGapMm: number
  rowGapPx: number
  plateInsetMm: number
  plateInsetPx: number
  plateTopMm: number
  plateTopPx: number
  plateBottomMm: number
  plateBottomPx: number
  plateWidthMm: number
  plateWidthPx: number
  plateHeightMm: number
  plateHeightPx: number
  railStartXMm: number
  railStartXPx: number
  rowLabelWidthMm: number
  rowLabelWidthPx: number
  deviceHeightMm: (productId: string) => number
  deviceHeightPx: (productId: string) => number
  deviceWidthMm: (productId: string) => number
  deviceWidthPx: (productId: string) => number
  deviceTopMm: (row: number, productId: string) => number
  deviceTopPx: (row: number, productId: string) => number
  railTopMm: (row: number) => number
  railTopPx: (row: number) => number
  /** Rail and device offsets inside their own row, for row-relative rendering. */
  railOffsetPx: (row: number) => number
  deviceOffsetPx: (row: number, productId: string) => number
  deviceOnRailOffsetPx: (row: number, productId: string) => number
  rowCenterYMm: (row: number) => number
  rowCenterYPx: (row: number) => number
}

const productFor = (definitions: Map<string, DeviceDefinition>, productId: string) => definitions.get(productId)

export const getPanelGeometry = (project: PanelProject, definitions: Map<string, DeviceDefinition>): PanelGeometry => {
  const layout = resolveLayout(project)
  const settings = project.settings
  const deviceHeightMm = (productId: string) => Math.max(45, productFor(definitions, productId)?.height ?? DEFAULT_DEVICE_HEIGHT_MM)
  const rowHeightsMm = Array.from({ length: settings.rows }, (_, row) => {
    const deviceHeights = project.devices
      .filter((device) => device.row === row)
      .map((device) => deviceHeightMm(device.productId))
    return Math.max(72, Math.max(DEFAULT_DEVICE_HEIGHT_MM, ...deviceHeights) + ROW_DEVICE_CLEARANCE_MM)
  })
  const rowGapMm = ROW_GAP_MM
  const contentHeightMm = PLATE_TOP_MM + rowHeightsMm.reduce((sum, height) => sum + height, 0)
    + Math.max(0, rowHeightsMm.length - 1) * rowGapMm + PLATE_BOTTOM_MM
  const cabinetWidthMm = layout.cabinet?.width ?? settings.enclosureWidth
  const cabinetHeightMm = Math.max(layout.cabinet?.height ?? settings.enclosureHeight, contentHeightMm)
  const cabinetDepthMm = layout.cabinet?.depth ?? settings.enclosureDepth
  const plateWidthMm = Math.max(0, cabinetWidthMm - PLATE_INSET_MM * 2)
  const railWidthMm = layout.capacity * layout.modulePitchMm
  const railStartXMm = Math.max(
    ROW_LABEL_WIDTH_MM + 2,
    (plateWidthMm - railWidthMm) / 2,
  )
  const rowTopMm: number[] = []
  const rowTopPx: number[] = []
  let currentTopMm = PLATE_TOP_MM
  for (const heightMm of rowHeightsMm) {
    rowTopMm.push(currentTopMm)
    rowTopPx.push(mm(currentTopMm))
    currentTopMm += heightMm + rowGapMm
  }

  const railHeightMm = Math.min(DIN_PROFILE_HEIGHT_MM, Math.max(24, ...rowHeightsMm))
  const railTopMm = (row: number) => (rowTopMm[row] ?? 0) + ((rowHeightsMm[row] ?? 0) - railHeightMm) / 2
  const deviceTopMm = (row: number, productId: string) => (rowTopMm[row] ?? 0) + ((rowHeightsMm[row] ?? 0) - deviceHeightMm(productId)) / 2
  const deviceWidthMm = (productId: string) => getProductFootprintModules(productFor(definitions, productId) ?? { moduleWidth: 1 } as DeviceDefinition) * layout.modulePitchMm

  return {
    scale: PANEL_MM_TO_PX,
    legacy: layout.legacy,
    capacity: layout.capacity,
    modulePitchMm: layout.modulePitchMm,
    cabinetWidthMm,
    cabinetHeightMm,
    cabinetDepthMm,
    cabinetWidthPx: mm(cabinetWidthMm),
    cabinetHeightPx: mm(cabinetHeightMm),
    railWidthMm,
    railWidthPx: mm(railWidthMm),
    moduleWidthPx: mm(layout.modulePitchMm),
    railHeightMm,
    railHeightPx: mm(railHeightMm),
    rowHeightsMm,
    rowHeightsPx: rowHeightsMm.map(mm),
    rowTopMm,
    rowTopPx,
    rowGapMm,
    rowGapPx: mm(rowGapMm),
    plateInsetMm: PLATE_INSET_MM,
    plateInsetPx: mm(PLATE_INSET_MM),
    plateTopMm: PLATE_TOP_MM,
    plateTopPx: mm(PLATE_TOP_MM),
    plateBottomMm: PLATE_BOTTOM_MM,
    plateBottomPx: mm(PLATE_BOTTOM_MM),
    plateWidthMm,
    plateWidthPx: mm(plateWidthMm),
    plateHeightMm: Math.max(0, cabinetHeightMm - PLATE_TOP_MM - PLATE_BOTTOM_MM),
    plateHeightPx: mm(Math.max(0, cabinetHeightMm - PLATE_TOP_MM - PLATE_BOTTOM_MM)),
    railStartXMm,
    railStartXPx: mm(railStartXMm),
    rowLabelWidthMm: ROW_LABEL_WIDTH_MM,
    rowLabelWidthPx: mm(ROW_LABEL_WIDTH_MM),
    deviceHeightMm,
    deviceHeightPx: (productId) => mm(deviceHeightMm(productId)),
    deviceWidthMm,
    deviceWidthPx: (productId) => mm(deviceWidthMm(productId)),
    deviceTopMm,
    deviceTopPx: (row, productId) => mm(deviceTopMm(row, productId)),
    railTopMm,
    railTopPx: (row) => mm(railTopMm(row)),
    railOffsetPx: (row) => mm(((rowHeightsMm[row] ?? 0) - railHeightMm) / 2),
    deviceOffsetPx: (row, productId) => mm(((rowHeightsMm[row] ?? 0) - deviceHeightMm(productId)) / 2),
    deviceOnRailOffsetPx: (row, productId) => mm((((rowHeightsMm[row] ?? 0) - deviceHeightMm(productId)) / 2) - ((rowHeightsMm[row] ?? 0) - railHeightMm) / 2),
    rowCenterYMm: (row) => (rowTopMm[row] ?? 0) + (rowHeightsMm[row] ?? 0) / 2,
    rowCenterYPx: (row) => mm((rowTopMm[row] ?? 0) + (rowHeightsMm[row] ?? 0) / 2),
  }
}
