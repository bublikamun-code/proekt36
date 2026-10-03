import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import { buildSingleLine, isEmptySingleLine, isProtectiveDevice, singleLineExtent } from '../src/domain/singleLine'
import { createDevice, createProject } from '../src/domain/project'
import type { Circuit, PanelProject } from '../src/domain/types'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))
const product = (id: string) => definitions.get(id)!

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1', name: 'Цепь 1', loadName: 'Розетка', current: 10, power: 0, phase: 1,
  protectionDeviceId: '', color: '#c65c3b', wireCrossSection: 1.5, note: '', ...patch,
})

/** Two protective devices in row 0, so board order is unambiguous. */
const board = (overrides: Partial<PanelProject> = {}): PanelProject => {
  const project = createProject('Схема', 'apartment')
  const first = { ...createDevice(product('ekf-mcb-1p-c6'), 0, 0), address: 'QF01', marking: 'QF01' }
  const second = { ...createDevice(product('ekf-mcb-1p-b16'), 0, 2), address: 'QF02', marking: 'QF02' }
  project.devices = [first, second]
  return Object.assign(project, overrides)
}

describe('однолинейная схема', () => {
  it('называет ввод по настройкам панели', () => {
    expect(buildSingleLine(board(), definitions).source).toMatchObject({ label: '1~ 230 В', ratedCurrent: 63, phases: 1 })
    const threePhase = createProject('Три фазы', 'house', { phase: 3, inputCurrent: 100 })
    expect(buildSingleLine(threePhase, definitions).source).toMatchObject({ label: '3~ 400 В', ratedCurrent: 100, phases: 3 })
  })

  it('собирает колонку «защитный аппарат → его цепи»', () => {
    const project = board()
    project.circuits = [
      circuit({ id: 'a', name: 'Розетки', protectionDeviceId: project.devices[0]!.instanceId }),
      circuit({ id: 'b', name: 'Кухня', current: 16, protectionDeviceId: project.devices[1]!.instanceId }),
    ]
    const model = buildSingleLine(project, definitions)
    expect(model.groups).toHaveLength(2)
    expect(model.groups[0]).toMatchObject({ unprotected: false, protection: { label: 'QF01', ratedCurrent: 6 }, loads: [{ label: 'Розетки', current: 10, crossSection: 1.5 }] })
    expect(model.groups[1]?.protection).toMatchObject({ label: 'QF02', ratedCurrent: 16 })
  })

  it('не приписывает цепь первому попавшемуся аппарату, если её защита не найдена', () => {
    // The circuit list is allowed to reference a device that is not on the board; the validation
    // rules report it as an error, and the diagram must not paper over it by picking another
    // device to draw.
    const project = board()
    project.circuits = [circuit({ name: 'Потерянная', protectionDeviceId: 'нет-такого' })]
    const model = buildSingleLine(project, definitions)
    expect(model.groups).toHaveLength(1)
    expect(model.groups[0]).toMatchObject({ unprotected: true, protection: undefined })
    expect(model.groups[0]?.loads.map((load) => load.label)).toEqual(['Потерянная'])
  })

  it('показывает аппарат, до которого не доведена ни одна цепь', () => {
    // Placed on the board and absent from the circuit list: on a single-line diagram that is
    // indistinguishable from a wired one, so it is named instead of dropped.
    const project = board()
    project.circuits = [circuit({ protectionDeviceId: project.devices[0]!.instanceId })]
    const model = buildSingleLine(project, definitions)
    expect(model.unmodelled.map((device) => device.address)).toEqual(['QF02'])
  })

  it('учитывает шину, питающую аппарат, и рисует её один раз', () => {
    const project = board()
    const busbar = { ...createDevice(product('enmas-fork-4p-63a'), 1, 0), address: 'BUS01', marking: 'BUS01', mount: 'busbar' as const }
    project.devices = [...project.devices, busbar]
    project.circuits = [
      circuit({ id: 'a', protectionDeviceId: project.devices[0]!.instanceId }),
      circuit({ id: 'b', protectionDeviceId: project.devices[1]!.instanceId }),
    ]
    project.connections = project.devices
      .filter((device) => device.mount === 'din')
      .map((device) => ({ id: `link-${device.instanceId}`, circuitId: '', fromBus: 'L' as const, toDeviceId: device.instanceId, color: '#aeb8b4', thickness: 2, label: 'FORK', kind: 'busbar' as const, fromDeviceId: busbar.instanceId }))

    const model = buildSingleLine(project, definitions)
    expect(model.busbars).toHaveLength(1)
    expect(model.busbars[0]).toMatchObject({ label: 'BUS01', bus: 'L', ratedCurrent: 63 })
  })

  it('пустая панель честно остаётся пустой', () => {
    const model = buildSingleLine(createProject('Пусто'), definitions)
    expect(isEmptySingleLine(model)).toBe(true)
    expect(singleLineExtent(model)).toEqual({ columns: 1, rows: 1 })
  })

  it('размер холста растёт от числа цепей, а не от числа устройств', () => {
    const project = board()
    project.circuits = [
      circuit({ id: 'a', protectionDeviceId: project.devices[0]!.instanceId }),
      circuit({ id: 'b', protectionDeviceId: project.devices[0]!.instanceId }),
      circuit({ id: 'c', protectionDeviceId: project.devices[0]!.instanceId }),
    ]
    expect(singleLineExtent(buildSingleLine(project, definitions))).toEqual({ columns: 1, rows: 3 })
  })

  it('различает защитные аппараты и прочее', () => {
    expect(isProtectiveDevice(product('ekf-mcb-1p-c6'))).toBe(true)
    expect(isProtectiveDevice(product('ekf-rcbo-1p-c16'))).toBe(true)
    expect(isProtectiveDevice(product('ekf-terminal-1p-gray'))).toBe(false)
    expect(isProtectiveDevice(undefined)).toBe(false)
  })
})
