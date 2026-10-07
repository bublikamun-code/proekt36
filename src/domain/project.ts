import { builtinCatalog } from '../data/catalog'
import { cabinetById, railById } from '../data/enclosures'
import type { Category, Circuit, Connection, DeviceDefinition, PanelProject, PlacedDevice, ProjectSettings } from './types'
import { wireRouteError } from './wireRoute'
import { CONNECTION_THICKNESS_MM } from './connectionSpec'
import { PROJECT_SCHEMA_VERSION } from './projectSchema'

export { PROJECT_SCHEMA_VERSION } from './projectSchema'
/**
 * RFC 4122 version 4 identifier.
 *
 * `crypto.randomUUID()` exists only in a secure context, and this application is deliberately
 * server-less: it is opened from whatever address the machine happens to have. `localhost` counts
 * as secure, but `http://192.168.1.10:5173` and any plain public address do not — there
 * `crypto.randomUUID` is `undefined`, and the page used to die with
 * "crypto.randomUUID is not a function" the moment it tried to create its first project. Nothing
 * in the product needs a secure context, so the identifier cannot depend on one either.
 *
 * `crypto.getRandomValues` is available outside secure contexts, so the fallback assembles the same
 * shape by hand and sets the version and variant bits that make it a valid v4.
 */
export const uid = () => {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues !== 'function') {
    // Reached only on browsers without Web Crypto at all. Saying so beats an opaque crash: an
    // identifier that silently degrades to Math.random would collide between two records, and a
    // broken project file is worse than an application that explains why it cannot start.
    throw new Error('Браузер не умеет генерировать идентификаторы: нет crypto.getRandomValues')
  }
  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
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
    ...(asText(raw.targetDeviceId) ? { targetDeviceId: asText(raw.targetDeviceId) } : {}),
    color: asText(raw.color, '#c65c3b'),
    wireCrossSection: asNumber(raw.wireCrossSection, 1.5, 0, 1000),
    note: asText(raw.note),
  }
}

/** Normalize a connection, including old records that did not have kind. */
export const normalizeConnection = (value: unknown): Connection => {
  const raw = asRecord(value)
  const invalidRoute = wireRouteError(raw.route)
  if (invalidRoute) throw new Error(invalidRoute)
  // An older file says nothing about where a wire comes from, and its two shapes still mean what
  // they meant: a connection that names a device is a run from that device, one that names a
  // circuit is a line of it. A file that does say `bus` is a feed from the panel bus, and it is not
  // promoted to a run from a device just because a stray source id rode along.
  const kind: Connection['kind'] = raw.kind === 'bus' && !raw.fromDeviceId ? 'bus'
    : raw.kind === 'busbar' || raw.fromDeviceId ? 'busbar' : 'circuit'
  return {
    id: asText(raw.id, uid()),
    circuitId: asText(raw.circuitId),
    fromBus: raw.fromBus === 'N' || raw.fromBus === 'PE' ? raw.fromBus : 'L',
    toDeviceId: asText(raw.toDeviceId),
    color: asText(raw.color, '#c65c3b'),
    thickness: asNumber(raw.thickness, CONNECTION_THICKNESS_MM.default, CONNECTION_THICKNESS_MM.min, CONNECTION_THICKNESS_MM.max),
    label: asText(raw.label),
    kind,
    fromDeviceId: asText(raw.fromDeviceId) || undefined,
    // Zero is the first terminal, so it is written only when the file named a later one. A file that
    // never heard of the field keeps the landing it always had.
    terminal: raw.terminal === undefined ? undefined : asInteger(raw.terminal, 0, 0, 16),
    fromTerminal: raw.fromTerminal === undefined ? undefined : asInteger(raw.fromTerminal, 0, 0, 16),
    fromSide: raw.fromSide === 'top' || raw.fromSide === 'bottom' ? raw.fromSide : undefined,
    toSide: raw.toSide === 'top' || raw.toSide === 'bottom' ? raw.toSide : undefined,
    ...(raw.route === undefined ? {} : { route: JSON.parse(JSON.stringify(raw.route)) as NonNullable<Connection['route']> }),
  }
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
 * What migration is allowed to receive. A v1 payload predates `inputCurrent`, `phase` and
 * `reserveModules`, so requiring a full `ProjectSettings` here would describe the one input this
 * function exists to handle as impossible. `normalizeSettings` is the single place that fills the
 * gaps.
 */
export type LegacyPanelProject = Omit<Partial<PanelProject>, 'settings'> & {
  settings?: Partial<ProjectSettings>
}

/**
 * Migrate legacy payloads to the current schema. v1 is not merely cast: every
 * collection is normalized, and future schemas are rejected explicitly.
 */
export const migrateProject = (input: LegacyPanelProject | null | undefined): PanelProject => {
  const source = asRecord(input)
  const sourceVersion = source.schemaVersion === undefined ? 1 : source.schemaVersion
  if (typeof sourceVersion !== 'number' || !Number.isInteger(sourceVersion) || sourceVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(`Схема проекта версии ${String(sourceVersion)} новее поддерживаемой версии ${PROJECT_SCHEMA_VERSION}`)
  }
  const now = new Date().toISOString()
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
    connections: Array.isArray(source.connections) ? source.connections.map(normalizeConnection) : [],
  }
}

export const migrateProjectV1ToV2 = (input: LegacyPanelProject | null | undefined): PanelProject =>
  migrateProject({ ...(asRecord(input) as LegacyPanelProject), schemaVersion: 1 })

export const migrateProjectList = (input: unknown): PanelProject[] => {
  if (!Array.isArray(input) || !input.length) return []
  return input.map((project) => migrateProject(project as LegacyPanelProject))
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
  }
}

export const autoNumber = (devices: PlacedDevice[], definitions: Map<string, DeviceDefinition>) => {
  const counters = new Map<string, number>()
  return devices.map((item) => {
    const product = definitions.get(item.productId)
    const prefix = product?.category === 'RCCB' ? 'QFD' : product?.category === 'RCBO' ? 'QFI' : product?.category === 'SPD' ? 'SPD' : product?.category === 'busbar' ? 'BUS' : product?.category === 'terminals' ? 'XT' : 'QF'
    const number = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, number)
    const address = `${prefix}${String(number).padStart(2, '0')}`
    const automaticMarking = !item.marking?.trim() || item.marking.trim() === item.address.trim()
    return { ...item, address, marking: automaticMarking ? address : item.marking }
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

export const demoProductIds = builtinCatalog.map((product) => product.id)
