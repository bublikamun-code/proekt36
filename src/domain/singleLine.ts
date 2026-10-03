import { SINGLE_PHASE_VOLTAGE_V, THREE_PHASE_VOLTAGE_V } from './electrical'
import { isDinDevice } from './layout'
import type { BusType, Circuit, DeviceDefinition, PanelProject, PlacedDevice } from './types'

/**
 * The single-line diagram, as data.
 *
 * The print report could show the board, the marking, the connections and the bill of materials,
 * but nothing that says what is fed from what: a reader had to reconstruct the supply path from
 * the connection list by hand. This builds that path once, here, where it can be tested without a
 * DOM, and the component below only turns the result into lines.
 *
 * What it is: a preliminary single-line diagram derived from the circuits and the devices that
 * protect them. What it is not: a schematic. Two gaps are reported instead of being drawn over,
 * because a diagram that invents a connection is worse than one that admits the gap:
 *
 * - a device on the board that no circuit reaches is listed in `unmodelled`;
 * - a circuit whose protective device is missing or not on the board gets a group of its own,
 *   marked `unprotected`, rather than being attached to whichever device happens to be first.
 */

export type SingleLineKind = 'incoming' | 'protection' | 'load'

export interface SingleLineNode {
  kind: SingleLineKind
  /** Designator shown on the drawing. */
  label: string
  name?: string
  instanceId?: string
  ratedCurrent?: number
  poles?: number
}

export interface SingleLineLoad extends SingleLineNode {
  kind: 'load'
  circuitId: string
  phase: 1 | 2 | 3
  current: number
  power: number
  crossSection: number
}

export interface SingleLineGroup {
  /** The device feeding this column, absent when the circuit has no usable protection. */
  protection?: SingleLineNode
  /** True when the group exists only because its protective device could not be found. */
  unprotected: boolean
  loads: SingleLineLoad[]
}

export interface SingleLineBus {
  label: string
  name?: string
  instanceId: string
  bus: BusType
  ratedCurrent?: number
}

export interface SingleLineModel {
  source: { label: string; phases: 1 | 3; ratedCurrent: number; voltage: number }
  /** Fork busbars the project declares, feeding one or more protective devices. */
  busbars: SingleLineBus[]
  groups: SingleLineGroup[]
  /** Devices on the board that no circuit reaches, named so the gap stays visible. */
  unmodelled: { address: string; name: string; instanceId: string }[]
}

const PROTECTION_CATEGORIES = new Set(['MCB', 'RCCB', 'RCBO'])

/** Board order: row first, then position along the rail, so the diagram follows the layout. */
const byBoardOrder = (left: PlacedDevice, right: PlacedDevice) =>
  left.row - right.row || left.slot - right.slot || left.instanceId.localeCompare(right.instanceId)

export const isProtectiveDevice = (product: DeviceDefinition | undefined) =>
  Boolean(product && PROTECTION_CATEGORIES.has(product.category))

const loadOf = (circuit: Circuit): SingleLineLoad => ({
  kind: 'load',
  label: circuit.name,
  name: circuit.loadName || circuit.name,
  instanceId: circuit.id,
  circuitId: circuit.id,
  phase: circuit.phase,
  current: circuit.current,
  power: circuit.power,
  crossSection: circuit.wireCrossSection,
  ratedCurrent: circuit.current || undefined,
  poles: circuit.phase,
})

export const buildSingleLine = (
  project: PanelProject,
  definitions: Map<string, DeviceDefinition>,
): SingleLineModel => {
  const productOf = (productId: string) => definitions.get(productId)
  const devices = [...project.devices].sort(byBoardOrder)
  const circuits = project.circuits ?? []
  const byId = new Map(devices.map((device) => [device.instanceId, device]))

  // A device fed by a declared fork is drawn with that bus upstream of it, which is the only place
  // the project records that a busbar supplies it.
  const forkFor = (instanceId: string) => {
    const link = (project.connections ?? []).find((connection) => connection.kind === 'busbar' && connection.toDeviceId === instanceId)
    const source = link?.fromDeviceId ? byId.get(link.fromDeviceId) : undefined
    if (!source) return null
    const product = productOf(source.productId)
    return { label: source.marking || source.address || '—', name: product?.name, instanceId: source.instanceId, bus: (link?.fromBus ?? 'L') as BusType, ratedCurrent: product?.ratedCurrent }
  }

  const busbars = new Map<string, SingleLineBus>()
  const groups: SingleLineGroup[] = []
  const byProtection = new Map<string, SingleLineGroup>()
  const modelled = new Set<string>()

  for (const circuit of circuits) {
    const device = circuit.protectionDeviceId ? byId.get(circuit.protectionDeviceId) : undefined
    const product = device ? productOf(device.productId) : undefined
    const usable = Boolean(device && product && isProtectiveDevice(product))
    let group = usable ? byProtection.get(device!.instanceId) : undefined
    if (!group) {
      const fork = usable ? forkFor(device!.instanceId) : null
      if (fork) busbars.set(fork.instanceId, fork)
      group = {
        protection: usable
          ? { kind: 'protection', label: device!.marking || device!.address || '—', name: product!.name, instanceId: device!.instanceId, ratedCurrent: product!.ratedCurrent, poles: product!.poles }
          : undefined,
        unprotected: !usable,
        loads: [],
      }
      if (usable) {
        byProtection.set(device!.instanceId, group)
        modelled.add(device!.instanceId)
      }
      groups.push(group)
    }
    group.loads.push(loadOf(circuit))
  }

  // A device nobody wired: it is placed on the board and absent from the circuit list, and on a
  // single-line diagram that is indistinguishable from a wired one.
  const unmodelled = devices
    .filter((device) => isDinDevice(device) && !modelled.has(device.instanceId))
    .map((device) => ({
      address: device.marking || device.address || '—',
      name: productOf(device.productId)?.name || 'Неизвестное изделие',
      instanceId: device.instanceId,
    }))

  return {
    source: {
      label: project.settings.phase === 1 ? `1~ ${SINGLE_PHASE_VOLTAGE_V} В` : `3~ ${THREE_PHASE_VOLTAGE_V} В`,
      phases: project.settings.phase,
      ratedCurrent: project.settings.inputCurrent,
      voltage: project.settings.phase === 1 ? SINGLE_PHASE_VOLTAGE_V : THREE_PHASE_VOLTAGE_V,
    },
    busbars: [...busbars.values()],
    groups,
    unmodelled,
  }
}

/** A panel with nothing to draw still has to say so rather than render an empty frame. */
export const isEmptySingleLine = (model: SingleLineModel) => !model.groups.length

/** Every group at least one column, and the row count the drawing has to fit. */
export const singleLineExtent = (model: SingleLineModel) => ({
  columns: Math.max(1, model.groups.length),
  rows: Math.max(1, ...model.groups.map((group) => group.loads.length)),
})
