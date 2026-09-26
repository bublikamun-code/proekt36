import type { DeviceDefinition } from '../../../domain/types'

/** Frontal face drawings live in millimetres so a 1P and a 4P keep their real proportions. */
export const FACE_MODULE_MM = 18
export const FACE_DEFAULT_HEIGHT_MM = 82
export const FACE_MIN_HEIGHT_MM = 45
export const FACE_MIN_WIDTH_MM = 14

const EDGE_MM = 0.7
const CLIP_MM = 1.9
const CHASSIS_CHAMFER_MM = 2.1
const CHASSIS_FOOT_CHAMFER_MM = 0.7
const SIDEWALL_MM = 1.5
const PANEL_INSET_X_MM = 1.4
const PANEL_INSET_TOP_MM = 1.2
const PANEL_INSET_BOTTOM_MM = 2.7
const PANEL_MARGIN_MM = 0.9
const POCKET_MIN_MM = 4.6
const POCKET_MAX_MM = 9.6
const POCKET_SIDE_MM = 1.6
const POCKET_GAP_MM = 1.2
const POCKET_BEVEL_MM = 0.55
const TOGGLE_MIN_MM = 5
const TOGGLE_MAX_MM = 8.6
const TOGGLE_SEAT_MM = 0.9
const MARK_SIDE_MM = 1.4

export type FaceDetail = 'minimal' | 'compact' | 'full'
export type FaceAnchor = 'start' | 'middle' | 'end'

export interface FaceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FacePoint {
  x: number
  y: number
}

/** A terminal opening drawn in two stages: a bevelled rim, a dark well and a slotted screw. */
export interface FacePocket extends FaceRect {
  column: number
  topLabel: string
  bottomLabel: string
  well: FaceRect
  screw: FaceRect & { cx: number; cy: number; r: number }
}

/** An asymmetric 2.5D paddle: the grip end is chamfered and the body leans off-axis. */
export interface FaceToggle extends FaceRect {
  column: number
  shared: boolean
  seat: FaceRect
  points: FacePoint[]
  grips: FacePoint[][]
  shine: FacePoint[]
}

export interface FaceLabel {
  text: string
  x: number
  y: number
  size: number
  weight: 400 | 600 | 700
  anchor: FaceAnchor
  vertical?: boolean
  muted?: boolean
}

export interface DeviceFaceMetrics {
  widthMm: number
  heightMm: number
  moduleWidth: number
  poles: number
  detail: FaceDetail
  body: FaceRect
  outline: FacePoint[]
  sidewalls: FaceRect[]
  panel: FaceRect
  clip: FaceRect
  clipHook: FaceRect
  columns: number
  sharedToggle: boolean
  pockets: FacePocket[]
  toggles: FaceToggle[]
  markArea: FaceRect
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** One module is too narrow for a full marking block, so detail drops instead of text overflowing. */
export const faceDetailFor = (widthMm: number): FaceDetail => (widthMm < 24 ? 'minimal' : widthMm < 32 ? 'compact' : 'full')

/** Neutral plastic shades keyed by device family, so the board does not look like one cloned sprite. */
export const faceShellFamily = (product: DeviceDefinition): string => {
  const code = (product.series || product.sku || product.brand || '').trim().toUpperCase()
  if (/^(NB1|NB3|FI-10|AVO|VAO|BAO|A9F|5SL|5SY)/.test(code)) return 'light'
  if (/^(KM|RXM|RKM|CW|AF)/.test(code)) return 'warm'
  if (/^(NGU|NU6|NJVA|PR|SPD)/.test(code)) return 'graphite'
  if (/^(DRP|PRD|PHPS|HDR|NDR)/.test(code)) return 'psu'
  if (code === 'FORK' || product.category === 'busbar') return 'busbar'
  if (code.startsWith('CITY9')) return 'city9'
  return 'generic'
}

/** Linked 1P+N devices carry one lever for both poles, exactly like the photographed RCCB. */
export const faceSharedToggle = (product: DeviceDefinition): boolean => {
  if (!['MCB', 'RCCB', 'RCBO'].includes(product.category)) return false
  return Math.max(1, product.poles || 1) < Math.max(1, product.moduleWidth || 1)
}

/** How many terminal columns the chassis shows on top and bottom. */
export const faceTerminalColumns = (product: DeviceDefinition): number => {
  const moduleWidth = Math.max(1, Math.round(product.moduleWidth || 1))
  const poles = Math.max(1, Math.round(product.poles || 1))
  if (product.category === 'busbar' || product.category === 'terminals') return 0
  if (product.category === 'relay') return Math.min(Math.max(poles, 1), 4)
  if (product.category === 'PSU') return Math.min(moduleWidth, 4)
  if (product.category === 'meter') return Math.min(moduleWidth, 6)
  return faceSharedToggle(product) ? moduleWidth : Math.min(poles, moduleWidth)
}

const faceTerminalLabel = (product: DeviceDefinition, column: number, columns: number, bottom: boolean): string => {
  if (product.category === 'PSU') return ['L', 'N', '+', '−'][column] ?? String(column + 1)
  if ((product.category === 'RCCB' || product.category === 'RCBO') && columns === 2 && product.poles === 1) {
    return bottom ? (column === 0 ? '3' : '4') : (column === 0 ? '1' : 'N')
  }
  if (columns <= 2) return String(column + 1 + (bottom ? columns : 0))
  const top = column % 2 === 0 ? column + 1 : column + 2
  return String(bottom ? top + 1 : top)
}

const xAt = (from: FacePoint, to: FacePoint, y: number): number => {
  const span = to.y - from.y
  return span === 0 ? from.x : from.x + ((to.x - from.x) * (y - from.y)) / span
}

/** A recessed terminal: bevelled rim, dark well and a slotted screw. */
const buildPocket = (x: number, y: number, width: number, height: number, column: number, topLabel: string, bottomLabel: string): FacePocket => {
  const well = {
    x: x + POCKET_BEVEL_MM,
    y: y + POCKET_BEVEL_MM,
    width: Math.max(1, width - POCKET_BEVEL_MM * 2),
    height: Math.max(1, height - POCKET_BEVEL_MM * 1.7),
  }
  const radius = Math.min(well.width, well.height) * 0.28
  return {
    column,
    x,
    y,
    width,
    height,
    topLabel,
    bottomLabel,
    well,
    screw: { x: well.x, y: well.y, width: well.width, height: well.height, cx: well.x + well.width / 2, cy: well.y + well.height * 0.62, r: radius },
  }
}

/** The 2.5D paddle outline: the grip end is narrower, chamfered and leans off the vertical axis. */
const buildToggle = (rect: FaceRect, column: number, shared: boolean): FaceToggle => {
  const skew = rect.width * 0.12
  const chamfer = Math.min(rect.width * 0.3, 1.5)
  const topY = rect.y + rect.height * 0.1
  const tilt = rect.height * 0.06
  const points: FacePoint[] = [
    { x: rect.x + skew + chamfer, y: topY },
    { x: rect.x + rect.width - skew - chamfer, y: topY + tilt },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]
  const grips = [0.42, 0.58, 0.74].map((ratio) => {
    const y = rect.y + rect.height * ratio
    const inset = Math.min(0.8, rect.width * 0.16)
    return [
      { x: xAt(points[0]!, points[3]!, y) + inset, y },
      { x: xAt(points[1]!, points[2]!, y) - inset, y },
    ]
  })
  const seatWidth = rect.width + TOGGLE_SEAT_MM * 2
  return {
    ...rect,
    column,
    shared,
    points,
    grips,
    shine: [
      { x: points[0]!.x + 0.6, y: points[0]!.y + 0.7 },
      { x: points[1]!.x - 0.6, y: points[1]!.y + 0.7 },
    ],
    seat: { x: rect.x - TOGGLE_SEAT_MM, y: rect.y - 1.1, width: seatWidth, height: rect.height + 2.2 },
  }
}

export const getDeviceFaceMetrics = (product: DeviceDefinition): DeviceFaceMetrics => {
  const moduleWidth = Math.max(1, Math.round(product.moduleWidth || 1))
  const poles = Math.max(1, Math.round(product.poles || 1))
  const widthMm = Math.max(FACE_MIN_WIDTH_MM, moduleWidth * FACE_MODULE_MM)
  const heightMm = clamp(product.height || FACE_DEFAULT_HEIGHT_MM, FACE_MIN_HEIGHT_MM, 260)
  const columns = faceTerminalColumns(product)
  const sharedToggle = faceSharedToggle(product)
  const columnWidth = widthMm / Math.max(1, columns || moduleWidth)
  const body: FaceRect = { x: EDGE_MM, y: EDGE_MM, width: widthMm - EDGE_MM * 2, height: heightMm - EDGE_MM * 2 }
  const chamfer = Math.min(CHASSIS_CHAMFER_MM, body.width * 0.28, body.height * 0.14)
  const foot = Math.min(CHASSIS_FOOT_CHAMFER_MM, body.height * 0.06)
  const outline: FacePoint[] = [
    { x: body.x, y: body.y + chamfer },
    { x: body.x + chamfer, y: body.y },
    { x: body.x + body.width - chamfer, y: body.y },
    { x: body.x + body.width, y: body.y + chamfer },
    { x: body.x + body.width, y: body.y + body.height - foot },
    { x: body.x + body.width - foot, y: body.y + body.height },
    { x: body.x + foot, y: body.y + body.height },
    { x: body.x, y: body.y + body.height - foot },
  ]
  const sidewalls: FaceRect[] = [
    { x: body.x, y: body.y + chamfer, width: SIDEWALL_MM, height: body.height - chamfer - foot },
    { x: body.x + body.width - SIDEWALL_MM, y: body.y + chamfer, width: SIDEWALL_MM, height: body.height - chamfer - foot },
  ]
  const panel: FaceRect = {
    x: body.x + PANEL_INSET_X_MM,
    y: body.y + PANEL_INSET_TOP_MM,
    width: body.width - PANEL_INSET_X_MM * 2,
    height: body.height - PANEL_INSET_TOP_MM - PANEL_INSET_BOTTOM_MM,
  }
  const pocketHeight = clamp(heightMm * 0.095, 5.8, 8.6)
  const pocketWidth = clamp(columnWidth - POCKET_GAP_MM * 2 - POCKET_SIDE_MM, POCKET_MIN_MM, POCKET_MAX_MM)
  const topPocketY = panel.y + PANEL_MARGIN_MM
  const bottomPocketY = panel.y + panel.height - PANEL_MARGIN_MM - pocketHeight

  const pockets: FacePocket[] = Array.from({ length: columns }, (_, column) => {
    const center = columnWidth * (column + 0.5)
    return buildPocket(
      clamp(center - pocketWidth / 2, panel.x + 0.4, panel.x + panel.width - pocketWidth - 0.4),
      topPocketY,
      pocketWidth,
      pocketHeight,
      column,
      faceTerminalLabel(product, column, columns, false),
      faceTerminalLabel(product, column, columns, true),
    )
  })

  const bottomPockets = pockets.map((pocket) => buildPocket(pocket.x, bottomPocketY, pocket.width, pocket.height, pocket.column, pocket.topLabel, pocket.bottomLabel))

  const toggles: FaceToggle[] = sharedToggle
    ? [buildToggle({
        x: widthMm * 0.09,
        y: heightMm * 0.4,
        width: clamp(widthMm * 0.46, 9, 15),
        height: clamp(heightMm * 0.14, 9, 14),
      }, 0, true)]
    : Array.from({ length: columns }, (_, column) => {
        const toggleWidth = clamp(columnWidth - 2.6, TOGGLE_MIN_MM, TOGGLE_MAX_MM)
        return buildToggle({
          x: columnWidth * (column + 0.5) - toggleWidth / 2,
          y: heightMm * 0.27,
          width: toggleWidth,
          height: clamp(heightMm * 0.23, 9, 21),
        }, column, false)
      })

  const clip: FaceRect = { x: body.x + 1, y: heightMm - EDGE_MM - CLIP_MM, width: body.width - 2, height: CLIP_MM - 0.4 }
  const seatLimit = Math.max(0, widthMm - 0.4)
  for (const toggle of toggles) {
    toggle.seat.x = clamp(toggle.seat.x, 0.2, Math.max(0.2, seatLimit - toggle.seat.width))
  }

  return {
    widthMm,
    heightMm,
    moduleWidth,
    poles,
    detail: faceDetailFor(widthMm),
    body,
    outline,
    sidewalls,
    panel,
    clip,
    clipHook: { x: widthMm / 2 - 2.2, y: clip.y - 0.5, width: 4.4, height: 1.8 },
    columns,
    sharedToggle,
    pockets: [...pockets, ...bottomPockets],
    toggles,
    markArea: { x: MARK_SIDE_MM, y: heightMm * 0.6, width: widthMm - MARK_SIDE_MM * 2, height: heightMm * 0.3 },
  }
}

/** Conservative advance-width estimate so printed text never leaves its own field. */
export const fitFaceText = (text: string, maxWidthMm: number, sizeMm: number): string => {
  const maxChars = Math.max(1, Math.floor(maxWidthMm / (sizeMm * 0.62)))
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

export const faceLabels = (product: DeviceDefinition, metrics: DeviceFaceMetrics): FaceLabel[] => {
  const { widthMm, heightMm, detail, markArea } = metrics
  const labels: FaceLabel[] = []
  const brand = (product.brand || '').trim()
  const series = (product.series || '').replace('NB1-63H', 'NB1').trim()
  const rating = product.ratedCurrent > 0 ? `${product.ratedCurrent}A` : ''
  const residual = product.residualCurrentMa ? `IΔn ${product.residualCurrentMa}mA` : ''
  const right = widthMm - markArea.x
  const middle = widthMm / 2

  if (detail === 'minimal') {
    const head = fitFaceText(brand || series || product.sku || '', widthMm - 2.4, 3)
    if (head) labels.push({ text: head, x: middle, y: heightMm * 0.66, size: 3, weight: 700, anchor: 'middle' })
    if (rating) labels.push({ text: rating, x: middle, y: heightMm * 0.8, size: 3.6, weight: 700, anchor: 'middle' })
    return labels
  }

  if (brand) labels.push({ text: fitFaceText(brand, 12, 2.6), x: markArea.x, y: markArea.y + 3, size: 2.6, weight: 600, anchor: 'start' })
  if (series) labels.push({ text: fitFaceText(series, 14, 3), x: markArea.x, y: markArea.y + 6.6, size: 3, weight: 700, anchor: 'start' })
  if (rating) labels.push({ text: rating, x: right, y: markArea.y + 4, size: 3.8, weight: 700, anchor: 'end' })
  if (product.tripCurve) labels.push({ text: product.tripCurve, x: right - 7.4, y: markArea.y + 4, size: 3, weight: 700, anchor: 'end' })
  if (detail === 'full') {
    if (residual) labels.push({ text: fitFaceText(residual, 14, 2.6), x: right, y: markArea.y + 9.4, size: 2.6, weight: 600, anchor: 'end' })
    labels.push({ text: `~${product.voltage}V`, x: right, y: markArea.y + 13.4, size: 2.4, weight: 400, anchor: 'end', muted: true })
    labels.push({ text: 'I On', x: right, y: heightMm * 0.26, size: 2.4, weight: 600, anchor: 'end', muted: true })
    labels.push({ text: product.sku || '', x: widthMm - 1.4, y: heightMm - 3, size: 2.2, weight: 400, anchor: 'end', vertical: true, muted: true })
  }
  return labels
}
