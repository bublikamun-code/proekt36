/**
 * Модель данных каталога. Живёт в самом каталоге, а не в домене: каталог — источник
 * позиций, и его форма не должна зависеть от того, как домен её потребляет. Домен
 * реэкспортирует эти типы (`domain/types.ts`) — источник правды один.
 *
 * Объединение линий 17.10: поля сентябрьской линии (verificationStatus, modelId,
 * паспортные метрики) плюс визуальные поля октябрьской (color, modelAssetId,
 * modelPreview*). Октябрьское «verificationStatus обязателен» станет требованием
 * схемы после того, как сгенерированные ENMAS-позиции получат статус; до этого
 * отсутствие статуса означает «никто не смотрел», и UI показывает это прямо.
 */
export const DEVICE_CATEGORIES = [
  'MCB', 'RCCB', 'RCBO', 'SPD', 'relay', 'terminals', 'busbar', 'meter', 'PSU',
] as const

export type Category = typeof DEVICE_CATEGORIES[number]

export type BusType = 'L' | 'N' | 'PE'

/** Как далеко проверена позиция каталога. `legacy` — узнаём, но не держим. */
export type VerificationStatus = 'verified' | 'unverified' | 'template' | 'legacy'

export interface DeviceDefinition {
  id: string
  name: string
  brand: string
  sku: string
  category: Category
  moduleWidth: number
  poles: number
  ratedCurrent: number
  voltage: 230 | 400
  bus: BusType
  price: number
  weight: number
  height: number
  depth: number
  imported?: boolean
  /** Ссылка на ModelAsset; только визуал, никогда часть электрической модели. */
  modelId?: string
  /** Визуальные поля октябрьской линии; для CHINT-позиций не заданы до объединения слоя лиц. */
  color?: string
  modelAssetId?: string
  modelPreviewUrl?: string
  modelPreviewRotationY?: number
  series?: string
  tripCurve?: 'B' | 'C' | 'D'
  residualCurrentMa?: number
  terminalCount?: number
  sourceUrl?: string
  verificationStatus?: VerificationStatus
}
