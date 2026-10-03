import { capacityForSection, sectionForAmps } from './conductorSpec'
import type { Circuit, DeviceDefinition, PanelProject } from './types'

/**
 * The electrical part of the preliminary check, kept apart from `validation.ts` on purpose: the
 * rules there are about how an issue is worded and reported, while everything here is a number
 * that can be computed, printed and tested on its own.
 *
 * Every figure below is preliminary. The application does not claim to select a protective device
 * or a conductor, only to point at the combinations that cannot be right.
 */

export const SINGLE_PHASE_VOLTAGE_V = 230
export const THREE_PHASE_VOLTAGE_V = 400

/** Above this, a three-phase panel is reported as unbalanced. */
export const PHASE_IMBALANCE_LIMIT_PERCENT = 30

/**
 * How much a load implied by the declared power may exceed the declared current before the two
 * are called inconsistent. A circuit is normally designed for more than it carries — a 16 A
 * socket group at 1500 W is the ordinary case, not a mistake — so only the other direction counts:
 * a load that needs more current than the circuit declares means one of the two numbers is wrong,
 * and the phase totals and the conductor check both use the current.
 */
export const POWER_CURRENT_TOLERANCE = 0.05

export interface PhaseBalance {
  /** Load per phase, always three entries even for a single-phase panel. */
  totals: number[]
  /**
   * Percentage difference between the busiest and the quietest phase. A phase with no declared
   * load counts as zero and is not excluded: a panel carrying everything on L1 while L3 is idle
   * is exactly what a user of a three-phase panel needs to be told about.
   */
  spread: number
}

/**
 * Load per phase. Only real circuits count: with none declared the fallback sums device ratings,
 * and a sum of protective ratings is not a load — the phase totals are then shown but deliberately
 * never compared with the incoming rating.
 */
export const phaseBalance = (project: PanelProject, definitions: Map<string, DeviceDefinition>): PhaseBalance => {
  const totals = [0, 0, 0]
  if (project.circuits?.length) {
    for (const circuit of project.circuits) totals[(circuit.phase - 1) % 3] += Math.max(0, circuit.current)
  } else {
    for (const item of project.devices) totals[(item.phase - 1) % 3] += (definitions.get(item.productId)?.ratedCurrent ?? 0) * item.quantity
  }
  const activeTotals = project.settings.phase === 1 ? totals.slice(0, 1) : totals
  // A panel with no load at all is balanced, not maximally skewed. Forcing a
  // non-zero denominator here reported «Разброс фаз 100 %» on an empty board.
  const max = Math.max(...activeTotals)
  const min = Math.min(...activeTotals)
  return { totals, spread: max <= 0 ? 0 : Math.round(((max - min) / max) * 100) }
}

/** A three-phase panel is only balanced when it carries more than one phase. */
export const phaseImbalance = (project: PanelProject, definitions: Map<string, DeviceDefinition>) => {
  if (project.settings.phase !== 3 || !project.circuits?.length) return null
  const { totals, spread } = phaseBalance(project, definitions)
  const loaded = totals.filter((value) => value > 0)
  if (loaded.length < 2) return null
  return spread > PHASE_IMBALANCE_LIMIT_PERCENT ? { spread, totals } : null
}

/** Apparent power that matches a declared current, in W. */
export const expectedPowerW = (current: number, phase: Circuit['phase']) =>
  phase === 3 ? Math.sqrt(3) * THREE_PHASE_VOLTAGE_V * current : SINGLE_PHASE_VOLTAGE_V * current

/** The current that would match a declared power, in A. */
export const currentForPowerA = (power: number, phase: Circuit['phase']) =>
  power > 0 ? power / (phase === 3 ? Math.sqrt(3) * THREE_PHASE_VOLTAGE_V : SINGLE_PHASE_VOLTAGE_V) : 0

export interface CircuitLoadCheck {
  /** Current the declared power draws, in A. */
  implied: number
  /** The load needs more current than the circuit declares. */
  exceedsCurrent: boolean
  /** The load needs more current than the protecting device is rated for. */
  exceedsProtection: boolean
}

/**
 * What the declared power implies, compared with the two numbers it has to agree with.
 *
 * A circuit is expected to be designed for more than it carries, so the power implying less
 * current than the circuit declares is normal and silent. The two reported directions are the ones
 * that cannot be right: a load heavier than the circuit it belongs to, and a load heavier than the
 * device protecting it. Neither value is rewritten here — the check reports what the numbers imply
 * and leaves the choice to whoever owns the file.
 */
export const circuitLoadCheck = (circuit: Circuit, protectionRating = 0): CircuitLoadCheck | null => {
  const implied = currentForPowerA(circuit.power, circuit.phase)
  if (implied <= 0) return null
  return {
    implied,
    exceedsCurrent: circuit.current > 0 && implied > circuit.current * (1 + POWER_CURRENT_TOLERANCE),
    // The same tolerance as the current, so a circuit sitting exactly on its rating does not trip
    // one rule and quietly pass the other.
    exceedsProtection: protectionRating > 0 && implied > protectionRating * (1 + POWER_CURRENT_TOLERANCE),
  }
}

export interface ProtectionLoad {
  instanceId: string
  ratedCurrent: number
  current: number
  circuits: Circuit[]
}

/**
 * Current carried by each protective device, keyed by `instanceId`. One device feeding several
 * circuits has to be rated for their sum, and the editor lets exactly that happen: a circuit
 * defaults to the first protection device on the board.
 */
export const protectionLoads = (project: PanelProject, definitions: Map<string, DeviceDefinition>): Map<string, ProtectionLoad> => {
  const loads = new Map<string, ProtectionLoad>()
  for (const circuit of project.circuits ?? []) {
    if (!circuit.protectionDeviceId) continue
    const placed = project.devices.find((item) => item.instanceId === circuit.protectionDeviceId)
    const product = placed ? definitions.get(placed.productId) : undefined
    const ratedCurrent = product?.ratedCurrent ?? 0
    const existing = loads.get(circuit.protectionDeviceId)
    // Both branches have to record the circuit: the sum alone would pass a check that reads the
    // count, and the message would then name only the first circuit behind an overloaded device.
    if (existing) {
      existing.current += Math.max(0, circuit.current)
      existing.circuits.push(circuit)
    } else {
      loads.set(circuit.protectionDeviceId, { instanceId: circuit.protectionDeviceId, ratedCurrent, current: Math.max(0, circuit.current), circuits: [circuit] })
    }
  }
  return loads
}

export interface ConductorCheck {
  /** Smallest catalogueued section that would carry the protection rating. */
  required: number
  actual: number
  /** Capacity credited to the section the circuit actually declares. */
  capacity: number
}

/**
 * Protective-conductor sizing, stated as the rule it approximates: the conductor is protected
 * against overload by the same device as the circuit, so its current-carrying capacity has to
 * cover the device rating (In ≤ Iz), not just the load. A device rating above the table is
 * reported as `null` — this data cannot judge it, and saying nothing beats guessing.
 */
export const conductorCheck = (crossSection: number, protectionRating: number): ConductorCheck | null => {
  if (!(protectionRating > 0)) return null
  const required = sectionForAmps(protectionRating)
  if (required === undefined) return null
  const capacity = capacityForSection(crossSection)
  if (capacity >= protectionRating) return null
  return { required, actual: crossSection, capacity: Math.floor(capacity) }
}
