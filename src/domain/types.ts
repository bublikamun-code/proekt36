export type Phase = 1 | 3

export const DEVICE_CATEGORIES = [
  'MCB', 'RCCB', 'RCBO', 'SPD', 'relay', 'terminals', 'busbar', 'meter', 'PSU',
] as const

export type Category = typeof DEVICE_CATEGORIES[number]

export type BusType = 'L' | 'N' | 'PE'

export type RailSlotCount = 12 | 18
export type EnclosureMountingType = 'embedded' | 'surface'
export type VerificationStatus = 'verified' | 'template' | 'legacy'

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
  imported?: boolean
  /** Link to a ModelAsset; visual only, never part of the electrical model. */
  modelId?: string
  series?: string
  tripCurve?: 'B' | 'C' | 'D'
  residualCurrentMa?: number
  terminalCount?: number
  sourceUrl?: string
  verificationStatus?: VerificationStatus
}

export type ModelFormat = 'glb' | 'gltf' | 'gltf-zip'

/** Normalization applied at import so every asset renders in metres, front to the viewer. */
export interface ModelTransform {
  scale: number
  rotationY: number
}

export interface ModelAsset {
  id: string
  name: string
  /** 'embedded' ships with the app from /public; 'local' lives in IndexedDB. */
  source: 'embedded' | 'local'
  url?: string
  format: ModelFormat
  transform: ModelTransform
  /** Raster preview generated on import; boards and catalog lists never spawn WebGL for it. */
  thumbnailDataUrl?: string
  fileName?: string
  createdAt: string
  /** The IndexedDB binary is gone; re-importing the same file restores it in place. */
  missing?: boolean
}

export type StoredModelAsset = ModelAsset & { source: 'local' }

/** Everything the model library persists in one localStorage record. */
export interface StoredModelLibrary {
  assets: StoredModelAsset[]
  /** Product stubs created from imports; referenced by PlacedDevice.productId. */
  products: DeviceDefinition[]
  /** productId → modelId overrides that attach a model to a built-in product. */
  bindings: Record<string, string>
}

/** Form defaults offered when an imported file becomes a catalogue product stub. */
export interface ImportedProductDraft {
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
  fileName: string
  format: ModelFormat
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

export interface PreparedModel {
  draft: ImportedProductDraft
  data: ArrayBuffer
  mimeType: string
  fileName: string
}
