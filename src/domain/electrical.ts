import { loadBookRow } from './loadBook'
import type { Circuit } from './types'

/**
 * Preliminary nominal voltages the load maths runs on: 230 V phase-to-neutral for a
 * single-phase line, 400 V phase-to-phase for a three-phase one. Real networks differ;
 * every number derived here is explicitly preliminary until C2 makes voltages project input.
 */
export const SINGLE_PHASE_VOLTAGE = 230
export const THREE_PHASE_VOLTAGE = 400

/** Circuit fields the load maths reads; the coefficient fields are optional overrides. */
export type CircuitLoadInput = Pick<Circuit, 'current' | 'power' | 'phaseCount'> &
  Partial<Pick<Circuit, 'kind' | 'powerFactor' | 'demandFactor'>>

/** Where the number came from: the user stated it, it was derived, or it cannot be derived. */
export type LoadBasis = 'stated' | 'derived' | 'insufficient'

export interface CircuitLoadMath {
  basis: LoadBasis
  /** Расчётный ток линии, А. */
  amps: number
  /** Коэффициенты, с которыми считается (или считался бы) ток — для показа рядом с числом. */
  powerFactor: number
  demandFactor: number
  /** Откуда коэффициенты: ручной ввод в карточке цепи или строка справочника. */
  factorSource: 'manual' | 'book'
  kindLabel: string
  /** 'stated' — задан пользователем; 'preliminary' — типовые коэффициенты, не «проверено». */
  status: 'stated' | 'preliminary' | 'insufficient'
  explanation: string
}

/**
 * The load maths of a line, one function for every consumer of the number (phase balance,
 * the AI context, the voltage-drop check, the sizing hints, the single-line diagram).
 *
 * A stated current wins — it is either measured or deliberately assigned. Only a line with
 * power but no current gets its current derived: I = P·kс/(U·cos φ), where the coefficients
 * come from the load book for the line kind and any manual override wins per coefficient.
 * A line with neither current nor power has nothing to be honest about — that is
 * «insufficient data», not zero.
 */
export const circuitLoadMath = (circuit: CircuitLoadInput): CircuitLoadMath => {
  const row = loadBookRow(circuit.kind)
  const manualPowerFactor = circuit.powerFactor !== undefined && circuit.powerFactor > 0
  const manualDemandFactor = circuit.demandFactor !== undefined && circuit.demandFactor > 0
  const powerFactor = manualPowerFactor ? circuit.powerFactor! : row.powerFactor
  const demandFactor = manualDemandFactor ? circuit.demandFactor! : row.demandFactor
  const factorSource: CircuitLoadMath['factorSource'] = manualPowerFactor || manualDemandFactor ? 'manual' : 'book'
  const stated = Math.max(0, circuit.current)
  if (stated > 0) {
    return { basis: 'stated', amps: stated, powerFactor, demandFactor, factorSource, kindLabel: row.label, status: 'stated', explanation: 'ток задан вручную' }
  }
  const power = Math.max(0, circuit.power)
  if (power <= 0) {
    return { basis: 'insufficient', amps: 0, powerFactor, demandFactor, factorSource, kindLabel: row.label, status: 'insufficient', explanation: 'нет ни тока, ни мощности' }
  }
  const amps = circuit.phaseCount === 3
    ? (power * demandFactor) / (Math.sqrt(3) * THREE_PHASE_VOLTAGE * powerFactor)
    : (power * demandFactor) / (SINGLE_PHASE_VOLTAGE * powerFactor)
  const kilowatts = (power / 1000).toFixed(1).replace('.', ',')
  return {
    basis: 'derived',
    amps,
    powerFactor,
    demandFactor,
    factorSource,
    kindLabel: row.label,
    status: 'preliminary',
    explanation: `${kilowatts} кВт · kс ${formatFactor(demandFactor)} · cos φ ${formatFactor(powerFactor)} · ${circuit.phaseCount === 3 ? '400 В' : '230 В'} · ${factorSource === 'manual' ? 'ручной ввод' : 'справочник'}`,
  }
}

const formatFactor = (value: number): string => value.toFixed(2).replace('.', ',')

/** The current a line actually draws, as a plain number for the checks that only need it. */
export const circuitCurrentA = (circuit: CircuitLoadInput): number => circuitLoadMath(circuit).amps
