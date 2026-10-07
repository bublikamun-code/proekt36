import { CATALOG_REVISION as DATA_CATALOG_REVISION } from '../data/catalog'
import { wireRouteError } from './wireRoute'
import { CONNECTION_THICKNESS_MM } from './connectionSpec'
import type { PanelProject } from './types'
import { APP_VERSION } from '../version'

/** The only project schema understood by this application. */
export const PROJECT_SCHEMA_VERSION = 2
export const APPLICATION_REVISION = APP_VERSION
export const CATALOG_REVISION = DATA_CATALOG_REVISION
/**
 * The rule set, bumped whenever a check is added, removed or reworded. A project saved under an
 * older revision keeps reading, but the report says which rules produced it, so a change here is
 * visible in the printed output instead of silently changing what "no issues" means.
 */
export const VALIDATION_REVISION = 3

/**
 * Orders two revision strings and returns a negative number when `left` is older. Both
 * shapes in use here are dotted numbers — a semver (`0.1.0`) and a catalogue date
 * (`2026-09-24.1`) — so the segments are compared numerically after splitting on dots
 * and dashes.
 */
export const compareRevisions = (left: string, right: string): number => {
  const parts = (value: string) => value.trim().split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : -1))
  const first = parts(left)
  const second = parts(right)
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const a = first[index] ?? -1
    const b = second[index] ?? -1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/** A revision has to be comparable; anything else cannot be trusted as a version. */
export const isKnownRevision = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0
  if (typeof value !== 'string') return false
  return /^\d+([.-]\d+)*$/.test(value.trim())
}

/** True when a file was written by a build this one cannot be expected to read. */
export const isFutureRevision = (value: unknown, current: string | number): boolean => {
  if (!isKnownRevision(value)) return true
  return compareRevisions(String(value), String(current)) > 0
}


/**
 * The highest terminal index a connection may name.
 *
 * A terminal block with more screws than this is not a thing on a DIN rail, and the bound is what
 * keeps a hand-edited file from pointing a wire at a terminal that cannot exist.
 */
export const CONNECTION_TERMINAL_LIMIT = 16

export const PROJECT_LIMITS = {
  id: 128,
  name: 160,
  text: 1000,
  devices: 500,
  circuits: 500,
  connections: 2000,
  quantity: 99,
  current: 10000,
  power: 10000000,
  row: 29,
  slot: 999,
  rows: 30,
  /**
   * Enclosure dimensions in millimetres. These three used to be checked against 1–10000, which
   * accepts a ten-metre cabinet: a bound that no real enclosure can satisfy is not a bound, it is
   * a gap. The numbers below are far above anything in the catalogue (the widest body there is
   * 392 mm) and far below nonsense, so a damaged record is refused while a future, larger
   * cabinet is not refused for being larger.
   */
  enclosureWidth: { min: 50, max: 2000 },
  enclosureHeight: { min: 50, max: 2000 },
  enclosureDepth: { min: 10, max: 1000 },
} as const

export interface ProjectSchemaValidationResult {
  valid: boolean
  ok: boolean
  errors: string[]
  issues: string[]
  data?: PanelProject
}

export class ProjectSchemaError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors[0] ?? 'Некорректная схема проекта')
    this.name = 'ProjectSchemaError'
    this.errors = errors
  }
}

type RecordValue = Record<string, unknown>
const isRecord = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const add = (errors: string[], path: string, message: string) => errors.push(`${path}: ${message}`)

const string = (
  errors: string[], value: unknown, path: string,
  options: { required?: boolean; max?: number; nonEmpty?: boolean } = {},
) => {
  if (value === undefined && options.required) {
    add(errors, path, 'обязательное строковое поле отсутствует')
    return
  }
  if (value === undefined) return
  if (typeof value !== 'string') {
    add(errors, path, 'ожидается строка')
    return
  }
  if ((options.nonEmpty ?? options.required) && !value.trim()) add(errors, path, 'значение не может быть пустым')
  if (value.length > (options.max ?? PROJECT_LIMITS.text)) add(errors, path, `слишком длинное значение (максимум ${options.max ?? PROJECT_LIMITS.text} символов)`)
}

const finiteNumber = (
  errors: string[], value: unknown, path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    add(errors, path, 'ожидается конечное число')
    return
  }
  if (options.integer && !Number.isInteger(value)) add(errors, path, 'ожидается целое число')
  if (options.min !== undefined && value < options.min) add(errors, path, `значение должно быть не меньше ${options.min}`)
  if (options.max !== undefined && value > options.max) add(errors, path, `значение должно быть не больше ${options.max}`)
}

const enumValue = (errors: string[], value: unknown, path: string, values: readonly string[], required = true) => {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || !values.includes(value)) add(errors, path, `ожидается одно из значений: ${values.join(', ')}`)
}

const isoDate = (errors: string[], value: unknown, path: string) => {
  string(errors, value, path, { required: true, max: 64, nonEmpty: true })
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    add(errors, path, 'ожидается корректная дата в формате ISO 8601 UTC')
  }
}

const array = (errors: string[], value: unknown, path: string, max: number) => {
  if (!Array.isArray(value)) {
    add(errors, path, 'ожидается массив')
    return false
  }
  if (value.length > max) add(errors, path, `слишком много элементов (максимум ${max})`)
  return true
}

const duplicate = (errors: string[], values: string[], path: string) => {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) add(errors, path, `повторяется идентификатор «${value}»`)
    seen.add(value)
  }
}

const validateSettings = (errors: string[], value: unknown) => {
  if (!isRecord(value)) { add(errors, 'settings', 'ожидается объект настроек'); return }
  finiteNumber(errors, value.inputCurrent, 'settings.inputCurrent', { min: 1, max: 1000 })
  if (value.phase !== 1 && value.phase !== 3) add(errors, 'settings.phase', 'ожидается 1 или 3')
  finiteNumber(errors, value.enclosureWidth, 'settings.enclosureWidth', { min: PROJECT_LIMITS.enclosureWidth.min, max: PROJECT_LIMITS.enclosureWidth.max })
  finiteNumber(errors, value.enclosureHeight, 'settings.enclosureHeight', { min: PROJECT_LIMITS.enclosureHeight.min, max: PROJECT_LIMITS.enclosureHeight.max })
  finiteNumber(errors, value.enclosureDepth, 'settings.enclosureDepth', { min: PROJECT_LIMITS.enclosureDepth.min, max: PROJECT_LIMITS.enclosureDepth.max })
  finiteNumber(errors, value.rows, 'settings.rows', { min: 1, max: PROJECT_LIMITS.rows, integer: true })
  finiteNumber(errors, value.reserveModules, 'settings.reserveModules', { min: 0, max: 1000, integer: true })
  if (value.cabinetId !== undefined) string(errors, value.cabinetId, 'settings.cabinetId', { max: PROJECT_LIMITS.id, nonEmpty: true })
  if (value.railId !== undefined) enumValue(errors, value.railId, 'settings.railId', ['rail-12', 'rail-18'])
}

const validateDevice = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект устройства'); return }
  string(errors, value.instanceId, `${path}.instanceId`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  string(errors, value.productId, `${path}.productId`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  string(errors, value.address, `${path}.address`, { required: true, max: 64 })
  string(errors, value.note, `${path}.note`, { required: true, max: PROJECT_LIMITS.text, nonEmpty: false })
  string(errors, value.marking, `${path}.marking`, { max: 64 })
  finiteNumber(errors, value.row, `${path}.row`, { min: 0, max: PROJECT_LIMITS.row, integer: true })
  finiteNumber(errors, value.slot, `${path}.slot`, { min: 0, max: PROJECT_LIMITS.slot, integer: true })
  finiteNumber(errors, value.quantity, `${path}.quantity`, { min: 1, max: PROJECT_LIMITS.quantity, integer: true })
  if (value.phase !== 1 && value.phase !== 2 && value.phase !== 3) add(errors, `${path}.phase`, 'ожидается 1, 2 или 3')
  enumValue(errors, value.mount, `${path}.mount`, ['din', 'busbar'])
}

const validateCircuit = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект цепи'); return }
  for (const key of ['id', 'name', 'loadName', 'protectionDeviceId', 'color', 'note']) string(errors, value[key], `${path}.${key}`, { required: true, max: key === 'id' ? PROJECT_LIMITS.id : PROJECT_LIMITS.text, nonEmpty: key !== 'note' })
  if (value.targetDeviceId !== undefined) string(errors, value.targetDeviceId, `${path}.targetDeviceId`, { max: PROJECT_LIMITS.id, nonEmpty: true })
  finiteNumber(errors, value.current, `${path}.current`, { min: 0, max: PROJECT_LIMITS.current })
  finiteNumber(errors, value.power, `${path}.power`, { min: 0, max: PROJECT_LIMITS.power })
  finiteNumber(errors, value.wireCrossSection, `${path}.wireCrossSection`, { min: 0, max: 1000 })
  if (value.phase !== 1 && value.phase !== 2 && value.phase !== 3) add(errors, `${path}.phase`, 'ожидается 1, 2 или 3')
}

const validateConnection = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект подключения'); return }
  string(errors, value.id, `${path}.id`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  string(errors, value.circuitId, `${path}.circuitId`, { max: PROJECT_LIMITS.id })
  enumValue(errors, value.fromBus, `${path}.fromBus`, ['L', 'N', 'PE'])
  string(errors, value.toDeviceId, `${path}.toDeviceId`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  string(errors, value.color, `${path}.color`, { required: true, max: 64, nonEmpty: true })
  finiteNumber(errors, value.thickness, `${path}.thickness`, { min: CONNECTION_THICKNESS_MM.min, max: CONNECTION_THICKNESS_MM.max })
  string(errors, value.label, `${path}.label`, { required: true, max: PROJECT_LIMITS.text })
  const invalidRoute = wireRouteError(value.route)
  if (invalidRoute) add(errors, `${path}.route`, invalidRoute)
  enumValue(errors, value.kind, `${path}.kind`, ['circuit', 'busbar', 'bus'], false)
  if (value.fromDeviceId !== undefined) string(errors, value.fromDeviceId, `${path}.fromDeviceId`, { max: PROJECT_LIMITS.id })
  // A terminal index is optional and small: it counts screws on a terminal block, and nothing in the
  // panel has more than a handful. A file without it keeps the first terminal.
  for (const field of ['fromSide', 'toSide'] as const) {
    enumValue(errors, value[field], `${path}.${field}`, ['top', 'bottom'], false)
  }
  for (const field of ['terminal', 'fromTerminal'] as const) {
    if (value[field] === undefined) continue
    finiteNumber(errors, value[field], `${path}.${field}`, { min: 0, max: CONNECTION_TERMINAL_LIMIT, integer: true })
  }
}

const validateReferences = (errors: string[], project: RecordValue) => {
  const devices = Array.isArray(project.devices) ? project.devices.filter(isRecord) : []
  const circuits = Array.isArray(project.circuits) ? project.circuits.filter(isRecord) : []
  const connections = Array.isArray(project.connections) ? project.connections.filter(isRecord) : []
  const deviceIds = new Set(devices.map((item) => typeof item.instanceId === 'string' ? item.instanceId : ''))
  const circuitIds = new Set(circuits.map((item) => typeof item.id === 'string' ? item.id : ''))
  for (const [index, circuit] of circuits.entries()) {
    if (typeof circuit.targetDeviceId === 'string' && !deviceIds.has(circuit.targetDeviceId)) add(errors, `circuits[${index}].targetDeviceId`, `ссылается на несуществующее устройство «${circuit.targetDeviceId}»`)
    if (typeof circuit.protectionDeviceId === 'string' && !deviceIds.has(circuit.protectionDeviceId)) add(errors, `circuits[${index}].protectionDeviceId`, `ссылается на несуществующее устройство «${circuit.protectionDeviceId}»`)
  }
  for (const [index, connection] of connections.entries()) {
    if (typeof connection.toDeviceId === 'string' && !deviceIds.has(connection.toDeviceId)) add(errors, `connections[${index}].toDeviceId`, `ссылается на несуществующее устройство «${connection.toDeviceId}»`)
    if (connection.kind === 'busbar') {
      if (typeof connection.fromDeviceId !== 'string' || !deviceIds.has(connection.fromDeviceId)) add(errors, `connections[${index}].fromDeviceId`, 'для подключения к шине укажите существующее устройство-источник')
    } else if (connection.kind === 'bus') {
      // A feed from the panel bus has no source device — that is what makes it a feed. A file that
      // names one is a cascade that lost its kind, and reading it as a feed would quietly move the
      // wire off the device it actually leaves from.
      if (connection.fromDeviceId !== undefined) add(errors, `connections[${index}].fromDeviceId`, 'подключение от шины щита не указывает устройство-источник')
    } else if (typeof connection.circuitId === 'string' && !circuitIds.has(connection.circuitId)) {
      add(errors, `connections[${index}].circuitId`, `ссылается на несуществующую цепь «${connection.circuitId}»`)
    }
  }
}

/** Validates a v1 or v2 payload without silently changing it. */
export const validateProjectSchema = (value: unknown): ProjectSchemaValidationResult => {
  const errors: string[] = []
  if (!isRecord(value)) {
    add(errors, 'project', 'ожидается объект проекта')
    return { valid: false, ok: false, errors, issues: errors }
  }
  const version = value.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) add(errors, 'schemaVersion', 'ожидается целая версия схемы 1 или 2')
  else if (version > PROJECT_SCHEMA_VERSION) add(errors, 'schemaVersion', `схема версии ${version} новее поддерживаемой версии ${PROJECT_SCHEMA_VERSION}; обновите приложение`)
  else if (![1, PROJECT_SCHEMA_VERSION].includes(version)) add(errors, 'schemaVersion', `версия схемы ${version} не поддерживается`)
  if (version === PROJECT_SCHEMA_VERSION) {
    string(errors, value.id, 'id', { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
    string(errors, value.name, 'name', { required: true, max: PROJECT_LIMITS.name, nonEmpty: true })
    string(errors, value.preset, 'preset', { required: true, max: 64, nonEmpty: true })
    isoDate(errors, value.createdAt, 'createdAt'); isoDate(errors, value.updatedAt, 'updatedAt')
    validateSettings(errors, value.settings)
    if (array(errors, value.devices, 'devices', PROJECT_LIMITS.devices)) {
      const devices = value.devices as unknown[]
      devices.forEach((item, index) => validateDevice(errors, item, `devices[${index}]`))
      duplicate(errors, devices.filter(isRecord).map((item) => typeof item.instanceId === 'string' ? item.instanceId : ''), 'devices.instanceId')
    }
    if (array(errors, value.circuits, 'circuits', PROJECT_LIMITS.circuits)) {
      const circuits = value.circuits as unknown[]
      circuits.forEach((item, index) => validateCircuit(errors, item, `circuits[${index}]`))
      duplicate(errors, circuits.filter(isRecord).map((item) => typeof item.id === 'string' ? item.id : ''), 'circuits.id')
    }
    if (array(errors, value.connections, 'connections', PROJECT_LIMITS.connections)) {
      const connections = value.connections as unknown[]
      connections.forEach((item, index) => validateConnection(errors, item, `connections[${index}]`))
      duplicate(errors, connections.filter(isRecord).map((item) => typeof item.id === 'string' ? item.id : ''), 'connections.id')
    }
    if (!errors.some((item) => item.startsWith('devices') || item.startsWith('circuits') || item.startsWith('connections'))) validateReferences(errors, value)
  } else if (version === 1) {
    if (!Array.isArray(value.devices)) add(errors, 'devices', 'ожидается массив устройств')
    if (value.circuits !== undefined && !Array.isArray(value.circuits)) add(errors, 'circuits', 'ожидается массив цепей')
    if (value.connections !== undefined && !Array.isArray(value.connections)) add(errors, 'connections', 'ожидается массив подключений')
  }
  return { valid: errors.length === 0, ok: errors.length === 0, errors, issues: errors, data: errors.length === 0 && version === PROJECT_SCHEMA_VERSION ? value as unknown as PanelProject : undefined }
}

export const assertValidProjectSchema = (value: unknown): PanelProject => {
  const result = validateProjectSchema(value)
  if (!result.valid || !result.data) throw new ProjectSchemaError(result.errors)
  return result.data
}

export const isValidProjectSchema = (value: unknown): value is PanelProject => validateProjectSchema(value).valid && (value as PanelProject).schemaVersion === PROJECT_SCHEMA_VERSION
