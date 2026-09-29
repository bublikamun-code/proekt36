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
  if (product.category === 'busbar' || product.category === 'terminals') return 0
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
  for (let column = 0; column < columns; column += 1) {
    if (parseInt(terminalLabel(product, column, columns, false), 10) === pole) return column
    if (terminalLabel(product, column, columns, false) === `N` && pole === 0) return column
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
