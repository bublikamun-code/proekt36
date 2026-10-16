import type { TerminalRef } from './terminals'

export type Phase = 1 | 3

/**
 * Модель каталога (Category, BusType, VerificationStatus, DeviceDefinition,
 * DEVICE_CATEGORIES) определена в самом каталоге и реэкспортируется здесь:
 * источник правды один, домен потребляет.
 */
import type { Category, BusType, VerificationStatus, DeviceDefinition } from '../data/catalog/types'
import { DEVICE_CATEGORIES } from '../data/catalog/types'
export type { Category, BusType, VerificationStatus, DeviceDefinition }
export { DEVICE_CATEGORIES }

export type RailSlotCount = 12 | 18
export type EnclosureMountingType = 'embedded' | 'surface'

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

/** What a line feeds, so the planner and the cable schedule can tell a socket run from lighting. */
export type CircuitKind = 'power' | 'light' | 'dc' | 'control'

export const CIRCUIT_KINDS: readonly CircuitKind[] = ['power', 'light', 'dc', 'control'] as const

export interface Circuit {
  id: string
  name: string
  loadName: string
  current: number
  power: number
  /** Assigned phase L1/L2/L3; meaningful only while `phaseCount` is 1. */
  phase: 1 | 2 | 3
  /** How many phases the load itself needs; a three-phase line loads all three baskets. */
  phaseCount: 1 | 3
  protectionDeviceId: string
  color: string
  wireCrossSection: number
  note: string
  /** Room grouping for the planner; empty means the line sits outside any room. */
  roomId?: string
  kind?: CircuitKind
  /** Outgoing cable length in metres; 0 or absent means not planned yet. */
  cableLength?: number
  /**
   * Set by the v5 migration on pre-v5 records with `phase: 3`: in the old formats that number
   * meant either «single-phase line on L3» or «a three-phase line», and the data cannot tell.
   * Cleared only by an explicit choice in the clarification dialog or the inspector.
   */
  phaseAmbiguous?: boolean
}

/** A planning group for lines — a room on a floor, the way a estimate worksheet expects. */
export interface Room {
  id: string
  name: string
  floor: number
}

export interface Connection {
  id: string
  circuitId: string
  fromBus: BusType
  toDeviceId: string
  color: string
  thickness: number
  label: string
  kind?: 'circuit' | 'busbar' | 'jumper'
  fromDeviceId?: string
  /** Terminal the conductor leaves, for a device-to-device jumper. */
  fromTerminal?: TerminalRef
  /** Terminal the conductor enters; required for a jumper, absent for a bus-fed line. */
  toTerminal?: TerminalRef
  /** Phase the conductor carries, used for the wire colour when no explicit colour is set. */
  phase?: 1 | 2 | 3
  /** Board bus the conductor is fed from, instead of the abstract left-hand column. */
  busId?: string
}

/** A visible bus running along the top or the bottom of the mounting plate. */
export interface BusAssembly {
  id: string
  kind: BusType
  placement: 'top' | 'bottom'
  label?: string
}

/** A comb busbar bridging the top terminals of a run of devices in one row. */
export interface RowComb {
  id: string
  row: number
  /** 1, 2, 3 or 4 conductors: a single-phase or a three-phase fork. */
  poles: 1 | 2 | 3 | 4
  /** Inclusive slot range the comb covers. */
  fromSlot: number
  toSlot: number
  label?: string
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
  busAssemblies?: BusAssembly[]
  combs?: RowComb[]
  rooms?: Room[]
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
  /** Unknown for a device whose product left the catalogue; the line still shows. */
  category?: Category
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
