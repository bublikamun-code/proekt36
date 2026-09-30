import { cabinetById, railById } from '../data/enclosures'
import type { DeviceDefinition, PanelProject, PlacedDevice, ProjectSettings } from './types'

export const MODULE_WIDTH_MM = 18
export const LEGACY_MODULE_WIDTH_MM = 17.5
export const LEGACY_SIDE_CLEARANCE_MM = 18
export const MODULE_SIDE_CLEARANCE_MM = 30
export const MAX_ROWS = 30

export const isDinDevice = (device: PlacedDevice) => device.mount !== 'busbar'

/** The single source of truth for physical placement width. Quantity is not a footprint. */
export const getProductFootprintModules = (product: DeviceDefinition) => Math.max(1, Math.round(product.moduleWidth))
export const getFootprintModules = (device: PlacedDevice, definitions: Map<string, DeviceDefinition>) => {
  if (!isDinDevice(device)) return 0
  const product = definitions.get(device.productId)
  return product ? getProductFootprintModules(product) : 1
}

/** Alias for callers that used the less explicit name while the schema was being migrated. */
export const getDeviceFootprint = getFootprintModules

export const resolveLayout = (project: PanelProject) => {
  const cabinet = project.settings.cabinetId ? cabinetById.get(project.settings.cabinetId) : undefined
  const rail = project.settings.railId ? railById.get(project.settings.railId) : undefined
  if (cabinet && rail && cabinet.railId === rail.id) {
    return { capacity: rail.slots, modulePitchMm: rail.modulePitchMm, cabinet, rail, legacy: false }
  }
  return {
    capacity: Math.max(1, Math.floor((project.settings.enclosureWidth - LEGACY_SIDE_CLEARANCE_MM) / LEGACY_MODULE_WIDTH_MM)),
    modulePitchMm: LEGACY_MODULE_WIDTH_MM,
    cabinet: undefined,
    rail: undefined,
    legacy: true,
  }
}

export const getRequiredModules = (devices: PlacedDevice[], definitions: Map<string, DeviceDefinition>) =>
  devices.reduce((sum, device) => sum + getFootprintModules(device, definitions), 0)

export const getRowCapacity = (project: PanelProject) => resolveLayout(project).capacity

export const getFreeSlots = (project: PanelProject, definitions: Map<string, DeviceDefinition>) =>
  Math.max(0, getRowCapacity(project) * project.settings.rows - getRequiredModules(project.devices, definitions))

export const getRowUsage = (row: number, project: PanelProject, definitions: Map<string, DeviceDefinition>) => {
  const used = project.devices.filter((item) => item.row === row)
    .reduce((sum, item) => sum + getFootprintModules(item, definitions), 0)
  const capacity = getRowCapacity(project)
  return { used, capacity, percent: Math.min(100, Math.round((used / capacity) * 100)) }
}

export const getEnclosureMinimum = (project: PanelProject, definitions: Map<string, DeviceDefinition>) => {
  const layout = resolveLayout(project)
  // Width follows the widest row, not the total module count: a four-row cabinet
  // never needs to be as wide as everything it holds summed together.
  const widestRow = project.devices.reduce((max, item) => Math.max(max, item.slot + getFootprintModules(item, definitions)), 0)
  const clearance = MODULE_SIDE_CLEARANCE_MM
  const width = Math.ceil(Math.max(layout.cabinet?.width ?? 0, widestRow * layout.modulePitchMm + clearance))
  const height = Math.max(layout.cabinet?.height ?? 250, project.settings.rows * 45 + 180)
  return { width, height }
}

export const placementSort = (devices: PlacedDevice[]) =>
  [...devices].sort((a, b) => a.row - b.row || a.slot - b.slot)

export const placeProduct = (
  devices: PlacedDevice[], product: DeviceDefinition, row: number, preferredSlot: number,
  capacity: number, makeId: () => string, definitions: Map<string, DeviceDefinition>,
): { devices: PlacedDevice[]; slot: number; error?: string } => {
  if (row < 0 || row >= MAX_ROWS) return { devices, slot: preferredSlot, error: 'Неверный номер ряда' }
  if (product.category === 'busbar') {
    return { devices: [...devices, { instanceId: makeId(), productId: product.id, row, slot: 0, address: '', quantity: 1, phase: 1, note: '', marking: '', mount: 'busbar' }], slot: 0 }
  }
  const width = getProductFootprintModules(product)
  const slot = Math.max(0, Math.min(preferredSlot, Math.max(0, capacity - width)))
  if (width > capacity) return { devices, slot, error: 'Устройство шире доступного ряда' }
  const next: PlacedDevice[] = [...devices, { instanceId: makeId(), productId: product.id, row, slot, address: '', quantity: 1, phase: 1, note: '', marking: '', mount: 'din' }]
  const shifted = packRowWithInsert(next, next.at(-1)!.instanceId, row, slot, width, capacity, definitions)
  if (shifted.error) return { devices, slot, error: shifted.error }
  return { devices: shifted.devices, slot }
}

export interface DeviceMoveResult {
  devices: PlacedDevice[]
  row: number
  slot: number
  error?: string
}

/**
 * The single source of truth about where a device ends up. Inserting and moving
 * share one placement rule, so a drag preview that renders this result is
 * describing exactly the array the store is about to commit. The source array and
 * its device objects are never modified.
 */
export const resolveDeviceMove = (
  devices: PlacedDevice[], instanceId: string, row: number, slot: number,
  capacity: number, definitions: Map<string, DeviceDefinition>,
): DeviceMoveResult => {
  const moving = devices.find((item) => item.instanceId === instanceId)
  if (!moving) return { devices, row, slot, error: 'Устройство не найдено' }
  if (row < 0 || row >= MAX_ROWS) return { devices, row, slot, error: 'Позиция за пределами ряда' }
  // Busbars are wired, not plugged: they only change rows and always sit at slot 0.
  if (!isDinDevice(moving)) {
    return { devices: placementSort(devices.map((item) => (item.instanceId === instanceId ? { ...item, row, slot: 0 } : item))), row, slot: 0 }
  }
  const width = getFootprintModules(moving, definitions)
  if (width > capacity) return { devices, row, slot, error: 'Устройство шире доступного ряда' }
  // A drop past the end of the rail lands on its last free module rather than
  // failing, which is what insertion has always done.
  const target = Math.max(0, Math.min(slot, capacity - width))
  if (moving.row === row && moving.slot === target) return { devices, row, slot: target }
  const placed = devices.map((item) => (item.instanceId === instanceId ? { ...item, row, slot: target } : item))
  const packed = packRowWithInsert(placed, instanceId, row, target, width, capacity, definitions)
  if (packed.error) return { devices, row, slot: target, error: packed.error }
  return { devices: packed.devices, row, slot: target }
}

export const moveDevice = (
  devices: PlacedDevice[], instanceId: string, row: number, slot: number,
  capacity: number, definitions: Map<string, DeviceDefinition>,
): { devices: PlacedDevice[]; error?: string } => {
  const result = resolveDeviceMove(devices, instanceId, row, slot, capacity, definitions)
  return result.error ? { devices, error: result.error } : { devices: result.devices }
}

/**
 * Lays a row out around an insertion point of `width` modules starting at
 * `insertSlot`. Only the devices the inserted block actually displaces move, and
 * they keep their order as they slide: a drop into an open gap leaves the rest of
 * the row where it was, and a drop onto a neighbour pushes it aside rather than
 * failing. The source array and its device objects are never modified.
 */
const packRowWithInsert = (
  devices: PlacedDevice[], fixedInstanceId: string, row: number, insertSlot: number, width: number,
  capacity: number, definitions: Map<string, DeviceDefinition>,
): { devices: PlacedDevice[]; error?: string } => {
  const slots = new Map<string, number>()
  const rowItems = placementSort(devices.filter((item) => item.row === row && item.instanceId !== fixedInstanceId && isDinDevice(item)))
  let cursor = insertSlot + width
  let packing = false
  for (const item of rowItems) {
    const itemWidth = getFootprintModules(item, definitions)
    if (!packing) {
      if (item.slot + itemWidth <= insertSlot) continue
      if (item.slot >= cursor) break
      packing = true
      cursor = Math.max(cursor, item.slot)
    } else if (item.slot >= cursor) {
      // The row is sorted, so this device and every later one already sit clear of
      // what has been packed. Reflowing them too would be a silent whole-row shift.
      break
    }
    if (cursor + itemWidth > capacity) return { devices, error: 'Для сдвига соседей не хватает места в ряду' }
    slots.set(item.instanceId, cursor)
    cursor += itemWidth
  }
  if (!packing) return { devices: placementSort(devices) }
  return { devices: placementSort(devices.map((item) => (slots.has(item.instanceId) ? { ...item, slot: slots.get(item.instanceId)! } : item))) }
}

export const compactRow = (
  devices: PlacedDevice[],
  row: number,
  widths: Map<string, number> | Map<string, DeviceDefinition>,
) => {
  const rowItems = placementSort(devices.filter((item) => item.row === row && isDinDevice(item)))
  let cursor = 0
  const slots = new Map<string, number>()
  for (const item of rowItems) {
    const source = widths.get(item.productId)
    const width = typeof source === 'number'
      ? Math.max(1, Math.round(source))
      : getFootprintModules(item, widths as Map<string, DeviceDefinition>)
    slots.set(item.instanceId, cursor)
    cursor += width
  }
  return devices.map((item) => item.row === row && slots.has(item.instanceId) ? { ...item, slot: slots.get(item.instanceId)! } : item)
}

export type LayoutMigrationIssueCode =
  | 'invalid-target'
  | 'invalid-row'
  | 'width-overflow'
  | 'overlap'
  | 'missing-product'

export interface LayoutMigrationIssue {
  code: LayoutMigrationIssueCode
  message: string
  instanceId?: string
  relatedInstanceId?: string
}

export interface LayoutPositionChange {
  instanceId: string
  address: string
  productId: string
  productName: string
  footprintModules: number
  from: { row: number; slot: number }
  to: { row: number; slot: number }
}

export interface LayoutMigrationPlan {
  canApply: boolean
  sourceUpdatedAt: string
  source: { cabinetId?: string; railId?: ProjectSettings['railId']; rows: number; capacity: number }
  target: { cabinetId: string; railId: NonNullable<ProjectSettings['railId']>; rows: number; capacity: number; width: number; height: number; depth: number }
  settings: ProjectSettings
  devices: PlacedDevice[]
  affectedPositions: LayoutPositionChange[]
  issues: LayoutMigrationIssue[]
}

/**
 * Packs every DIN device from left to right and then top to bottom. The source
 * array and its device objects are never modified.
 */
export const fitDevicesToLayout = (
  devices: PlacedDevice[], rows: number, capacity: number,
  definitions: Map<string, DeviceDefinition>,
) => {
  const next = devices.map((item) => ({ ...item }))
  const slots = new Map<string, { row: number; slot: number }>()
  let row = 0
  let slot = 0
  for (const item of placementSort(next.filter(isDinDevice))) {
    const footprint = getFootprintModules(item, definitions)
    if (footprint > capacity) return { devices: next, fitted: false, requiredModules: getRequiredModules(next.filter(isDinDevice), definitions) }
    if (slot + footprint > capacity) {
      row += 1
      slot = 0
    }
    if (row >= rows) return { devices: next, fitted: false, requiredModules: getRequiredModules(next.filter(isDinDevice), definitions) }
    slots.set(item.instanceId, { row, slot })
    slot += footprint
  }
  for (const item of next) {
    if (isDinDevice(item)) {
      const position = slots.get(item.instanceId)
      if (position) Object.assign(item, position)
    } else if (!Number.isInteger(item.row) || item.row < 0 || item.row >= rows) {
      item.row = 0
    }
  }
  return { devices: next, fitted: true, requiredModules: getRequiredModules(next.filter(isDinDevice), definitions) }
}

/**
 * Evaluates a cabinet/rail change as a staged, non-mutating transaction.
 * Layout findings describe the source and are retained in the plan even when
 * the proposed positions repair them. Missing products and impossible total
 * capacity always block the plan.
 */
export const evaluateCabinetMigration = (
  project: PanelProject,
  definitions: Map<string, DeviceDefinition>,
  targetCabinetId: string,
  targetRailId?: ProjectSettings['railId'],
): LayoutMigrationPlan => {
  const cabinet = cabinetById.get(targetCabinetId)
  const rail = railById.get(targetRailId ?? cabinet?.railId ?? 'rail-12')
  const target = cabinet && rail
    ? { cabinetId: cabinet.id, railId: rail.id, rows: cabinet.rows, capacity: rail.slots, width: cabinet.width, height: cabinet.height, depth: cabinet.depth }
    : { cabinetId: targetCabinetId, railId: targetRailId ?? 'rail-12', rows: 0, capacity: 0, width: 0, height: 0, depth: 0 }
  const issues: LayoutMigrationIssue[] = []
  if (!cabinet || !rail || cabinet.railId !== rail.id) {
    issues.push({ code: 'invalid-target', message: 'Корпус и выбранная DIN-рейка несовместимы.' })
  }
  const settings: ProjectSettings = {
    ...project.settings,
    ...(cabinet && rail ? {
      cabinetId: cabinet.id,
      railId: rail.id,
      enclosureWidth: cabinet.width,
      enclosureHeight: cabinet.height,
      enclosureDepth: cabinet.depth,
      rows: cabinet.rows,
    } : {}),
  }
  const occupied = new Map<string, string>()
  let hasFixableLayoutIssue = false
  let hasMissingProduct = false
  let totalFootprint = 0

  for (const device of project.devices) {
    const product = definitions.get(device.productId)
    if (!product) {
      hasMissingProduct = true
      issues.push({ code: 'missing-product', message: `Товар «${device.productId}» для устройства ${device.address || device.instanceId} отсутствует в каталоге.`, instanceId: device.instanceId })
      continue
    }
    if (!Number.isInteger(device.row) || device.row < 0 || device.row >= target.rows || device.row >= MAX_ROWS) {
      hasFixableLayoutIssue = true
      issues.push({ code: 'invalid-row', message: `Устройство ${device.address || device.instanceId} находится в ряду ${device.row + 1}, которого нет в целевом корпусе.`, instanceId: device.instanceId })
    }
    if (!isDinDevice(device)) continue
    const footprint = getFootprintModules(device, definitions)
    totalFootprint += footprint
    if (!Number.isInteger(device.slot) || device.slot < 0 || device.slot + footprint > target.capacity) {
      hasFixableLayoutIssue = true
      issues.push({ code: 'width-overflow', message: `${product.name}: позиция ${Math.max(1, device.slot + 1)}–${Math.max(1, device.slot + footprint)} не помещается в рейку на ${target.capacity} модулей.`, instanceId: device.instanceId })
      continue
    }
    for (let index = 0; index < footprint; index += 1) {
      const key = `${device.row}:${device.slot + index}`
      const otherInstanceId = occupied.get(key)
      if (otherInstanceId) {
        hasFixableLayoutIssue = true
        issues.push({ code: 'overlap', message: `${product.name} пересекается с устройством ${otherInstanceId} в ряду ${device.row + 1}.`, instanceId: device.instanceId, relatedInstanceId: otherInstanceId })
        break
      }
      occupied.set(key, device.instanceId)
    }
  }
  if (target.capacity > 0 && totalFootprint > target.capacity * target.rows) {
    issues.push({ code: 'width-overflow', message: `Для устройств требуется ${totalFootprint} модулей, а целевой корпус вмещает ${target.capacity * target.rows}.` })
  }

  const fit = cabinet && rail && !hasMissingProduct && totalFootprint <= target.capacity * target.rows
    ? hasFixableLayoutIssue
      ? fitDevicesToLayout(project.devices, target.rows, target.capacity, definitions)
      : { devices: project.devices.map((item) => ({ ...item })), fitted: true, requiredModules: totalFootprint }
    : { devices: project.devices.map((item) => ({ ...item })), fitted: false, requiredModules: totalFootprint }
  const plannedById = new Map(fit.devices.map((item) => [item.instanceId, item]))
  const affectedPositions: LayoutPositionChange[] = []
  for (const source of placementSort(project.devices)) {
    const planned = plannedById.get(source.instanceId)
    if (!planned || (source.row === planned.row && source.slot === planned.slot)) continue
    const product = definitions.get(source.productId)
    affectedPositions.push({
      instanceId: source.instanceId,
      address: source.address,
      productId: source.productId,
      productName: product?.name ?? source.productId,
      footprintModules: isDinDevice(source) ? getFootprintModules(source, definitions) : 0,
      from: { row: source.row, slot: source.slot },
      to: { row: planned.row, slot: planned.slot },
    })
  }

  return {
    canApply: Boolean(cabinet && rail && cabinet.railId === rail.id && fit.fitted && !hasMissingProduct),
    sourceUpdatedAt: project.updatedAt,
    source: { cabinetId: project.settings.cabinetId, railId: project.settings.railId, rows: project.settings.rows, capacity: getRowCapacity(project) },
    target,
    settings,
    devices: fit.devices,
    affectedPositions,
    issues,
  }
}
