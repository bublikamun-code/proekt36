import { CATALOG_REVISION as DATA_CATALOG_REVISION } from '../data/catalog'
import type { PanelProject } from './types'
import { CIRCUIT_KINDS } from './types'
import { APP_VERSION } from '../version'

/** The only project schema understood by this application. */
export const PROJECT_SCHEMA_VERSION = 5
export const APPLICATION_REVISION = APP_VERSION
export const CATALOG_REVISION = DATA_CATALOG_REVISION
export const VALIDATION_REVISION = 5

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


export const PROJECT_LIMITS = {
  id: 128,
  name: 160,
  text: 1000,
  devices: 500,
  circuits: 500,
  connections: 2000,
  busAssemblies: 12,
  combs: 60,
  rooms: 100,
  floor: 100,
  cableLength: 1000,
  quantity: 99,
  current: 10000,
  power: 10000000,
  row: 29,
  slot: 999,
  rows: 30,
} as const

/** Schema versions this build can still read, oldest first. */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4, PROJECT_SCHEMA_VERSION] as const

/** True when the app can migrate a record of this schema version instead of refusing it. */
export const isSupportedSchemaVersion = (value: unknown): value is (typeof SUPPORTED_SCHEMA_VERSIONS)[number] =>
  typeof value === 'number' && (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(value)

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
  finiteNumber(errors, value.enclosureWidth, 'settings.enclosureWidth', { min: 1, max: 10000 })
  finiteNumber(errors, value.enclosureHeight, 'settings.enclosureHeight', { min: 1, max: 10000 })
  finiteNumber(errors, value.enclosureDepth, 'settings.enclosureDepth', { min: 1, max: 10000 })
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
  finiteNumber(errors, value.current, `${path}.current`, { min: 0, max: PROJECT_LIMITS.current })
  finiteNumber(errors, value.power, `${path}.power`, { min: 0, max: PROJECT_LIMITS.power })
  finiteNumber(errors, value.wireCrossSection, `${path}.wireCrossSection`, { min: 0, max: 1000 })
  if (value.phase !== 1 && value.phase !== 2 && value.phase !== 3) add(errors, `${path}.phase`, 'ожидается 1, 2 или 3')
  if (value.phaseCount !== 1 && value.phaseCount !== 3) add(errors, `${path}.phaseCount`, 'ожидается 1 или 3')
  if (value.phaseAmbiguous !== undefined && typeof value.phaseAmbiguous !== 'boolean') add(errors, `${path}.phaseAmbiguous`, 'ожидается логическое значение')
  enumValue(errors, value.kind, `${path}.kind`, CIRCUIT_KINDS, false)
  string(errors, value.roomId, `${path}.roomId`, { max: PROJECT_LIMITS.id })
  // A planned line starts with an unmeasured run: an absent cableLength is «not known yet»,
  // the same «not known» an empty roomId means, and not a malformed number.
  if (value.cableLength !== undefined) finiteNumber(errors, value.cableLength, `${path}.cableLength`, { min: 0, max: PROJECT_LIMITS.cableLength })
}

const validateRoom = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект помещения'); return }
  string(errors, value.id, `${path}.id`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  string(errors, value.name, `${path}.name`, { required: true, max: PROJECT_LIMITS.text, nonEmpty: true })
  finiteNumber(errors, value.floor, `${path}.floor`, { min: 0, max: PROJECT_LIMITS.floor, integer: true })
}

const validateTerminalRef = (errors: string[], value: unknown, path: string) => {
  if (value === undefined) return
  if (!isRecord(value)) { add(errors, path, 'ожидается объект клеммы'); return }
  string(errors, value.deviceId, `${path}.deviceId`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  finiteNumber(errors, value.pole, `${path}.pole`, { min: 0, max: 12, integer: true })
  enumValue(errors, value.side, `${path}.side`, ['top', 'bottom'])
}

const validateBusAssembly = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект шины'); return }
  string(errors, value.id, `${path}.id`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  enumValue(errors, value.kind, `${path}.kind`, ['L', 'N', 'PE'])
  enumValue(errors, value.placement, `${path}.placement`, ['top', 'bottom'])
  string(errors, value.label, `${path}.label`, { max: 64 })
}

const validateRowComb = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект гребёнки'); return }
  string(errors, value.id, `${path}.id`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  finiteNumber(errors, value.row, `${path}.row`, { min: 0, max: PROJECT_LIMITS.row, integer: true })
  finiteNumber(errors, value.poles, `${path}.poles`, { min: 1, max: 4, integer: true })
  finiteNumber(errors, value.fromSlot, `${path}.fromSlot`, { min: 0, max: PROJECT_LIMITS.slot, integer: true })
  finiteNumber(errors, value.toSlot, `${path}.toSlot`, { min: 0, max: PROJECT_LIMITS.slot, integer: true })
  string(errors, value.label, `${path}.label`, { max: 64 })
}

const validateConnection = (errors: string[], value: unknown, path: string) => {
  if (!isRecord(value)) { add(errors, path, 'ожидается объект подключения'); return }
  string(errors, value.id, `${path}.id`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  string(errors, value.circuitId, `${path}.circuitId`, { max: PROJECT_LIMITS.id })
  enumValue(errors, value.fromBus, `${path}.fromBus`, ['L', 'N', 'PE'])
  string(errors, value.toDeviceId, `${path}.toDeviceId`, { required: true, max: PROJECT_LIMITS.id, nonEmpty: true })
  // An empty colour is how a conductor says «paint me the colour of the bus I come from»: wireColor
  // falls back to the N/PE/phase colours, and addWire, addBusWire and the demo project all rely on
  // it. Insisting on a value here would make the board the app just drew impossible to save.
  string(errors, value.color, `${path}.color`, { required: true, max: 64, nonEmpty: false })
  finiteNumber(errors, value.thickness, `${path}.thickness`, { min: 0.1, max: 100 })
  // The label is a caption drawn from the addresses of the two ends, not an identity: a wire to
  // an unnumbered device simply has nothing to quote. autoConnectionLabel writes an empty string
  // in exactly that case, and the board is still worth saving.
  string(errors, value.label, `${path}.label`, { required: true, max: PROJECT_LIMITS.text, nonEmpty: false })
  enumValue(errors, value.kind, `${path}.kind`, ['circuit', 'busbar', 'jumper'], false)
  if (value.fromDeviceId !== undefined) string(errors, value.fromDeviceId, `${path}.fromDeviceId`, { max: PROJECT_LIMITS.id })
  if (value.busId !== undefined) string(errors, value.busId, `${path}.busId`, { max: PROJECT_LIMITS.id })
  validateTerminalRef(errors, value.fromTerminal, `${path}.fromTerminal`)
  validateTerminalRef(errors, value.toTerminal, `${path}.toTerminal`)
  if (value.phase !== undefined && value.phase !== 1 && value.phase !== 2 && value.phase !== 3) add(errors, `${path}.phase`, 'ожидается 1, 2 или 3')
  // A jumper is a wire between two clamps. Without both ends it is not a connection, and a
  // half-anchored one would silently render as a line that stops in mid-air.
  if (value.kind === 'jumper') {
    if (!isRecord(value.fromTerminal)) add(errors, `${path}.fromTerminal`, 'для перемычки укажите клемму источника')
    if (!isRecord(value.toTerminal)) add(errors, `${path}.toTerminal`, 'для перемычки укажите клемму приёмника')
  }
}

const validateReferences = (errors: string[], project: RecordValue) => {
  const devices = Array.isArray(project.devices) ? project.devices.filter(isRecord) : []
  const circuits = Array.isArray(project.circuits) ? project.circuits.filter(isRecord) : []
  const connections = Array.isArray(project.connections) ? project.connections.filter(isRecord) : []
  const buses = Array.isArray(project.busAssemblies) ? project.busAssemblies.filter(isRecord) : []
  const rooms = Array.isArray(project.rooms) ? project.rooms.filter(isRecord) : []
  const deviceIds = new Set(devices.map((item) => typeof item.instanceId === 'string' ? item.instanceId : ''))
  const circuitIds = new Set(circuits.map((item) => typeof item.id === 'string' ? item.id : ''))
  const busIds = new Set(buses.map((item) => typeof item.id === 'string' ? item.id : ''))
  const roomIds = new Set(rooms.map((item) => typeof item.id === 'string' ? item.id : ''))
  for (const [index, circuit] of circuits.entries()) {
    if (typeof circuit.protectionDeviceId === 'string' && !deviceIds.has(circuit.protectionDeviceId)) add(errors, `circuits[${index}].protectionDeviceId`, `ссылается на несуществующее устройство «${circuit.protectionDeviceId}»`)
    // An empty roomId is a planner-free line; only a named room has to exist.
    if (typeof circuit.roomId === 'string' && circuit.roomId && !roomIds.has(circuit.roomId)) add(errors, `circuits[${index}].roomId`, `ссылается на несуществующее помещение «${circuit.roomId}»`)
  }
  for (const [index, connection] of connections.entries()) {
    if (typeof connection.toDeviceId === 'string' && !deviceIds.has(connection.toDeviceId)) add(errors, `connections[${index}].toDeviceId`, `ссылается на несуществующее устройство «${connection.toDeviceId}»`)
    if (typeof connection.busId === 'string' && connection.busId && !busIds.has(connection.busId)) add(errors, `connections[${index}].busId`, `ссылается на несуществующую шину «${connection.busId}»`)
    for (const key of ['fromTerminal', 'toTerminal']) {
      const terminal = connection[key]
      if (!isRecord(terminal)) continue
      const deviceId = terminal.deviceId
      if (typeof deviceId === 'string' && !deviceIds.has(deviceId)) add(errors, `connections[${index}].${key}.deviceId`, `ссылается на несуществующее устройство «${deviceId}»`)
    }
    if (connection.kind === 'busbar') {
      if (typeof connection.fromDeviceId !== 'string' || !deviceIds.has(connection.fromDeviceId)) add(errors, `connections[${index}].fromDeviceId`, 'для подключения к шине укажите существующее устройство-источник')
    } else if (connection.kind !== 'jumper' && typeof connection.circuitId === 'string' && connection.circuitId && !circuitIds.has(connection.circuitId)) {
      // An empty circuitId is a wire drawn by hand between two clamps, which belongs to no
      // circuit by definition — addWire and addBusWire both write it. Only a named circuit has
      // to exist, otherwise the board could not be saved the moment a user drew a jumper.
      add(errors, `connections[${index}].circuitId`, `ссылается на несуществующую цепь «${connection.circuitId}»`)
    }
  }
}

/** Validates a v1, v2 or v3 payload without silently changing it. */
export const validateProjectSchema = (value: unknown): ProjectSchemaValidationResult => {
  const errors: string[] = []
  if (!isRecord(value)) {
    add(errors, 'project', 'ожидается объект проекта')
    return { valid: false, ok: false, errors, issues: errors }
  }
  const version = value.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) add(errors, 'schemaVersion', `ожидается целая версия схемы из ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`)
  else if (version > PROJECT_SCHEMA_VERSION) add(errors, 'schemaVersion', `схема версии ${version} новее поддерживаемой версии ${PROJECT_SCHEMA_VERSION}; обновите приложение`)
  else if (!SUPPORTED_SCHEMA_VERSIONS.includes(version as 1 | 2 | 3 | 4)) add(errors, 'schemaVersion', `версия схемы ${version} не поддерживается`)
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
    if (array(errors, value.busAssemblies, 'busAssemblies', PROJECT_LIMITS.busAssemblies)) {
      const buses = value.busAssemblies as unknown[]
      buses.forEach((item, index) => validateBusAssembly(errors, item, `busAssemblies[${index}]`))
      duplicate(errors, buses.filter(isRecord).map((item) => typeof item.id === 'string' ? item.id : ''), 'busAssemblies.id')
    }
    if (array(errors, value.combs, 'combs', PROJECT_LIMITS.combs)) {
      const combs = value.combs as unknown[]
      combs.forEach((item, index) => validateRowComb(errors, item, `combs[${index}]`))
      duplicate(errors, combs.filter(isRecord).map((item) => typeof item.id === 'string' ? item.id : ''), 'combs.id')
    }
    if (array(errors, value.rooms, 'rooms', PROJECT_LIMITS.rooms)) {
      const rooms = value.rooms as unknown[]
      rooms.forEach((item, index) => validateRoom(errors, item, `rooms[${index}]`))
      duplicate(errors, rooms.filter(isRecord).map((item) => typeof item.id === 'string' ? item.id : ''), 'rooms.id')
    }
    if (!errors.some((item) => item.startsWith('devices') || item.startsWith('circuits') || item.startsWith('connections') || item.startsWith('busAssemblies') || item.startsWith('combs') || item.startsWith('rooms'))) validateReferences(errors, value)
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
