import { categoryLabels } from '../data/catalog'
import { cabinetById } from '../data/enclosures'
import { getFootprintModules, getFreeSlots, getRowCapacity, isDinDevice, resolveLayout } from './layout'
import { phaseBalance } from './validation'
import { APPLICATION_REVISION, CATALOG_REVISION } from './projectSchema'
import type { Category, DeviceDefinition, PanelProject, ValidationIssue } from './types'

/**
 * Everything the assistant is allowed to see. The payload is built here and nowhere
 * else, so the "summary only" promise is enforced in one auditable place: device
 * addresses, markings, notes, catalogue names, SKUs, source links, circuit names,
 * connection labels and every CAD binary stay in the browser and are never read here.
 * Validation issues are reduced to their static code/level/title, because the
 * human-readable message and the context object interpolate device ids and product
 * names and would carry exactly the data the user did not agree to send.
 */
/**
 * The summary payload the assistant receives. Bumped to v2 for `occupancy.devicesTotal`, which
 * separates placed positions from physical apparatus — the field is additive, but a model that
 * read `devices` as a count of apparatus would still be wrong, so the revision is the honest marker.
 */
export const ASSISTANT_CONTEXT_REVISION = 'panel36.assistant-context.v2'

export interface AssistantCategoryCount {
  category: Category
  label: string
  devices: number
  modules: number
}

export interface AssistantRowUsage {
  row: number
  devices: number
  usedModules: number
  freeModules: number
}

export interface AssistantIssueCount {
  code: string
  level: ValidationIssue['level']
  title: string
  count: number
}

export interface AssistantContext {
  revision: typeof ASSISTANT_CONTEXT_REVISION
  applicationRevision: string
  catalogRevision: string
  /** Fixed preset name from a closed list; the project title and id are never included. */
  preset: string
  panel: {
    phase: PanelProject['settings']['phase']
    inputCurrentA: number
    rows: number
    railModules: number
    railPitchMm: number
    legacyLayout: boolean
    cabinet: { modules: number; rows: number; mounting: string; verification: string } | null
    enclosure: { widthMm: number; heightMm: number; depthMm: number }
  }
  occupancy: {
    /** Placed positions on the board: one per record, regardless of how many poles it carries. */
    devices: number
    /** Physical apparatus behind those positions, counting `quantity` on each. */
    devicesTotal: number
    usedModules: number
    capacityModules: number
    freeModules: number
    byCategory: AssistantCategoryCount[]
    byRow: AssistantRowUsage[]
  }
  load: {
    circuits: number
    circuitsWithoutProtection: number
    circuitsWithoutConnections: number
    totalCurrentA: number
    perPhaseA: number[]
    spreadPercent: number
  }
  issues: AssistantIssueCount[]
}

const countIssues = (issues: ValidationIssue[]): AssistantIssueCount[] => {
  const grouped = new Map<string, AssistantIssueCount>()
  for (const item of issues) {
    const current = grouped.get(item.ruleCode)
    if (current) {
      current.count += 1
      continue
    }
    grouped.set(item.ruleCode, { code: item.ruleCode, level: item.level, title: item.title, count: 1 })
  }
  return [...grouped.values()].sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
}

export const buildAssistantContext = (
  project: PanelProject,
  definitions: Map<string, DeviceDefinition>,
  issues: ValidationIssue[],
): AssistantContext => {
  const layout = resolveLayout(project)
  const railModules = getRowCapacity(project)
  const rows = Math.max(0, project.settings.rows)

  const byCategory = new Map<Category, AssistantCategoryCount>()
  const byRow: AssistantRowUsage[] = Array.from({ length: rows }, (_, row) => ({ row, devices: 0, usedModules: 0, freeModules: 0 }))
  let usedModules = 0
  let devices = 0
  let devicesTotal = 0

  for (const item of project.devices) {
    const product = definitions.get(item.productId)
    devices += 1
    // A record stands for one position but may stand for several apparatus: a four-pole breaker
    // with `quantity: 3` is three devices on the board, and telling the assistant "1" is how a
    // question about the number of devices gets a confidently wrong answer.
    devicesTotal += item.quantity > 1 ? item.quantity : 1
    const width = isDinDevice(item) ? getFootprintModules(item, definitions) : 0
    usedModules += width
    const category = product?.category
    if (category) {
      const current = byCategory.get(category) ?? { category, label: categoryLabels[category] ?? category, devices: 0, modules: 0 }
      current.devices += 1
      current.modules += width
      byCategory.set(category, current)
    }
    const row = byRow[item.row]
    if (row) {
      row.devices += 1
      row.usedModules += width
    }
  }
  for (const row of byRow) row.freeModules = Math.max(0, railModules - row.usedModules)

  const balance = phaseBalance(project, definitions)
  const totals = balance.totals
  const perPhaseA = project.settings.phase === 3 ? [totals[0] ?? 0, totals[1] ?? 0, totals[2] ?? 0] : [totals[0] ?? 0]
  const cabinet = project.settings.cabinetId ? cabinetById.get(project.settings.cabinetId) : undefined
  const connected = new Set((project.connections ?? []).filter((item) => item.circuitId).map((item) => item.circuitId))
  // Empty protection ids are dropped before they reach the set. Left in, an unprotected circuit
  // carrying `protectionDeviceId: ''` would find another unprotected circuit's empty id in the set
  // and count itself as protected — every unprotected circuit after the first one hides behind it,
  // and the assistant is then told the board needs nothing.
  const protectionIds = new Set((project.circuits ?? []).map((item) => item.protectionDeviceId).filter(Boolean))

  return {
    revision: ASSISTANT_CONTEXT_REVISION,
    applicationRevision: APPLICATION_REVISION,
    catalogRevision: CATALOG_REVISION,
    preset: project.preset,
    panel: {
      phase: project.settings.phase,
      inputCurrentA: project.settings.inputCurrent,
      rows,
      railModules,
      railPitchMm: layout.modulePitchMm,
      legacyLayout: layout.legacy,
      cabinet: cabinet
        ? { modules: cabinet.modules, rows: cabinet.rows, mounting: cabinet.mounting, verification: cabinet.verificationStatus }
        : null,
      enclosure: {
        widthMm: project.settings.enclosureWidth,
        heightMm: project.settings.enclosureHeight,
        depthMm: project.settings.enclosureDepth,
      },
    },
    occupancy: {
      devices,
      devicesTotal,
      usedModules,
      capacityModules: railModules * rows,
      freeModules: Math.max(0, getFreeSlots(project, definitions)),
      byCategory: [...byCategory.values()].sort((left, right) => right.devices - left.devices || left.category.localeCompare(right.category)),
      byRow,
    },
    load: {
      circuits: (project.circuits ?? []).length,
      circuitsWithoutProtection: (project.circuits ?? []).filter((item) => !protectionIds.has(item.protectionDeviceId)).length,
      circuitsWithoutConnections: (project.circuits ?? []).filter((item) => !connected.has(item.id)).length,
      totalCurrentA: perPhaseA.reduce((sum, value) => sum + value, 0),
      perPhaseA,
      spreadPercent: balance.spread,
    },
    issues: countIssues(issues),
  }
}

/** The human-readable list shown to the user before anything is sent. */
export const assistantContextDisclosure = (context: AssistantContext): string[] => [
  `пресет: ${context.preset}`,
  `сеть: ${context.panel.phase} ф., ввод ${context.panel.inputCurrentA} А, ${context.panel.rows} ряд(ов) по ${context.panel.railModules} мод.`,
  `занято ${context.occupancy.usedModules} из ${context.occupancy.capacityModules} модулей, позиций: ${context.occupancy.devices}, аппаратов: ${context.occupancy.devicesTotal}`,
  `цепи: ${context.load.circuits}, суммарный ток ${context.load.totalCurrentA} А, разброс фаз ${context.load.spreadPercent}%`,
  `состав по категориям: ${context.occupancy.byCategory.map((item) => `${item.label} — ${item.devices}`).join(', ') || 'пусто'}`,
  `замечания проверок: ${context.issues.map((item) => `${item.title} (${item.count})`).join('; ') || 'нет'}`,
]

export const formatAssistantContext = (context: AssistantContext): string => JSON.stringify(context, null, 2)
