import { circuitCurrentA, SINGLE_PHASE_VOLTAGE, THREE_PHASE_VOLTAGE } from './electrical'
import { isDinDevice } from './layout'
import type { BusType, Circuit, DeviceDefinition, PanelProject, PlacedDevice } from './types'

/**
 * The single-line diagram, as data.
 *
 * The print report shows the board, the marking, the connections and the bill of materials, but
 * nothing that says what is fed from what: a reader had to reconstruct the supply path from the
 * connection list by hand. This builds that path once, here, where it can be tested without a
 * DOM, and the component only turns the result into lines.
 *
 * What it is: a preliminary single-line diagram derived from the circuits and the devices that
 * protect them. What it is not: a schematic. Gaps are reported instead of being drawn over,
 * because a diagram that invents a connection is worse than one that admits the gap:
 *
 * - a device on the board that no circuit reaches is listed in `unmodelled`;
 * - a circuit whose protective device is missing or not on the board gets a group of its own,
 *   marked `unprotected`, rather than being attached to whichever device happens to be first.
 *
 * The supply path is read out of the unified wiring model, where a protection is fed three ways:
 * a comb over its row (`combs`), a conductor from a visible bar or from the incoming (`bus`), or
 * a hand jumper from another apparatus (`cascade`, `busbar`). Everything the board draws as a feed
 * this model names; the two come from the same records and cannot tell different stories.
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

export interface SingleLineLoad {
  kind: 'load'
  label: string
  name: string
  circuitId: string
  /** How many phases the load itself needs; a three-phase line is marked 3~ on the drawing. */
  phaseCount: 1 | 3
  /** Assigned phase L1/L2/L3, meaningful only for a single-phase load. */
  phase: 1 | 2 | 3
  /**
   * Set by the v5 migration on pre-v5 records with `phase: 3`: the data cannot tell «L3» from
   * «three phases», and the diagram refuses to guess — it writes «фаза не уточнена» instead.
   */
  phaseAmbiguous?: boolean
  /** Amperes: the stated current when the line has one, otherwise derived from the power. */
  current: number
  /** False when `current` was derived and is therefore preliminary twice over. */
  declaredCurrent: boolean
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

/** How a protective device is fed, in the words the notes use. */
export type SingleLineFeedVia = 'cascade' | 'busbar' | 'bus'

export interface SingleLineFeed {
  /** The device the wire leaves from, or the named bar / the incoming. */
  from: { label: string; instanceId: string }
  /** The device the wire arrives at. */
  to: { label: string; instanceId: string }
  bus: BusType
  /**
   * `cascade` — from another apparatus through a hand jumper.
   * `busbar`  — from a declared fork.
   * `bus`     — from a visible bar, or from the incoming when no bar stands behind it.
   */
  via: SingleLineFeedVia
}

export interface SingleLineBus {
  label: string
  name?: string
  instanceId: string
  bus: BusType
  ratedCurrent?: number
}

/** A comb over a row, with the apparatus on it the comb actually feeds. */
export interface SingleLineComb {
  label: string
  poles: 1 | 2 | 3 | 4
  row: number
  /** Designators of the fed apparatus, in rail order. */
  fedAddresses: string[]
}

export interface SingleLineModel {
  source: { label: string; phases: 1 | 3; ratedCurrent: number; voltage: number }
  /** Fork busbars the project declares, feeding one or more protective devices. */
  busbars: SingleLineBus[]
  /** Combs over rows, listed because a comb has no column on the drawing: it feeds whole rows. */
  combs: SingleLineComb[]
  /** Runs between two apparatuses, or from a bar — everything the drawing itself cannot show. */
  feeds: SingleLineFeed[]
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

const designator = (device: PlacedDevice) => device.marking || device.address || '—'

/** One decimal at most, with the decimal comma the worksheets use. */
export const formatAmperes = (value: number): string => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
}

const loadOf = (circuit: Circuit): SingleLineLoad => ({
  kind: 'load',
  label: circuit.name,
  name: circuit.loadName || circuit.name,
  circuitId: circuit.id,
  phaseCount: circuit.phaseCount === 3 ? 3 : 1,
  phase: circuit.phase,
  phaseAmbiguous: circuit.phaseAmbiguous,
  current: circuitCurrentA(circuit),
  // A stated current wins in `circuitCurrentA`; deriving means nobody measured anything, so the
  // diagram says so instead of printing a computed number in the same ink as a measured one.
  declaredCurrent: circuit.current > 0,
  power: circuit.power,
  crossSection: circuit.wireCrossSection,
})

export const buildSingleLine = (
  project: PanelProject,
  definitions: Map<string, DeviceDefinition>,
): SingleLineModel => {
  const productOf = (productId: string) => definitions.get(productId)
  const devices = [...project.devices].sort(byBoardOrder)
  const circuits = project.circuits ?? []
  const byId = new Map(devices.map((device) => [device.instanceId, device]))
  const isBusbarDevice = (instanceId: string | undefined) => {
    if (!instanceId) return false
    const device = byId.get(instanceId)
    return device ? device.mount === 'busbar' || productOf(device.productId)?.category === 'busbar' : false
  }

  /**
   * A device fed by a declared fork is drawn with that bus upstream of it, which is the only place
   * the project records that a busbar supplies it.
   */
  const forkFor = (instanceId: string) => {
    const link = (project.connections ?? []).find((connection) => connection.kind === 'busbar' && connection.toDeviceId === instanceId)
    const source = link?.fromDeviceId ? byId.get(link.fromDeviceId) : undefined
    if (!source || !isBusbarDevice(source.instanceId)) return null
    const product = productOf(source.productId)
    return { label: designator(source), name: product?.name, instanceId: source.instanceId, bus: (link?.fromBus ?? 'L') as BusType, ratedCurrent: product?.ratedCurrent }
  }

  const feeds: SingleLineFeed[] = []
  const pushFeed = (from: { label: string; instanceId: string }, to: PlacedDevice, bus: BusType, via: SingleLineFeedVia) => {
    const target = { label: designator(to), instanceId: to.instanceId }
    if (feeds.some((feed) => feed.from.instanceId === from.instanceId && feed.to.instanceId === target.instanceId && feed.bus === bus)) return
    feeds.push({ from, to: target, bus, via })
  }

  for (const connection of project.connections ?? []) {
    const to = byId.get(connection.toDeviceId)
    if (!to) continue
    if (connection.kind === 'busbar' && connection.fromDeviceId) {
      const from = byId.get(connection.fromDeviceId)
      if (!from || !isBusbarDevice(from.instanceId)) continue
      pushFeed({ label: designator(from), instanceId: from.instanceId }, to, connection.fromBus, 'busbar')
      continue
    }
    if (connection.kind === 'jumper') {
      const enters = connection.toTerminal?.deviceId === to.instanceId
      if (!enters) continue
      const sourceId = connection.fromTerminal?.deviceId ?? connection.fromDeviceId
      const from = sourceId ? byId.get(sourceId) : undefined
      if (!from || from.instanceId === to.instanceId) continue
      // A jumper off a fork is a fork feed wearing a wire's clothes; the notes say which fork.
      if (isBusbarDevice(from.instanceId)) {
        pushFeed({ label: designator(from), instanceId: from.instanceId }, to, connection.fromBus, 'busbar')
      } else {
        pushFeed({ label: designator(from), instanceId: from.instanceId }, to, connection.fromBus, 'cascade')
      }
      continue
    }
    // A feed from a bar or from the incoming names no source device, because neither is an
    // apparatus: there is no column to draw it in, so it is listed — that is where a reader
    // looks for how an apparatus is fed.
    if (connection.kind === 'circuit' && !connection.fromDeviceId) {
      const bar = connection.busId ? (project.busAssemblies ?? []).find((bus) => bus.id === connection.busId) : undefined
      const from = bar
        ? { label: `шина ${bar.label || bar.kind}`, instanceId: `bus:${bar.id}` }
        : { label: `ввод ${connection.fromBus}`, instanceId: `incoming:${connection.fromBus}` }
      pushFeed(from, to, connection.fromBus, 'bus')
    }
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
          ? { kind: 'protection', label: designator(device!), name: product!.name, instanceId: device!.instanceId, ratedCurrent: product!.ratedCurrent, poles: product!.poles }
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

  /**
   * A comb over a row of protections is a supply path the drawing cannot show, so each comb that
   * actually feeds a protective device is named together with the apparatus it feeds.
   */
  const combs: SingleLineComb[] = []
  for (const comb of project.combs ?? []) {
    const covered = project.devices
      .filter((device) => device.row === comb.row
        && device.slot >= Math.min(comb.fromSlot, comb.toSlot)
        && device.slot <= Math.max(comb.fromSlot, comb.toSlot))
      .sort(byBoardOrder)
    const fed = covered.slice(0, comb.poles).filter((device) => modelled.has(device.instanceId))
    if (!fed.length) continue
    combs.push({
      label: comb.label || `Гребёнка ${comb.poles}P`,
      poles: comb.poles,
      row: comb.row,
      fedAddresses: fed.map(designator),
    })
  }

  // A device nobody wired: it is placed on the board and absent from the circuit list, and on a
  // single-line diagram that is indistinguishable from a wired one.
  const unmodelled = devices
    .filter((device) => isDinDevice(device) && !modelled.has(device.instanceId))
    .map((device) => ({
      address: designator(device),
      name: productOf(device.productId)?.name || 'Неизвестное изделие',
      instanceId: device.instanceId,
    }))

  return {
    source: {
      label: project.settings.phase === 1 ? `1~ ${SINGLE_PHASE_VOLTAGE} В` : `3~ ${THREE_PHASE_VOLTAGE} В`,
      phases: project.settings.phase,
      ratedCurrent: project.settings.inputCurrent,
      voltage: project.settings.phase === 1 ? SINGLE_PHASE_VOLTAGE : THREE_PHASE_VOLTAGE,
    },
    busbars: [...busbars.values()],
    combs,
    feeds,
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
