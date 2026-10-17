import { describe, expect, it } from 'vitest'
import { allCatalog } from '../src/data/catalog'
import { buildSingleLine, formatAmperes, isEmptySingleLine, isProtectiveDevice, singleLineExtent } from '../src/domain/singleLine'
import { createDevice, createProject } from '../src/domain/project'
import type { Circuit, PanelProject } from '../src/domain/types'

const definitions = new Map(allCatalog.map((item) => [item.id, item]))
const product = (id: string) => definitions.get(id)!

const circuit = (patch: Partial<Circuit> = {}): Circuit => ({
  id: 'circuit-1', name: 'Цепь 1', loadName: 'Розетка', current: 10, power: 0, phase: 1, phaseCount: 1,
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
    const busbar = { ...createDevice(product('enmas-fork-4p-63a'), 1, 0), address: 'BUS01', marking: 'BUS01' }
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
    expect(model.feeds.filter((feed) => feed.via === 'busbar')).toHaveLength(2)
  })

  it('читает каскад из перемычки между аппаратами', () => {
    // The unified board wires a cascade as a hand jumper into the top clamp; the diagram must
    // read the same record rather than ask for a second description of the same wire.
    const project = board()
    project.circuits = [circuit({ id: 'a', protectionDeviceId: project.devices[1]!.instanceId })]
    project.connections = [{
      id: 'jumper-1', circuitId: '', fromBus: 'L', toDeviceId: project.devices[1]!.instanceId,
      color: '', thickness: 2, label: '', kind: 'jumper',
      fromTerminal: { deviceId: project.devices[0]!.instanceId, pole: 1, side: 'bottom' },
      toTerminal: { deviceId: project.devices[1]!.instanceId, pole: 1, side: 'top' },
    }]
    const model = buildSingleLine(project, definitions)
    expect(model.feeds).toEqual([
      expect.objectContaining({
        from: { label: 'QF01', instanceId: project.devices[0]!.instanceId },
        to: { label: 'QF02', instanceId: project.devices[1]!.instanceId },
        bus: 'L', via: 'cascade',
      }),
    ])
  })

  it('гребёнка ряда перечисляет питаемые аппараты', () => {
    // A comb has no column on the drawing — it feeds whole rows — so the notes name what it feeds.
    // Only the first `poles` covered apparatus count, the same rule the board's teeth follow.
    const project = board()
    project.combs = [{ id: 'comb-1', row: 0, fromSlot: 0, toSlot: 5, poles: 1 }]
    project.circuits = [
      circuit({ id: 'a', protectionDeviceId: project.devices[0]!.instanceId }),
      circuit({ id: 'b', protectionDeviceId: project.devices[1]!.instanceId }),
    ]
    const model = buildSingleLine(project, definitions)
    expect(model.combs).toEqual([expect.objectContaining({ poles: 1, row: 0, fedAddresses: ['QF01'] })])
  })

  it('запитка от сборной шины и от ввода перечисляется отдельно от каскадов', () => {
    // A feed from a bar names the bar; a legacy feed with no bus behind it names the incoming;
    // a run from another apparatus stays a cascade. Collapsing the three into one line would
    // say about the panel something the project does not record.
    const project = board()
    project.circuits = [circuit({ id: 'a', protectionDeviceId: project.devices[0]!.instanceId })]
    project.connections = [
      { id: 'bus-feed', circuitId: '', fromBus: 'N', toDeviceId: project.devices[0]!.instanceId, color: '', thickness: 2, label: '', kind: 'circuit', busId: 'bus-n-bottom' },
      { id: 'legacy-feed', circuitId: '', fromBus: 'L', toDeviceId: project.devices[0]!.instanceId, color: '', thickness: 2, label: '', kind: 'circuit' },
    ]
    const model = buildSingleLine(project, definitions)
    expect(model.feeds.map((feed) => [feed.from.label, feed.via])).toEqual([['шина N', 'bus'], ['ввод L', 'bus']])
  })

  it('выводит ток линии: заявленный как есть, расчётный со знаком приблизительности', () => {
    // A stated current is a fact; one derived from the power is a guess the load maths makes,
    // and the diagram keeps the two inks apart — that is what «предварительно» means here.
    expect(formatAmperes(20)).toBe('20')
    expect(formatAmperes(100 / (Math.sqrt(3) * 400))).toBe('0,1')
    const project = board()
    project.circuits = [
      circuit({ id: 'a', protectionDeviceId: project.devices[0]!.instanceId, current: 16 }),
      circuit({ id: 'b', protectionDeviceId: project.devices[0]!.instanceId, current: 0, power: 4600, phaseCount: 1 }),
      circuit({ id: 'c', protectionDeviceId: project.devices[0]!.instanceId, current: 0, power: 8600, phaseCount: 3 }),
    ]
    const loads = buildSingleLine(project, definitions).groups[0]!.loads
    expect(loads[0]).toMatchObject({ current: 16, declaredCurrent: true })
    expect(loads[1]).toMatchObject({ current: 20, declaredCurrent: false, phaseCount: 1 })
    expect(loads[2]?.declaredCurrent).toBe(false)
    expect(loads[2]?.phaseCount).toBe(3)
    expect(loads[2]?.current).toBeCloseTo(8600 / (Math.sqrt(3) * 400), 5)
  })

  it('трёхфазная линия помечается 3~, неуточнённая фаза не угадывается', () => {
    // «phase: 3» from an old file may mean L3 or three phases; until the person chooses, the
    // diagram writes «фаза не уточнена» instead of printing a phase that may not be there.
    const project = board()
    project.circuits = [
      circuit({ id: 'a', protectionDeviceId: project.devices[0]!.instanceId, phaseCount: 3 }),
      circuit({ id: 'b', protectionDeviceId: project.devices[0]!.instanceId, phase: 2 }),
      circuit({ id: 'c', protectionDeviceId: project.devices[0]!.instanceId, phase: 3, phaseCount: 1, phaseAmbiguous: true }),
    ]
    const loads = buildSingleLine(project, definitions).groups[0]!.loads
    expect(loads.map((load) => [load.phaseCount, load.phase, load.phaseAmbiguous ?? false])).toEqual([
      [3, 1, false], [1, 2, false], [1, 3, true],
    ])
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

  it('распознаёт защитный аппарат по категории каталога', () => {
    expect(isProtectiveDevice(product('ekf-mcb-1p-c6'))).toBe(true)
    expect(isProtectiveDevice(product('enmas-template-shk'))).toBe(false)
    expect(isProtectiveDevice(undefined)).toBe(false)
  })
})
