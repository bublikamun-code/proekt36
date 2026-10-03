import { wireColor } from './wiring'
import type { BusType } from './types'

/**
 * The three rails of the panel, drawn where the wiring comes from.
 *
 * Until now a wire that fed a device straight from the bus started at a hardcoded point in the
 * left-hand margin, `y` above the device it happened to serve. It looked like a line that began in
 * mid-air, and the wire tool had nothing to aim at: a connection could be recorded, but the person
 * drawing the board could not create one, and nothing on the picture said where L, N and PE were.
 *
 * The rails live in the plate margin above the first row — the space the geometry already reserves
 * at the top of the mounting plate (`PLATE_TOP_MM`, 24 mm). Putting them there means the drawing
 * gains a place the wires really come from without moving a single device or changing a single
 * number the old editor also uses.
 */

export const BUS_ORDER: BusType[] = ['L', 'N', 'PE']

export const BUS_RAIL_TOP_MM = 4
export const BUS_RAIL_HEIGHT_MM = 3
export const BUS_RAIL_PITCH_MM = 6
export const BUS_RAIL_OVERHANG_MM = 3

/** What the rail is called in a drawing and in a refusal message. */
export const BUS_TITLE: Record<BusType, string> = {
  L: 'Фаза L',
  N: 'Нейтраль N',
  PE: 'Заземление PE',
}

export const BUS_SHORT_TITLE: Record<BusType, string> = {
  L: 'шина L',
  N: 'шина N',
  PE: 'шина PE',
}

export interface BusRail {
  bus: BusType
  label: string
  title: string
  /** Left edge in board millimetres. */
  x: number
  /** Top edge in board millimetres. */
  y: number
  width: number
  height: number
  color: string
  /** The line a wire leaves from: the bottom edge of the rail. */
  tapY: number
}

/**
 * The rails for this board, in board millimetres.
 *
 * `railStartX` and `railWidthMm` come from the same geometry the rows come from, so a rail always
 * spans the rail the devices stand on, whatever cabinet the project uses.
 */
export const buildBusRails = (railStartX: number, railWidthMm: number): BusRail[] => {
  const x = Math.max(0, railStartX - BUS_RAIL_OVERHANG_MM)
  const width = Math.max(0, railWidthMm + BUS_RAIL_OVERHANG_MM * 2)
  return BUS_ORDER.map((bus, index) => {
    const y = BUS_RAIL_TOP_MM + index * BUS_RAIL_PITCH_MM
    return {
      bus,
      label: bus,
      title: BUS_TITLE[bus],
      x,
      y,
      width,
      height: BUS_RAIL_HEIGHT_MM,
      color: wireColor(bus),
      tapY: y + BUS_RAIL_HEIGHT_MM,
    }
  })
}

/** The bottom of the bus zone, which the first row has to stay clear of. */
export const busZoneBottomMm = () => BUS_RAIL_TOP_MM + BUS_ORDER.length * BUS_RAIL_PITCH_MM