import type { DeviceDefinition, PanelProject } from './types'

/**
 * The sheet of labels the panel actually needs on it.
 *
 * The project has known every address on the board since the start, and the validation rules have
 * long said which ones are missing or repeated — but all of that ended as a column in the marking
 * table. The thing an electrician applies to the enclosure was never produced. This is it: one
 * label per position, in the order they are cut, with cut lines and an honest count of the
 * positions that cannot be labelled yet.
 *
 * It is a sheet, not an order. It names no vendor, quotes no price and promises no delivery, and
 * it says so in the same words as every other page that prints a specification.
 */

/** Beyond this length the print sheet warns that the label needs more vertical space. */
export const LABEL_TEXT_MAX = 22

export interface LabelEntry {
  instanceId: string
  address: string
  /** Full user marking, with address/circuit fallback. */
  text: string
  /** Kept for consumers that need the original label text. */
  fullText: string
  position: string
  row: number
  slot: number
  name: string
  brand: string
  marked: boolean
  /** True when the same address sits on more than one position, which makes both labels suspect. */
  duplicated: boolean
}

export interface LabelSheet {
  labels: LabelEntry[]
  title: string
  /** Positions with no address at all. */
  unmarked: number
  duplicated: number
  longLabels: number
}

export const positionWord = (count: number) => {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'позиций'
  if (mod10 === 1) return 'позиция'
  if (mod10 >= 2 && mod10 <= 4) return 'позиции'
  return 'позиций'
}

/** The user marking and the identifying address are separate, even when initially equal. */
export const labelTextFor = (device: PanelProject['devices'][number], circuitName: string | undefined) => {
  const written = device.marking?.trim() || device.address?.trim() || ''
  return written || (circuitName?.trim() ?? '')
}

export const buildLabelSheet = (project: PanelProject, definitions: Map<string, DeviceDefinition>): LabelSheet => {
  const circuitByDevice = new Map<string, string>()
  for (const circuit of project.circuits ?? []) {
    // A position protected by two circuits keeps the first one in board order. The labels are cut
    // in that same order, and a stable choice is worth more than the more descriptive of the two.
    if (circuit.protectionDeviceId && !circuitByDevice.has(circuit.protectionDeviceId)) {
      circuitByDevice.set(circuit.protectionDeviceId, circuit.loadName || circuit.name)
    }
  }

  const labels: LabelEntry[] = project.devices
    .filter((device) => (device.mount ?? 'din') === 'din')
    .map((device) => {
      const product = definitions.get(device.productId)
      const fullText = labelTextFor(device, circuitByDevice.get(device.instanceId))
      return {
        instanceId: device.instanceId,
        address: device.address.trim(),
        text: fullText,
        fullText,
        position: `${device.row + 1}.${device.slot + 1}`,
        row: device.row,
        slot: device.slot,
        name: product?.name || 'Неизвестное изделие',
        brand: product?.brand || '',
        marked: device.address.trim().length > 0,
        duplicated: false,
      }
    })
    // Board order is the order the sheet is cut in, so the labels come off in reading order.
    .sort((a, b) => a.row - b.row || a.slot - b.slot || a.instanceId.localeCompare(b.instanceId))

  const seen = new Map<string, number>()
  for (const label of labels) if (label.marked) seen.set(label.address, (seen.get(label.address) ?? 0) + 1)
  for (const label of labels) if (label.marked && (seen.get(label.address) ?? 0) > 1) label.duplicated = true

  return {
    labels,
    title: project.name,
    unmarked: labels.filter((label) => !label.marked).length,
    duplicated: labels.filter((label) => label.duplicated).length,
    longLabels: labels.filter((label) => label.fullText.length > LABEL_TEXT_MAX).length,
  }
}

/** What has to be fixed before the sheet is worth printing, in one sentence or in none. */
export const labelSheetWarning = (sheet: LabelSheet) => {
  const parts: string[] = []
  if (sheet.unmarked) parts.push(`${sheet.unmarked} ${positionWord(sheet.unmarked)} без адреса`)
  if (sheet.duplicated) parts.push(`${sheet.duplicated} ${positionWord(sheet.duplicated)} с повторяющимся адресом`)
  const addressWarning = parts.length ? `Лист неполон: ${parts.join(', ')}. Проставьте уникальные адреса на доске перед печатью.` : ''
  const lengthWarning = sheet.longLabels ? 'Длинные подписи перенесены на несколько строк. Проверьте высоту этикеток перед печатью.' : ''
  return [addressWarning, lengthWarning].filter(Boolean).join(' ')
}
