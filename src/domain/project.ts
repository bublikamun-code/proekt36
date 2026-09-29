import { cabinetById, railById } from '../data/enclosures'
import type { BusAssembly, Category, Circuit, Connection, DeviceDefinition, PanelProject, PlacedDevice, ProjectSettings, RowComb } from './types'
import type { TerminalRef } from './terminals'
import { PROJECT_SCHEMA_VERSION } from './projectSchema'

export { PROJECT_SCHEMA_VERSION } from './projectSchema'
export const uid = () => crypto.randomUUID()
export const DEFAULT_CABINET_ID = 'enmas-nx8-24-embedded'
export const DEFAULT_RAIL_ID = 'rail-12' as const

const DEFAULT_SETTINGS: ProjectSettings = {
  inputCurrent: 63,
  phase: 1,
  enclosureWidth: 310,
  enclosureHeight: 350,
  enclosureDepth: 105,
  rows: 2,
  reserveModules: 8,
  cabinetId: DEFAULT_CABINET_ID,
  railId: DEFAULT_RAIL_ID,
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const asText = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback
const asNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}
const asInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => Math.round(asNumber(value, fallback, minimum, maximum))
const asPhase = (value: unknown): 1 | 2 | 3 => value === 2 || value === 3 ? value : 1

/** Normalize a placed device, including v1 devices and malformed stored values. */
export const normalizeDevice = (value: unknown): PlacedDevice | null => {
  const raw = asRecord(value)
  const productId = asText(raw.productId)
  if (!productId) return null
  const address = asText(raw.address)
  return {
    instanceId: asText(raw.instanceId, uid()),
    productId,
    row: asInteger(raw.row, 0, 0, 29),
    slot: asInteger(raw.slot, 0, 0, 999),
    address,
    quantity: asInteger(raw.quantity, 1, 1, 99),
    phase: asPhase(raw.phase),
    note: asText(raw.note),
    marking: asText(raw.marking, address),
    mount: raw.mount === 'busbar' ? 'busbar' : 'din',
  }
}

/** Normalize a circuit without dropping any v1/v2 field. */
export const normalizeCircuit = (value: unknown): Circuit => {
  const raw = asRecord(value)
  return {
    id: asText(raw.id, uid()),
    name: asText(raw.name, 'Без названия'),
    loadName: asText(raw.loadName, asText(raw.name, 'Без названия')),
    current: asNumber(raw.current, 0, 0, 10000),
    power: asNumber(raw.power, 0, 0, 10000000),
    phase: asPhase(raw.phase),
    protectionDeviceId: asText(raw.protectionDeviceId),
    color: asText(raw.color, '#c65c3b'),
    wireCrossSection: asNumber(raw.wireCrossSection, 1.5, 0, 1000),
    note: asText(raw.note),
  }
}

/** Normalize a connection, including old records that did not have kind. */
export const normalizeConnection = (value: unknown): Connection => {
  const raw = asRecord(value)
  const kind = raw.kind === 'busbar' || raw.kind === 'jumper' || raw.fromDeviceId ? 'busbar' : 'circuit'
  return {
    id: asText(raw.id, uid()),
    circuitId: asText(raw.circuitId),
    fromBus: raw.fromBus === 'N' || raw.fromBus === 'PE' ? raw.fromBus : 'L',
    toDeviceId: asText(raw.toDeviceId),
    color: asText(raw.color, '#c65c3b'),
    thickness: asNumber(raw.thickness, 2, 0.5, 8),
    label: asText(raw.label),
    kind: raw.kind === 'jumper' && raw.fromTerminal && raw.toTerminal ? 'jumper' : kind,
    fromDeviceId: asText(raw.fromDeviceId) || undefined,
    fromTerminal: normalizeTerminalRef(raw.fromTerminal),
    toTerminal: normalizeTerminalRef(raw.toTerminal),
    phase: asPhase(raw.phase),
    busId: asText(raw.busId) || undefined,
  }
}

/** A terminal reference is only meaningful with a device, a pole and a side. */
const normalizeTerminalRef = (value: unknown): TerminalRef | undefined => {
  const raw = asRecord(value)
  const deviceId = asText(raw.deviceId)
  if (!deviceId) return undefined
  const pole = asInteger(raw.pole, 1, 0, 12)
  const side = raw.side === 'bottom' ? 'bottom' : 'top'
  return { deviceId, pole, side }
}

/** Normalize a board bus, dropping records without a known bus kind. */
export const normalizeBusAssembly = (value: unknown): BusAssembly | null => {
  const raw = asRecord(value)
  const kind = raw.kind
  if (kind !== 'L' && kind !== 'N' && kind !== 'PE') return null
  return { id: asText(raw.id, uid()), kind, placement: raw.placement === 'top' ? 'top' : 'bottom', label: asText(raw.label) }
}

/** Normalize a comb busbar, keeping the slot range ordered and inside the rail. */
export const normalizeRowComb = (value: unknown): RowComb | null => {
  const raw = asRecord(value)
  const row = asInteger(raw.row, 0, 0, 29)
  const fromSlot = asInteger(raw.fromSlot, 0, 0, 999)
  const toSlot = asInteger(raw.toSlot, fromSlot, 0, 999)
  const poles = asInteger(raw.poles, 1, 1, 4)
  return {
    id: asText(raw.id, uid()),
    row,
    poles: (poles === 2 || poles === 3 || poles === 4 ? poles : 1) as 1 | 2 | 3 | 4,
    fromSlot: Math.min(fromSlot, toSlot),
    toSlot: Math.max(fromSlot, toSlot),
    label: asText(raw.label),
  }
}

/** The buses a v2 project gains: N and PE along the bottom plate, where they are drawn. */
const migrateBusAssemblies = (value: unknown, connections: Connection[]): BusAssembly[] => {
  const existing = Array.isArray(value) ? value.map(normalizeBusAssembly).filter((item): item is BusAssembly => Boolean(item)) : []
  if (existing.length) return existing
  const buses = new Set(connections.map((connection) => connection.fromBus))
  const defaults: BusAssembly[] = [
    { id: 'bus-n-bottom', kind: 'N', placement: 'bottom', label: 'N' },
    { id: 'bus-pe-bottom', kind: 'PE', placement: 'bottom', label: 'PE' },
  ]
  return defaults.filter((bus) => buses.has(bus.kind))
}

const normalizeSettings = (value: unknown): ProjectSettings => {
  const raw = asRecord(value)
  const phase = raw.phase === 3 ? 3 : 1
  const cabinet = cabinetById.get(asText(raw.cabinetId))
  const rail = railById.get(asText(raw.railId) as 'rail-12' | 'rail-18')
  if (cabinet && rail && cabinet.railId === rail.id) {
    return {
      inputCurrent: asNumber(raw.inputCurrent, DEFAULT_SETTINGS.inputCurrent, 1, 1000),
      phase,
      enclosureWidth: cabinet.width,
      enclosureHeight: cabinet.height,
      enclosureDepth: cabinet.depth,
      rows: cabinet.rows,
      reserveModules: asInteger(raw.reserveModules, DEFAULT_SETTINGS.reserveModules, 0, 1000),
      cabinetId: cabinet.id,
      railId: rail.id,
    }
  }
  return {
    inputCurrent: asNumber(raw.inputCurrent, DEFAULT_SETTINGS.inputCurrent, 1, 1000),
    phase,
    enclosureWidth: asNumber(raw.enclosureWidth, 540, 120, 3000),
    enclosureHeight: asNumber(raw.enclosureHeight, 650, 150, 3000),
    enclosureDepth: asNumber(raw.enclosureDepth, 110, 30, 1000),
    rows: asInteger(raw.rows, 9, 1, 30),
    reserveModules: asInteger(raw.reserveModules, DEFAULT_SETTINGS.reserveModules, 0, 1000),
  }
}

/**
 * Migrate legacy payloads to the current schema. v1 is not merely cast: every
 * collection is normalized, and future schemas are rejected explicitly.
 */
export const migrateProject = (input: Partial<PanelProject> | null | undefined): PanelProject => {
  const source = asRecord(input)
  const sourceVersion = source.schemaVersion === undefined ? 1 : source.schemaVersion
  if (typeof sourceVersion !== 'number' || !Number.isInteger(sourceVersion) || sourceVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(`Схема проекта версии ${String(sourceVersion)} новее поддерживаемой версии ${PROJECT_SCHEMA_VERSION}`)
  }
  const now = new Date().toISOString()
  const connections = Array.isArray(source.connections) ? source.connections.map(normalizeConnection) : []
  const busAssemblies = migrateBusAssemblies(source.busAssemblies, connections)
  // A v2 line came out of the abstract left-hand column; a v3 line names the bus it is fed
  // from, so the drawing can anchor it to a real bar instead of a decorative strip.
  const knownBus = new Map(busAssemblies.map((bus) => [bus.kind, bus.id]))
  for (const connection of connections) {
    if (!connection.busId && connection.kind !== 'jumper') connection.busId = knownBus.get(connection.fromBus)
  }
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: asText(source.id, uid()),
    name: asText(source.name, 'Импортированная панель'),
    preset: asText(source.preset, 'demo'),
    createdAt: asText(source.createdAt, now),
    updatedAt: asText(source.updatedAt, now),
    settings: normalizeSettings(source.settings),
    devices: Array.isArray(source.devices) ? source.devices.map(normalizeDevice).filter((item): item is PlacedDevice => Boolean(item)) : [],
    circuits: Array.isArray(source.circuits) ? source.circuits.map(normalizeCircuit) : [],
    connections,
    busAssemblies,
    combs: Array.isArray(source.combs) ? source.combs.map(normalizeRowComb).filter((item): item is RowComb => Boolean(item)) : [],
  }
}

export const migrateProjectV1ToV2 = (input: Partial<PanelProject> | null | undefined): PanelProject =>
  migrateProject({ ...(asRecord(input) as Partial<PanelProject>), schemaVersion: 1 })

export const migrateProjectList = (input: unknown): PanelProject[] => {
  if (!Array.isArray(input) || !input.length) return []
  return input.map((project) => migrateProject(project as Partial<PanelProject>))
}

export const createDevice = (product: DeviceDefinition, row: number, slot: number): PlacedDevice => ({
  instanceId: uid(), productId: product.id, row, slot, address: '', quantity: 1, phase: 1, note: '', marking: '', mount: product.category === 'busbar' ? 'busbar' : 'din',
})

export const createProject = (name = 'Демо-панель', preset = 'demo', settings?: Partial<ProjectSettings>): PanelProject => {
  const now = new Date().toISOString()
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  const cabinet = cabinetById.get(merged.cabinetId ?? DEFAULT_CABINET_ID)
  const rail = railById.get(merged.railId ?? DEFAULT_RAIL_ID)
  if (!cabinet || !rail || cabinet.railId !== rail.id) throw new Error('Некорректный корпус или DIN-рейка')
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: uid(), name, preset, createdAt: now, updatedAt: now,
    settings: { ...merged, enclosureWidth: cabinet.width, enclosureHeight: cabinet.height, enclosureDepth: cabinet.depth, rows: cabinet.rows, cabinetId: cabinet.id, railId: rail.id },
    devices: [], circuits: [], connections: [],
    busAssemblies: DEFAULT_BUS_ASSEMBLIES(), combs: [],
  }
}

/** Every new board starts with the neutral and protective bars along its bottom edge. */
export const DEFAULT_BUS_ASSEMBLIES = (): BusAssembly[] => [
  { id: 'bus-n-bottom', kind: 'N', placement: 'bottom', label: 'N' },
  { id: 'bus-pe-bottom', kind: 'PE', placement: 'bottom', label: 'PE' },
]

export const autoNumber = (devices: PlacedDevice[], definitions: Map<string, DeviceDefinition>) => {
  const counters = new Map<string, number>()
  return devices.map((item) => {
    const product = definitions.get(item.productId)
    const prefix = product?.category === 'RCCB' ? 'QFD' : product?.category === 'RCBO' ? 'QFI' : product?.category === 'SPD' ? 'SPD' : product?.category === 'busbar' ? 'BUS' : product?.category === 'terminals' ? 'XT' : 'QF'
    const number = (counters.get(prefix) ?? 0) + 1
    const address = `${prefix}${String(number).padStart(2, '0')}`
    return { ...item, address, marking: item.marking || address }
  })
}

export const presetProducts = (preset: string): { settings: Partial<ProjectSettings>; catalog: Category[] } => {
  switch (preset) {
    case 'apartment': return { settings: { phase: 1, inputCurrent: 40, cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' }, catalog: ['MCB', 'RCCB', 'SPD', 'terminals'] }
    case 'house': return { settings: { phase: 3, inputCurrent: 63, cabinetId: 'panel36-36-r18-embedded', railId: 'rail-18' }, catalog: ['MCB', 'RCCB', 'RCBO', 'SPD', 'relay', 'terminals', 'meter', 'PSU'] }
    case 'workshop': return { settings: { phase: 3, inputCurrent: 100, cabinetId: 'panel36-48-r12-embedded', railId: 'rail-12' }, catalog: ['MCB', 'RCCB', 'RCBO', 'SPD', 'relay', 'terminals'] }
    case 'lighting': return { settings: { phase: 1, inputCurrent: 25, cabinetId: 'panel36-18-r18-embedded', railId: 'rail-18' }, catalog: ['MCB', 'RCCB', 'SPD', 'relay', 'terminals'] }
    default: return { settings: { phase: 1, inputCurrent: 63, cabinetId: DEFAULT_CABINET_ID, railId: DEFAULT_RAIL_ID }, catalog: ['MCB', 'RCCB', 'SPD', 'terminals', 'meter'] }
  }
}
