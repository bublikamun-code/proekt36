/**
 * Voltage drop for an outgoing copper cable — the number a cable schedule is checked against.
 *
 * The formulas are the schoolbook ones for a copper conductor (ρ = 0.0175 Ω·mm²/m at working
 * temperature): a single-phase circuit pays for the conductor twice (there and back), a three-phase
 * circuit pays √3 times for the length. The percentage is taken of 230 V or 400 V respectively,
 * because that is the voltage the load actually sees.
 */

/** Resistivity of a copper conductor at working temperature, Ω·mm²/m. */
export const COPPER_RESISTIVITY = 0.0175

/** The drop a cable schedule treats as the ceiling for a final circuit, in percent. */
export const CABLE_DROP_LIMIT_PERCENT = 4

export type VoltageSystem = 1 | 3

export interface VoltageDropInput {
  /** Route length in metres, one way. */
  lengthM: number
  /** Load current in amperes. */
  currentA: number
  /** Conductor cross-section in mm². */
  crossSectionMm2: number
  /** 1 for 230 V, 3 for 400 V. */
  system: VoltageSystem
}

export interface VoltageDropResult {
  /** Absolute drop in volts. */
  dropV: number
  /** Drop relative to the nominal voltage, in percent. */
  dropPercent: number
  /** True when the drop is within the schedule's ceiling. */
  ok: boolean
}

export const voltageDrop = ({ lengthM, currentA, crossSectionMm2, system }: VoltageDropInput): VoltageDropResult => {
  // A cable nobody has measured yet, a load nobody has named or a cross-section of zero all mean
  // «there is nothing to check», not «the drop is zero and everything is fine» — the caller
  // distinguishes them by not asking.
  if (lengthM <= 0 || currentA <= 0 || crossSectionMm2 <= 0) {
    return { dropV: 0, dropPercent: 0, ok: true }
  }
  const nominalV = system === 3 ? 400 : 230
  const factor = system === 3 ? Math.sqrt(3) : 2
  const dropV = (factor * lengthM * currentA * COPPER_RESISTIVITY) / crossSectionMm2
  const dropPercent = (dropV / nominalV) * 100
  return { dropV, dropPercent, ok: dropPercent <= CABLE_DROP_LIMIT_PERCENT }
}

/** Formats a drop the way the schedule prints it: «0,8 %» with a comma, empty for nothing planned. */
export const formatDropPercent = (dropPercent: number): string =>
  dropPercent > 0 ? `${dropPercent.toFixed(1).replace('.', ',')} %` : '—'
