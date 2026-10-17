import { CONDUCTOR_SECTIONS_MM2, sectionForAmps } from './conductorSpec'
import { loadBookRow } from './loadBook'
import { CABLE_DROP_LIMIT_PERCENT, voltageDrop } from './voltageDrop'
import type { CircuitKind } from './types'

/**
 * Подбор защиты и кабеля по расчётному току линии. Оба подбора — подсказка
 * предварительного уровня: ряд номиналов и таблица Iдд общие, но решение остаётся
 * за монтажником, и подсказка никогда не называется «проверенной».
 */

/** Стандартный ряд номиналов модульных автоматов, А. */
export const BREAKER_RATINGS_A = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125] as const

export interface ProtectionSuggestion {
  status: 'preliminary' | 'insufficient'
  /** Ближайший номинал ряда не ниже расчётного тока; нет — ряд исчерпан. */
  ratingA?: number
  curve: 'B' | 'C'
  explanation: string
}

/**
 * Номинал и характеристика защиты по расчётному току. Розетки получают C — пусковые
 * токи приборов; свет, управление и DC — B: быстрее срабатывает, помех пуска нет.
 * Номинал не опускается ниже практического минимума вида линии: холодильник в 1,5 А
 * не делает розеточную линию линией на 6 А.
 */
export const suggestProtection = (amps: number, kind: CircuitKind | undefined): ProtectionSuggestion => {
  if (!(amps > 0)) {
    return { status: 'insufficient', curve: 'C', explanation: 'Нет расчётного тока: задайте мощность нагрузки или ток линии.' }
  }
  const row = loadBookRow(kind)
  const curve: 'B' | 'C' = kind === 'power' ? 'C' : 'B'
  const found = BREAKER_RATINGS_A.find((rating) => rating >= amps)
  if (found === undefined) {
    return { status: 'insufficient', curve, explanation: `Расчётный ток ${formatAmps(amps)} А выше ряда номиналов (до 125 А) — ввод и защита считаются специалистом.` }
  }
  const ratingA = Math.max(found, row.minRatingA)
  const minNote = row.minRatingA > found ? ` (не ниже практического минимума ${row.minRatingA} А)` : ''
  return { status: 'preliminary', ratingA, curve, explanation: `Iр ${formatAmps(amps)} А → номинал ${ratingA} А, характеристика ${curve}${minNote}` }
}

export interface CableSuggestion {
  status: 'preliminary' | 'insufficient'
  sectionMm2?: number
  /** Проверено ли падение напряжения: без длины трассы проверять нечего. */
  dropChecked: boolean
  dropPercent?: number
  explanation: string
}

export interface CableSuggestionInput {
  /** Расчётный ток линии, А. */
  amps: number
  /** Номинал защитного аппарата линии, если он выбран: кабель держит и его. */
  ratingA?: number
  /** Длина трассы, м; 0 — не измерена. */
  lengthM: number
  /** 1 для 230 В, 3 для 400 В. */
  system: 1 | 3
  kind?: CircuitKind
}

/**
 * Сечение меди линии: минимум из трёх требований — длительно держать расчётный ток,
 * держать номинал защиты (защита не должна жечь кабель) и не быть меньше монтажного
 * минимума вида линии. Заданная длина добавляет четвёртое: падение напряжения в
 * пределах 4 %, ради которого сечение шагает вверх по ряду. Без длины падение не
 * проверяется вовсе — «недостаточно данных», а не «всё в порядке».
 */
export const suggestCable = ({ amps, ratingA, lengthM, system, kind }: CableSuggestionInput): CableSuggestion => {
  const row = loadBookRow(kind)
  const target = Math.max(amps, ratingA ?? 0)
  if (!(target > 0)) {
    return { status: 'insufficient', dropChecked: false, explanation: 'Нет расчётного тока: задайте мощность нагрузки или ток линии.' }
  }
  const base = sectionForAmps(target)
  if (base === undefined) {
    return { status: 'insufficient', dropChecked: false, explanation: `Ток ${formatAmps(target)} А выше таблицы длительных токов меди — кабель подбирает специалист.` }
  }
  let section = Math.max(base, row.minSectionMm2)
  const minNote = row.minSectionMm2 > base ? `, не меньше монтажного минимума ${formatSection(row.minSectionMm2)} мм²` : ''
  if (lengthM > 0) {
    for (const candidate of CONDUCTOR_SECTIONS_MM2) {
      if (candidate < section) continue
      const drop = voltageDrop({ lengthM, currentA: amps, crossSectionMm2: candidate, system })
      if (drop.ok) {
        const grown = candidate > base ? ', увеличено по падению напряжения' : ''
        return { status: 'preliminary', sectionMm2: candidate, dropChecked: true, dropPercent: drop.dropPercent, explanation: `${formatSection(candidate)} мм² по длительному току${minNote}${grown}: падение ${formatAmps(drop.dropPercent)} % из ${CABLE_DROP_LIMIT_PERCENT} %` }
      }
    }
    return { status: 'insufficient', dropChecked: true, explanation: `Падение напряжения выше ${CABLE_DROP_LIMIT_PERCENT} % даже на максимальном сечении таблицы — сокращайте трассу.` }
  }
  return { status: 'preliminary', sectionMm2: section, dropChecked: false, explanation: `${formatSection(section)} мм² по длительному току${minNote}; длина трассы не задана — падение не проверено` }
}

const formatAmps = (value: number): string => (value > Math.floor(value) ? value.toFixed(1) : String(Math.round(value))).replace('.', ',')
const formatSection = (value: number): string => String(value).replace('.', ',')
