export type Phase = 1 | 3

export type Category =
  | 'MCB'
  | 'RCCB'
  | 'RCBO'
  | 'SPD'
  | 'relay'
  | 'terminals'
  | 'busbar'
  | 'meter'
  | 'PSU'

export type BusType = 'L' | 'N' | 'PE'

export type RailSlotCount = 12 | 18
export type EnclosureMountingType = 'embedded' | 'surface'
/**
 * How far a catalogue position has been checked.
 *
 * `unverified` is the state most of the built-in catalogue is in: the position names a real
 * product, but its parameters were never compared against a manufacturer datasheet, and no
 * `sourceUrl` is claimed for it. It used to have no status at all and the UI said «Статус не
 * указан», which reads like unfinished data rather than a deliberate statement — the field is
 * now required on `DeviceDefinition`, so a new producer cannot forget it again.
 */
export type VerificationStatus = 'verified' | 'unverified' | 'template' | 'legacy'

export interface RailDefinition {
  id: 'rail-12' | 'rail-18'
  name: string
  slots: RailSlotCount
  modulePitchMm: 18
}

export interface CabinetDefinition {
  id: string
  name: string
  brand: string
  sku?: string
  modules: number
  rows: number
  railId: RailDefinition['id']
  mounting: EnclosureMountingType
  width: number
  height: number
  depth: number
  /** Ingress protection rating from the manufacturer, e.g. 'IP40'. */
  ip?: string
  /** Case material, e.g. 'пластик', 'сталь'. */
  material?: string
  sourceUrl?: string
  verificationStatus: VerificationStatus
}

export interface Circuit {
  id: string
  name: string
  loadName: string
  current: number
  power: number
  phase: 1 | 2 | 3
  protectionDeviceId: string
  color: string
  wireCrossSection: number
  note: string
}

export interface Connection {
  id: string
  circuitId: string
  fromBus: BusType
  toDeviceId: string
  color: string
  thickness: number
  label: string
  kind?: 'circuit' | 'busbar'
  fromDeviceId?: string
}

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
  color: string
  imported?: boolean
  modelAssetId?: string
  modelPreviewUrl?: string
  modelPreviewRotationY?: number
  series?: string
  tripCurve?: 'B' | 'C' | 'D'
  residualCurrentMa?: number
  terminalCount?: number
  sourceUrl?: string
  /**
   * Required: a position without a status is indistinguishable from a position nobody looked at.
   * Producers outside the catalogue set it to `unverified` (see `VerificationStatus`).
   */
  verificationStatus: VerificationStatus
}

export interface PlacedDevice {
  instanceId: string
  productId: string
  row: number
  slot: number
  address: string
  quantity: number
  phase: 1 | 2 | 3
  note: string
  marking?: string
  mount?: 'din' | 'busbar'
}

export interface ProjectSettings {
  inputCurrent: number
  phase: Phase
  enclosureWidth: number
  enclosureHeight: number
  enclosureDepth: number
  rows: number
  reserveModules: number
  cabinetId?: string
  railId?: RailDefinition['id']
}

export interface PanelProject {
  schemaVersion: number
  id: string
  name: string
  preset: string
  createdAt: string
  updatedAt: string
  settings: ProjectSettings
  devices: PlacedDevice[]
  circuits: Circuit[]
  connections: Connection[]
}

export type IssueLevel = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  /** Stable id kept for UI keys and links. */
  id: string
  level: IssueLevel
  title: string
  message: string
  deviceId?: string
  /** Machine-readable rule and revision, in addition to the legacy display fields. */
  ruleCode: string
  version: number
  ruleVersion: number
  context: Record<string, unknown>
}

export interface BomLine {
  productId: string
  name: string
  brand: string
  sku: string
  category: Category
  /** Purchase quantity; it is deliberately not a physical footprint. */
  quantity: number
  /** Kept numeric for existing UI callers. Use priceKnown/priceStatus for semantics. */
  unitPrice: number
  total: number
  weight: number
  priceKnown: boolean
  priceStatus: 'known' | 'unknown'
}

export interface ModelMetadata {
  id: string
  name: string
  brand: string
  sku: string
  category: Category
  moduleWidth: number
  rows: number
  height: number
  depth: number
  poles: number
  ratedCurrent: number
  voltage: 230 | 400
  bus: BusType
  price: number
  weight: number
  fileName: string
  fileType: 'glb' | 'gltf'
  createdAt: string
}

export interface PreparedModel {
  metadata: Omit<ModelMetadata, 'id' | 'createdAt'>
  data: ArrayBuffer
  mimeType: string
  fileName: string
}
