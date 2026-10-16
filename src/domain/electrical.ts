import type { Circuit } from './types'

/**
 * Preliminary nominal voltages the load maths runs on: 230 V phase-to-neutral for a
 * single-phase line, 400 V phase-to-phase for a three-phase one. Real networks differ;
 * every number derived here is explicitly preliminary until C2 makes voltages project input.
 */
export const SINGLE_PHASE_VOLTAGE = 230
export const THREE_PHASE_VOLTAGE = 400

/**
 * The current a line actually draws, one number for every consumer of the load maths
 * (phase balance, the AI context, the voltage-drop check). A stated current wins — it is
 * either measured or deliberately assigned — and only a line with power but no current
 * gets its current derived: 4600 W reads as 20 A at 230 V on any single phase, and as the
 * line current of a 400 V three-phase line. Power factor is assumed 1; without load data
 * there is nothing to be honest about beyond the assumption itself.
 */
export const circuitCurrentA = (circuit: Pick<Circuit, 'current' | 'power' | 'phaseCount'>): number => {
  const stated = Math.max(0, circuit.current)
  if (stated > 0) return stated
  const power = Math.max(0, circuit.power)
  if (power <= 0) return 0
  return circuit.phaseCount === 3
    ? power / (Math.sqrt(3) * THREE_PHASE_VOLTAGE)
    : power / SINGLE_PHASE_VOLTAGE
}
