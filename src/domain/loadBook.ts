import type { CircuitKind } from './types'

/**
 * Справочник типовых нагрузок: коэффициенты, с которых линия считается, и монтажный
 * минимум сечения меди.
 *
 * Статус каждой строки — «предварительно»: коэффициенты типовые, источник пока не
 * зафиксирован со специалистом (эталонные ведомости, карточка C4 плана). По правилу
 * продукта (ELECTRICIAN_TOOL.md, раздел 3) число без источника не называется
 * «проверенным» — расчёт по справочнику честно помечается предварительным, а ручной
 * ввод cos φ/kс в карточке цепи перекрывает строку справочника.
 */
export interface LoadBookRow {
  kind: CircuitKind
  label: string
  /** Типовой коэффициент мощности нагрузки линии. */
  powerFactor: number
  /** Типовой коэффициент спроса линии: доля нагрузки, работающая одновременно. */
  demandFactor: number
  /** Минимальное сечение меди по практике монтажа, мм², независимо от расчёта. */
  minSectionMm2: number
  /** Практический минимум номинала защиты вида линии, А: розетка не живёт на 6 А. */
  minRatingA: number
  status: 'preliminary'
  note: string
}

export const LOAD_BOOK: Record<CircuitKind, LoadBookRow> = {
  power: {
    kind: 'power',
    label: 'Розетки',
    powerFactor: 0.95,
    demandFactor: 0.8,
    minSectionMm2: 2.5,
    minRatingA: 16,
    status: 'preliminary',
    note: 'Розеточные группы и стационарные приборы 230 В: не всё включено одновременно (kс), у части приборов двигатель или импульсный блок питания (cos φ).',
  },
  light: {
    kind: 'light',
    label: 'Освещение',
    powerFactor: 0.92,
    demandFactor: 1,
    minSectionMm2: 1.5,
    minRatingA: 6,
    status: 'preliminary',
    note: 'Светильники с драйверами и дросселями: cos φ ниже единицы; включаются все, kс = 1.',
  },
  dc: {
    kind: 'dc',
    label: 'DC',
    powerFactor: 1,
    demandFactor: 0.8,
    minSectionMm2: 1,
    minRatingA: 6,
    status: 'preliminary',
    note: 'Низковольтная линия постоянного тока через блок питания: cos φ не применим, спрос — не всё одновременно.',
  },
  control: {
    kind: 'control',
    label: 'Управление',
    powerFactor: 0.9,
    demandFactor: 0.7,
    minSectionMm2: 1,
    minRatingA: 6,
    status: 'preliminary',
    note: 'Реле, контакторы, автоматика: катушки и блоки питания, работают короткими включениями.',
  },
}

/** Метки видов линии для селектов и подписей — один источник для инспектора и планировщика. */
export const CIRCUIT_KIND_LABELS: Record<CircuitKind, string> = {
  power: 'Розетки',
  light: 'Освещение',
  dc: 'DC',
  control: 'Управление',
}

/**
 * Строка справочника для вида линии. Вид, которого нет в записи (старый файл до
 * нормализации), считается розеточным — это дефолт нормализации цепи.
 */
export const loadBookRow = (kind: CircuitKind | undefined): LoadBookRow =>
  kind ? LOAD_BOOK[kind] : LOAD_BOOK.power
