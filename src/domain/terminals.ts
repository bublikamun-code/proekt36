import type { DeviceDefinition } from './types'

/**
 * Terminals are the single source of truth shared by the frontal face drawing and the wire
 * router. Both need to know which clamp a conductor enters and what it carries, and a
 * disagreement between them shows up as a wire that stops in the middle of a plastic shell.
 */
export type TerminalSide = 'top' | 'bottom'
export type TerminalType = 'phase' | 'neutral' | 'pe' | 'control' | 'power'

export interface TerminalRef {
  deviceId: string
  /** 1-based pole as printed on the device: 1, 2, 3… For a 1P+N RCCB the N pole is its own number. */
  pole: number
  side: TerminalSide
}

export interface TerminalInfo {
  pole: number
  side: TerminalSide
  /** Marking as printed on the device, e.g. '1', 'N', '5'. */
  label: string
  type: TerminalType
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** How many terminal columns a device exposes on top and on bottom. */
export const terminalColumns = (product: DeviceDefinition): number => {
  const moduleWidth = Math.max(1, Math.round(product.moduleWidth || 1))
  const poles = Math.max(1, Math.round(product.poles || 1))
  // A busbar feeds through its pad, not a screw. A terminal block is the opposite case: every
  // pole is a screw pair (feed in, load out), so a conductor can land on it the CAD way — into
  // the clamp it names — and the face drawing gets a pocket with a screw per column.
  if (product.category === 'busbar') return 0
  if (product.category === 'terminals') return Math.min(moduleWidth, 4)
  if (product.category === 'relay') return Math.min(Math.max(poles, 1), 4)
  if (product.category === 'PSU') return Math.min(moduleWidth, 4)
  if (product.category === 'meter') return Math.min(moduleWidth, 6)
  return hasSharedToggle(product) ? moduleWidth : Math.min(poles, moduleWidth)
}

/** A 1P+N device is one module wider than its pole count, so it carries a linked lever. */
export const hasSharedToggle = (product: DeviceDefinition): boolean => {
  if (!['MCB', 'RCCB', 'RCBO'].includes(product.category)) return false
  return Math.max(1, product.poles || 1) < Math.max(1, product.moduleWidth || 1)
}

/**
 * Pole markings follow the IEC drawing convention: a single-pole device numbers 1/2, a 1P+N
 * RCCB numbers 1/N over 3/4, and a three-pole device interleaves 1/3/5 over 2/4/6.
 */
export const terminalLabel = (product: DeviceDefinition, column: number, columns: number, bottom: boolean): string => {
  if (product.category === 'PSU') return ['L', 'N', '+', '−'][column] ?? String(column + 1)
  if ((product.category === 'RCCB' || product.category === 'RCBO') && columns === 2 && product.poles === 1) {
    return bottom ? (column === 0 ? '3' : '4') : (column === 0 ? '1' : 'N')
  }
  if (columns <= 2) return String(column + 1 + (bottom ? columns : 0))
  // Interleaved numbering: pole 1 in, pole 2 out, pole 3 in… so a multi-pole device reads
  // 1/3/5 above and 2/4/6 below. Deriving the odd number from the column index — rather
  // than from the column parity — is what keeps every clamp on the device unique.
  const incoming = column * 2 + 1
  return String(bottom ? incoming + 1 : incoming)
}

/** What a pole carries, so the router and the checks can insist that N and PE are not swapped. */
export const terminalType = (product: DeviceDefinition, column: number, columns: number, bottom: boolean): TerminalType => {
  const label = terminalLabel(product, column, columns, bottom)
  if (label === 'N') return 'neutral'
  if (label === 'PE') return 'pe'
  if (product.category === 'PSU') return label === 'L' || label === 'N' ? 'power' : 'control'
  if (product.category === 'terminals' || product.category === 'relay') return 'control'
  return 'phase'
}

/** Every pole of a device, top row first, so callers can build menus and hit targets in order. */
export const deviceTerminals = (product: DeviceDefinition): TerminalInfo[] => {
  const columns = terminalColumns(product)
  const terminals: TerminalInfo[] = []
  for (const side of ['top', 'bottom'] as const) {
    for (let column = 0; column < columns; column += 1) {
      const bottom = side === 'bottom'
      terminals.push({
        pole: parseInt(terminalLabel(product, column, columns, bottom), 10) || column + 1,
        side,
        label: terminalLabel(product, column, columns, bottom),
        type: terminalType(product, column, columns, bottom),
      })
    }
  }
  return terminals
}

/**
 * Horizontal centre of a terminal column in millimetres, measured from the left edge of the
 * device face. Mirrors the pocket layout in the face drawing so a wire lands on its clamp.
 */
export const terminalColumnCenterMm = (product: DeviceDefinition, pole: number, faceWidthMm: number): number => {
  const columns = terminalColumns(product)
  const moduleWidth = Math.max(1, Math.round(product.moduleWidth || 1))
  const column = Math.max(0, Math.min(columns - 1, pole - 1))
  const columnWidth = faceWidthMm / Math.max(1, columns || moduleWidth)
  return columnWidth * (column + 0.5)
}

/** Which drawing column a pole belongs to, needed because markings skip numbers on 3P+ devices. */
export const terminalColumnForPole = (product: DeviceDefinition, pole: number): number => {
  const columns = terminalColumns(product)
  // Both rows are searched: on a three-pole device the top clamps read 1/3/5 and the bottom
  // 2/4/6, so looking only at the top row sends a wire to bottom pole 2 to the wrong column.
  for (const bottom of [false, true]) {
    for (let column = 0; column < columns; column += 1) {
      if (parseInt(terminalLabel(product, column, columns, bottom), 10) === pole) return column
      if (terminalLabel(product, column, columns, bottom) === `N` && pole === 0) return column
    }
  }
  return clamp(pole - 1, 0, Math.max(0, columns - 1))
}

export const terminalKey = (ref: TerminalRef): string => `${ref.deviceId}:${ref.pole}:${ref.side}`

export const sameTerminal = (left: TerminalRef | undefined, right: TerminalRef | undefined): boolean =>
  Boolean(left && right && left.deviceId === right.deviceId && left.pole === right.pole && left.side === right.side)

/** A stable text for the inspector and the wire tooltip: «QF02:1 верх». */
export const terminalDisplayName = (ref: TerminalRef, address: string): string => {
  const side = ref.side === 'top' ? 'верх' : 'низ'
  const label = ref.pole === 0 ? 'N' : String(ref.pole)
  return `${address || ref.deviceId}:${label} ${side}`
}

/**
 * The same text, but with the marking actually printed beside that clamp. A pole number is not
 * always the marking: the N terminal of a 1P+N RCBO sits in column 2 and would otherwise be
 * labelled «2», which is exactly the number the drawing puts on the neighbouring clamp.
 */
export const terminalMarkedName = (product: DeviceDefinition, ref: TerminalRef, address: string): string => {
  const columns = terminalColumns(product)
  const column = terminalColumnForPole(product, ref.pole)
  return `${address || ref.deviceId}:${terminalLabel(product, column, columns, ref.side === 'bottom')} ${ref.side === 'top' ? 'верх' : 'низ'}`
}

/** Phase-coloured wires: the colours a Russian installer expects on a board drawing. */
export const WIRE_COLORS = {
  phase1: '#c0392b',
  phase2: '#8e44ad',
  phase3: '#2c6fbb',
  neutral: '#1f6fb4',
  pe: '#4f9d3a',
  jumper: '#5a6672',
} as const

export const wireColor = (connection: { fromBus?: string; phase?: 1 | 2 | 3; kind?: string; color?: string }): string => {
  if (connection.kind === 'jumper' || connection.kind === 'busbar') return connection.color || WIRE_COLORS.jumper
  if (connection.color) return connection.color
  if (connection.fromBus === 'N') return WIRE_COLORS.neutral
  if (connection.fromBus === 'PE') return WIRE_COLORS.pe
  const phase = connection.phase ?? 1
  return phase === 2 ? WIRE_COLORS.phase2 : phase === 3 ? WIRE_COLORS.phase3 : WIRE_COLORS.phase1
}

/**
 * Where the clamps physically sit on the frontal face, in millimetres from the face's top-left
 * corner. The face drawing and the wire router both read these numbers: a wire that stops a few
 * millimetres off its terminal is the most visible way to get this wrong.
 */
export const FACE_MODULE_MM = 18
/** Narrowest face the drawing bothers to resolve, so a stub product still reads as a device. */
export const FACE_MIN_WIDTH_MM = 14

const FACE_EDGE_MM = 0.7
const FACE_PANEL_INSET_X_MM = 1.4
const FACE_PANEL_INSET_TOP_MM = 1.2
const FACE_PANEL_INSET_BOTTOM_MM = 2.7
const FACE_PANEL_MARGIN_MM = 0.9
const POCKET_MIN_MM = 4.6
const POCKET_MAX_MM = 9.6
const POCKET_GAP_MM = 1.2
const POCKET_SIDE_MM = 1.6
const POCKET_BEVEL_MM = 0.55

export interface FaceRectMm { x: number; y: number; width: number; height: number }

/** Terminal band of the procedural chassis: the pocket rects and the screw centre inside each. */
export interface TerminalPocketGeometry {
  top: FaceRectMm
  bottom: FaceRectMm
  /** Centre of the slotted screw, which is where a conductor is actually clamped. */
  screw: { topY: number; bottomY: number }
}

export const genericTerminalPockets = (widthMm: number, heightMm: number, terminalCount: number): TerminalPocketGeometry => {
  const columns = Math.max(1, terminalCount)
  const panel: FaceRectMm = {
    x: FACE_EDGE_MM + FACE_PANEL_INSET_X_MM,
    y: FACE_EDGE_MM + FACE_PANEL_INSET_TOP_MM,
    width: widthMm - (FACE_EDGE_MM + FACE_PANEL_INSET_X_MM) * 2,
    height: heightMm - FACE_EDGE_MM * 2 - FACE_PANEL_INSET_TOP_MM - FACE_PANEL_INSET_BOTTOM_MM,
  }
  const columnWidth = widthMm / columns
  const pocketHeight = clamp(heightMm * 0.095, 5.8, 8.6)
  const pocketWidth = clamp(columnWidth - POCKET_GAP_MM * 2 - POCKET_SIDE_MM, POCKET_MIN_MM, POCKET_MAX_MM)
  const x = clamp(columnWidth * 0.5 - pocketWidth / 2, panel.x + 0.4, panel.x + panel.width - pocketWidth - 0.4)
  const topY = panel.y + FACE_PANEL_MARGIN_MM
  const bottomY = panel.y + panel.height - FACE_PANEL_MARGIN_MM - pocketHeight
  return {
    top: { x, y: topY, width: pocketWidth, height: pocketHeight },
    bottom: { x, y: bottomY, width: pocketWidth, height: pocketHeight },
    screw: { topY: topY + POCKET_BEVEL_MM + (pocketHeight - POCKET_BEVEL_MM * 1.7) * 0.62, bottomY: bottomY + POCKET_BEVEL_MM + (pocketHeight - POCKET_BEVEL_MM * 1.7) * 0.62 },
  }
}

/** CHINT NB/NL families, keyed by the series code that selects the manufacturer's drawing. */
export type ChintKind = 'nb1' | 'nbh8' | 'nl1' | 'nb1l' | 'nb1l40' | 'nb2le' | 'nb310l' | 'nbh8le'

/** CHINT NB/NL face heights measured off the manufacturer front drawings, millimetres. */
export const CHINT_FACE_HEIGHTS: Record<ChintKind, number> = {
  nb1: 86, nbh8: 86, nl1: 86, nb1l: 85, nb1l40: 88, nb2le: 95, nb310l: 85, nbh8le: 86,
}

/** Which drawing the face follows; the series code picks the family template. */
export const chintFaceKind = (product: DeviceDefinition): ChintKind => {
  const code = (product.series || product.sku || '').trim().toUpperCase()
  if (/^NBH8LE/.test(code)) return 'nbh8le'
  if (/^NBH8/.test(code)) return 'nbh8'
  if (/^NB2/.test(code)) return 'nb2le'
  if (/^NB1L-?(40|63)/.test(code)) return 'nb1l40'
  if (/^NB1L/.test(code)) return 'nb1l'
  if (/^NB310L/.test(code)) return 'nb310l'
  if (/^NL1/.test(code)) return 'nl1'
  return 'nb1'
}

/**
 * Terminal screw centres per CHINT family, millimetres from the face top. Off the 2D front
 * drawings that ship with the series; the face drawing and the wire router read the same table.
 */
export const CHINT_TERMINAL_SCREWS: Record<ChintKind, { topMm: number; bottomMm: number }> = {
  nb1: { topMm: 9.9, bottomMm: 72.8 },
  nbh8: { topMm: 9.3, bottomMm: 72.2 },
  nl1: { topMm: 5.9, bottomMm: 74.1 },
  nb1l: { topMm: 8.4, bottomMm: 72.5 },
  nb1l40: { topMm: 9.7, bottomMm: 71 },
  nb2le: { topMm: 12.8, bottomMm: 75.7 },
  nb310l: { topMm: 9.7, bottomMm: 70 },
  nbh8le: { topMm: 13.1, bottomMm: 66.7 },
}

/** Face height the generic chassis is drawn at; the CHINT platform uses its own table instead. */
export const genericFaceHeightMm = (product: DeviceDefinition): number => clamp(product.height || 82, 45, 260)

/** True when the product is drawn on the CHINT NB/NL platform rather than the generic chassis. */
export const usesChintPlatform = (product: DeviceDefinition): boolean =>
  /CHINT/i.test(product.brand || '') && ['MCB', 'RCCB', 'RCBO'].includes(product.category)

/** The viewBox the frontal face is drawn into, millimetres. */
export const faceSizeMm = (product: DeviceDefinition): { widthMm: number; heightMm: number } => ({
  widthMm: Math.max(FACE_MIN_WIDTH_MM, Math.max(1, Math.round(product.moduleWidth || 1)) * FACE_MODULE_MM),
  heightMm: usesChintPlatform(product) ? CHINT_FACE_HEIGHTS[chintFaceKind(product)] : genericFaceHeightMm(product),
})

export interface FacePlacement {
  /** Face millimetres per board millimetre: the SVG scales its viewBox into the device box. */
  scale: number
  offsetXMm: number
  offsetYMm: number
}

/**
 * Where the drawn face lands inside the box the board gives the device. The face SVG carries
 * `preserveAspectRatio="xMidYMid meet"`, so it is scaled down until it fits and then centred in
 * whatever the panel geometry reserved. A wire routed without this lands on a different point of
 * the shell than the screw it names, which is the one thing a wiring drawing cannot get wrong.
 */
export const facePlacementMm = (product: DeviceDefinition, boxWidthMm: number, boxHeightMm: number): FacePlacement => {
  const face = faceSizeMm(product)
  const scale = Math.min(boxWidthMm / face.widthMm, boxHeightMm / face.heightMm)
  return {
    scale,
    offsetXMm: (boxWidthMm - face.widthMm * scale) / 2,
    offsetYMm: (boxHeightMm - face.heightMm * scale) / 2,
  }
}

/**
 * The clamp a conductor enters, in face millimetres from the face's top-left corner. Returns
 * nothing for a device that has no clamps of its own — a busbar is fed at the bar, not at a
 * terminal. Pass the result through `facePlacementMm` to reach board coordinates.
 */
export const terminalAnchorMm = (
  product: DeviceDefinition,
  pole: number,
  side: TerminalSide,
): { x: number; y: number } | null => {
  const columns = terminalColumns(product)
  if (columns <= 0) return null
  const column = terminalColumnForPole(product, pole)
  const { widthMm, heightMm } = faceSizeMm(product)
  if (usesChintPlatform(product)) {
    // The CHINT drawings repeat one physical cell per terminal column, so the screws sit on the
    // same column pitch the rest of the module counts with. Dividing by the pole count instead
    // throws every column past the last pole off the face: a linked-lever device has more
    // columns than poles, and its wire would stop in mid-air beside the device.
    const screws = CHINT_TERMINAL_SCREWS[chintFaceKind(product)]
    return { x: (widthMm / columns) * (column + 0.5), y: side === 'top' ? screws.topMm : screws.bottomMm }
  }
  const pockets = genericTerminalPockets(widthMm, heightMm, columns)
  return {
    x: (widthMm / columns) * (column + 0.5),
    y: side === 'top' ? pockets.screw.topY : pockets.screw.bottomY,
  }
}
