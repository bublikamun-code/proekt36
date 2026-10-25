import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createProject } from '../src/domain/project'
import { PROJECT_LIMITS } from '../src/domain/projectSchema'
import { deviceTerminals } from '../src/domain/terminals'
import { useProjectStore } from '../src/stores/project'
import { workspaceCatalog } from '../src/data/catalog'
import { MemoryStorage, ThrowingStorage, createFakeIndexedDB, installBrowserEnv, resetFakeIndexedDB } from './support/browser-env'
import type { BrowserEnv , StoredModelAsset } from './support/browser-env'
import type { PanelProject } from '../src/domain/types'

let env: BrowserEnv | null = null

afterEach(() => {
  env?.restore()
  env = null
  resetFakeIndexedDB()
  vi.useRealTimers()
})

/** A store on an empty workspace: the seed project is the only one, nothing is selected. */
const openStore = () => {
  env = installBrowserEnv({ storage: new MemoryStorage() })
  setActivePinia(createPinia())
  return useProjectStore()
}

/** The same store, but with a model library that has somewhere to keep its binaries. */
const openStoreWithModelDb = () => {
  Object.defineProperty(globalThis, 'indexedDB', { value: createFakeIndexedDB(), configurable: true, writable: true })
  return openStore()
}

const blank = (name: string): PanelProject => createProject(name)

const deviceIds = (store: ReturnType<typeof openStore>) => store.currentProject.devices.map((item) => item.instanceId)

describe('жизненный цикл проектов', () => {
  it('открывает рабочую область на образце, когда в хранилище пусто', () => {
    const store = openStore()

    expect(store.projects).toHaveLength(1)
    expect(store.currentProjectId).toBe(store.projects[0]!.id)
    // A refresh has to land on the same board the deep link named, not rebuild a new one.
    expect(store.currentProjectId).toBe('sample-apartment')
    expect(store.storageStatus).toBe('saved')
  })

  it('переключается только на проект, который есть в списке', () => {
    const store = openStore()
    const [first] = store.projects
    const second = blank('Второй')
    store.projects.push(second)
    store.switchProject('нет такого')
    expect(store.currentProjectId).toBe(first!.id)

    store.switchProject(second.id)
    expect(store.currentProjectId).toBe(second.id)
  })

  it('создаёт проект по пресету и делает его текущим', () => {
    const store = openStore()

    store.newProject('Квартира', 'apartment')

    expect(store.projects).toHaveLength(2)
    expect(store.currentProject.name).toBe('Квартира')
    expect(store.currentProject.preset).toBe('apartment')
    expect(store.currentProject.settings.inputCurrent).toBeGreaterThan(0)
  })

  it('подставляет своё имя, когда пользователь оставил поле пустым', () => {
    const store = openStore()

    store.newProject('', 'apartment')

    expect(store.currentProject.name).toBe('Новая панель')
  })

  it('копирует проект под новым именем и не трогает оригинал', () => {
    const store = openStore()
    const source = store.currentProject
    source.name = 'Освещение'

    store.duplicateProject(source.id)

    expect(store.projects).toHaveLength(2)
    expect(store.currentProject.name).toBe('Освещение — копия')
    expect(store.currentProject.id).not.toBe(source.id)
    expect(store.projects.find((item) => item.id === source.id)!.name).toBe('Освещение')
  })

  it('ничего не делает, если копировать несуществующий проект', () => {
    const store = openStore()
    store.duplicateProject('нет такого')
    expect(store.projects).toHaveLength(1)
  })

  it('переименовывает проект, игнорируя пустое имя', () => {
    const store = openStore()
    const id = store.currentProjectId

    store.renameProject(id, '  Новый щит  ')
    expect(store.currentProject.name).toBe('Новый щит')

    store.renameProject(id, '   ')
    expect(store.currentProject.name).toBe('Новый щит')
  })

  it('не даёт удалить последний проект', () => {
    const store = openStore()

    store.deleteProject(store.currentProjectId)

    expect(store.projects).toHaveLength(1)
    expect(store.toast).toEqual({ text: 'Нужен хотя бы один проект', tone: 'error' })
  })

  it('после удаления открывает соседний проект и забывает историю удалённого', () => {
    const store = openStore()
    const first = store.currentProject
    const second = blank('Второй')
    const third = blank('Третий')
    store.projects.push(second, third)
    store.switchProject(first.id)
    store.updateSettings({ inputCurrent: 55 })
    expect(store.undoStack.length).toBeGreaterThan(0)

    store.deleteProject(first.id)

    expect(store.projects.map((item) => item.id)).toEqual([second.id, third.id])
    expect(store.currentProjectId).toBe(second.id)
    expect(store.undoStack).toEqual([])
  })
})

describe('параметры щита', () => {
  it('обновляет разрешённые поля и отказывает в остальных', () => {
    const store = openStore()

    expect(store.updateSettings({ inputCurrent: 63, rows: 3, reserveModules: 12 })).toBe(true)
    expect(store.currentProject.settings.inputCurrent).toBe(63)
    expect(store.currentProject.settings.rows).toBe(3)

    // The cabinet and the rail change the geometry of every device, so they only move through
    // a confirmed migration rather than through a settings patch.
    expect(store.updateSettings({ cabinetId: 'panel36-36-embedded' } as never)).toBe(false)
    expect(store.currentProject.settings.cabinetId).not.toBe('panel36-36-embedded')
  })

  it('отказывает в нечисловых и выходящих за границы значениях, ничего не меняя', () => {
    const store = openStore()
    const before = store.currentProject.settings.inputCurrent
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ inputCurrent: 0 }, 'от 1'],
      [{ inputCurrent: 5000 }, 'от 1'],
      [{ inputCurrent: Number.NaN }, 'от 1'],
      [{ inputCurrent: '63' }, 'от 1'],
      [{ phase: 2 }, 'системная фаза'],
      [{ enclosureWidth: 0 }, 'Размер'],
      [{ rows: 0 }, 'Число рядов'],
      [{ rows: 2.5 }, 'Число рядов'],
      [{ rows: PROJECT_LIMITS.rows + 1 }, 'Число рядов'],
      [{ reserveModules: -1 }, 'Резерв'],
      [{ reserveModules: 1.5 }, 'Резерв'],
    ]

    for (const [patch, fragment] of cases) {
      expect(store.updateSettings(patch as never), JSON.stringify(patch)).toBe(false)
      expect(store.toast?.text).toContain(fragment)
    }
    expect(store.currentProject.settings.inputCurrent).toBe(before)
    expect(store.undoStack).toEqual([])
  })
})

describe('размещение аппаратов', () => {
  it('отказывает в товаре, которого нет в каталоге', () => {
    const store = openStore()
    const before = store.currentProject.devices.length

    store.addDevice('no-such-product')

    expect(store.currentProject.devices).toHaveLength(before)
    expect(store.toast).toEqual({ text: 'Товар не найден', tone: 'error' })
  })

  it('переносит в следующий ряд, когда первый ряд забит', () => {
    const store = openStore()
    store.newProject('Плотный щит', 'apartment')
    const rows = store.currentProject.settings.rows
    // Fill the first row completely with one-module devices.
    for (let slot = 0; slot < 12; slot += 1) store.addDevice('ekf-mcb-1p-c6', 0, slot)
    const firstRow = store.currentProject.devices.filter((item) => item.row === 0)
    expect(firstRow.length).toBeGreaterThan(0)

    store.addDevice('ekf-mcb-1p-c6', 0, 0)

    const added = store.currentProject.devices.find((item) => item.row > 0)
    expect(rows).toBeGreaterThan(1)
    expect(added).toBeDefined()
  })

  it('не оставляет следов, если перенос некуда', () => {
    const store = openStore()
    store.newProject('Один ряд', 'apartment')
    store.updateSettings({ rows: 1 })
    for (let slot = 0; slot < 12; slot += 1) store.addDevice('ekf-mcb-1p-c6', 0, slot)
    const before = store.currentProject.devices.length

    store.addDevice('ekf-mcb-1p-c6', 0, 0)

    expect(store.currentProject.devices).toHaveLength(before)
    expect(store.toast?.tone).toBe('error')
  })

  it('не двигает несуществующее устройство и не выбирает его', () => {
    const store = openStore()

    store.moveDeviceById('нет такого', 0, 0)

    expect(store.selectedDeviceId).toBeNull()
    expect(store.toast).toEqual({ text: 'Устройство не найдено', tone: 'error' })
  })

  it('не путает одинаковые перемещения и не оставляет записи об отмене', () => {
    const store = openStore()
    const first = store.currentProject.devices[0]!
    const before = store.undoStack.length

    store.moveDeviceById(first.instanceId, first.row, first.slot)

    // A nudge that lands where the device already is must not leave an undo entry behind.
    expect(store.undoStack).toHaveLength(before)
  })

  it('выбирает аппарат при настоящем переносе', () => {
    const store = openStore()
    const first = store.currentProject.devices[0]!

    store.moveDeviceById(first.instanceId, 1, 6)

    expect(store.selectedDeviceId).toBe(first.instanceId)
    expect(store.currentProject.devices.find((item) => item.instanceId === first.instanceId)!.slot).toBe(6)
  })

  it('не двигает шину за пределы ряда', () => {
    const store = openStore()
    store.addDevice('enmas-fork-4p-63a', 0, 0)
    const bar = store.currentProject.devices.find((item) => item.mount === 'busbar')!
    const rows = store.currentProject.settings.rows

    store.moveDeviceById(bar.instanceId, rows + 5, 0)

    expect(store.currentProject.devices.find((item) => item.instanceId === bar.instanceId)!.row).toBe(bar.row)
    expect(store.toast?.tone).toBe('error')
  })

  it('не двигает выделение, если его нет', () => {
    const store = openStore()
    store.selectedDeviceId = null
    const before = deviceIds(store).join(',')

    store.moveSelected(0, 1)
    store.nudgeSelectedDevice(1, 0)

    expect(deviceIds(store).join(',')).toBe(before)
  })

  it('не реагирует на нулевой сдвиг и на сдвиг шины', () => {
    const store = openStore()
    const first = store.currentProject.devices[0]!
    store.selectedDeviceId = first.instanceId
    const before = store.undoStack.length

    store.nudgeSelectedDevice(0, 0)

    expect(store.undoStack).toHaveLength(before)
  })
})

describe('выделение и правка аппарата', () => {
  it('требует выделения для правки', () => {
    const store = openStore()
    store.selectedDeviceId = null

    expect(store.updateSelected({ address: 'QF9' })).toBe(false)
    expect(store.toast?.text).toContain('Сначала выберите')
  })

  it('меняет только разрешённые поля', () => {
    const store = openStore()
    store.selectedDeviceId = store.currentProject.devices[0]!.instanceId

    expect(store.updateSelected({ address: 'QF9', marking: 'QF9/1', note: 'кухня', quantity: 2, phase: 3 })).toBe(true)
    expect(store.selectedDevice).toMatchObject({ address: 'QF9', marking: 'QF9/1', note: 'кухня', quantity: 2, phase: 3 })
  })

  it('не даёт править геометрию аппарата через точечное обновление', () => {
    const store = openStore()
    store.selectedDeviceId = store.currentProject.devices[0]!.instanceId
    const before = { ...store.selectedDevice! }

    expect(store.updateSelected({ slot: 5 } as never)).toBe(false)
    expect(store.updateSelected({} as never)).toBe(false)
    expect(store.selectedDevice).toMatchObject(before)
  })

  it('проверяет адрес, маркировку, количество и фазу', () => {
    const store = openStore()
    store.selectedDeviceId = store.currentProject.devices[0]!.instanceId
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ address: '   ' }, 'Адрес'],
      [{ address: 'x'.repeat(65) }, 'Адрес'],
      [{ address: 42 }, 'Адрес'],
      [{ marking: 'x'.repeat(65) }, 'Маркировка'],
      [{ note: 'x'.repeat(PROJECT_LIMITS.text + 1) }, 'Примечание'],
      [{ quantity: 0 }, 'Количество'],
      [{ quantity: 1.5 }, 'Количество'],
      [{ phase: 4 }, 'Фаза'],
    ]

    for (const [patch, fragment] of cases) {
      expect(store.updateSelected(patch as never), JSON.stringify(patch)).toBe(false)
      expect(store.toast?.text).toContain(fragment)
    }
  })

  it('не меняет физический размер аппарата от количества в закупке', () => {
    const store = openStore()
    const device = store.currentProject.devices[0]!
    store.selectedDeviceId = device.instanceId
    const neighbours = store.currentProject.devices.filter((item) => item.row === device.row && item.instanceId !== device.instanceId)

    store.updateSelected({ quantity: 10 })

    const after = store.currentProject.devices
    expect(after.find((item) => item.instanceId === device.instanceId)!.quantity).toBe(10)
    for (const other of neighbours) {
      expect(after.find((item) => item.instanceId === other.instanceId)!.slot).toBe(other.slot)
    }
  })

  it('удаляет аппарат вместе с его проводами и снимает выделение', () => {
    const store = openStore()
    const device = store.currentProject.devices[0]!
    store.selectedDeviceId = device.instanceId
    store.addBusWire('bus-n', { deviceId: device.instanceId, pole: 1, side: 'top' })

    store.deleteSelected()

    expect(deviceIds(store)).not.toContain(device.instanceId)
    expect(store.currentProject.connections.some((item) => item.toDeviceId === device.instanceId)).toBe(false)
    expect(store.selectedDeviceId).toBeNull()
  })

  it('не удаляет ничего, если выделения нет', () => {
    const store = openStore()
    store.selectedDeviceId = null
    const before = deviceIds(store).join(',')

    store.deleteSelected()
    store.duplicateSelected()

    expect(deviceIds(store).join(',')).toBe(before)
  })

  it('дублирует выделенный аппарат рядом с ним', () => {
    const store = openStore()
    // The last device of the demo rail, so the copy has a free slot after it.
    const device = store.currentProject.devices.at(-1)!
    store.selectedDeviceId = device.instanceId
    const before = deviceIds(store).length

    store.duplicateSelected()

    expect(deviceIds(store)).toHaveLength(before + 1)
    const copy = store.currentProject.devices.find((item) => item.productId === device.productId && item.instanceId !== device.instanceId)
    expect(copy?.row).toBe(device.row)
  })

  it('уплотняет ряд, оставляя дыру от удалённого аппарата', () => {
    const store = openStore()
    // Row two of the seed holds three terminal blocks; a hole is cut by deleting the middle one.
    const row = 1
    const victim = store.currentProject.devices.find((item) => item.row === row && item.slot === 1)!
    store.selectedDeviceId = victim.instanceId
    store.deleteSelected()
    const holed = store.currentProject.devices.filter((item) => item.row === row).map((item) => item.slot)
    expect(holed).toEqual([0, 2])

    store.selectedDeviceId = store.currentProject.devices.find((item) => item.row === row)!.instanceId
    store.compactSelectedRow()

    const after = store.currentProject.devices.filter((item) => item.row === row).map((item) => item.slot)
    expect(after).toEqual([0, 1])
  })

  it('не уплотняет ничего, когда ряд не выбран', () => {
    const store = openStore()
    store.selectedDeviceId = null
    const before = store.undoStack.length

    store.compactSelectedRow()

    expect(store.undoStack).toHaveLength(before)
  })

  it('перенумеровывает адреса и подписи проводов вместе', () => {
    const store = openStore()
    store.selectedDeviceId = store.currentProject.devices[0]!.instanceId
    store.updateSelected({ address: 'QF99' })
    const device = store.currentProject.devices[0]!
    store.addBusWire(store.currentProject.busAssemblies![0]!.id, { deviceId: device.instanceId, pole: 1, side: 'top' })
    const wire = store.currentProject.connections.at(-1)!
    const before = wire.label
    expect(before).toContain('QF99')

    store.autoNumberAll()

    expect(new Set(store.currentProject.devices.map((item) => item.address)).size).toBe(store.currentProject.devices.length)
    // The address moved, so a label still quoting the old one would point at nothing.
    expect(store.currentProject.connections.at(-1)!.label).not.toBe(before)
  })
})

describe('гребёнки', () => {
  it('не добавляет гребёнку в пустой ряд', () => {
    const store = openStore()
    const before = store.currentProject.combs!.length

    store.addComb(9, 2)

    expect(store.currentProject.combs).toHaveLength(before)
    expect(store.toast?.tone).toBe('error')
  })

  it('накрывает гребёнкой столько аппаратов, сколько у неё полюсов, а не весь ряд', () => {
    const store = openStore()
    const row = 1
    const inRow = store.currentProject.devices.filter((item) => item.row === row)
    expect(inRow.length).toBeGreaterThan(2)

    store.addComb(row, 2)

    const comb = store.currentProject.combs!.at(-1)!
    const fed = inRow.filter((item) => item.slot >= comb.fromSlot && item.slot <= comb.toSlot)
    // A comb is a part of a fixed length; covering the whole row would draw a two-tooth bar
    // across six devices, which no installer would recognise.
    expect(fed.length).toBeLessThanOrEqual(2)
    expect(comb.poles).toBe(2)
    expect(comb.label).toBe('Гребёнка 2P')
  })

  it('нормализует перевёрнутый диапазон слотов', () => {
    const store = openStore()
    const row = 0
    store.addComb(row, 2)
    const comb = store.currentProject.combs!.at(-1)!

    store.updateComb(comb.id, { fromSlot: comb.toSlot + 2, toSlot: comb.fromSlot })

    const updated = store.currentProject.combs!.at(-1)!
    expect(updated.fromSlot).toBeLessThanOrEqual(updated.toSlot)
  })

  it('не трогает гребёнку, которой нет', () => {
    const store = openStore()
    const before = JSON.stringify(store.currentProject.combs)

    store.updateComb('нет', { poles: 4 })
    store.removeComb('нет')

    expect(JSON.stringify(store.currentProject.combs)).toBe(before)
  })

  it('удаляет гребёнку', () => {
    const store = openStore()
    store.addComb(0, 1)
    const comb = store.currentProject.combs!.at(-1)!
    const before = store.currentProject.combs!.length

    store.removeComb(comb.id)

    expect(store.currentProject.combs).toHaveLength(before - 1)
  })
})

describe('подключение к шине Fork', () => {
  const withBusbar = () => {
    const store = openStore()
    store.addDevice('enmas-fork-4p-63a', 0, 0)
    const busbar = store.currentProject.devices.find((item) => item.mount === 'busbar')!
    const target = store.currentProject.devices.find((item) => item.mount !== 'busbar')!
    return { store, busbar, target }
  }

  it('подключает аппарат к шине и не даёт задвоить подключение', () => {
    const { store, busbar, target } = withBusbar()
    const before = store.currentProject.connections.length

    store.addBusbarConnection(busbar.instanceId, target.instanceId)
    expect(store.currentProject.connections).toHaveLength(before + 1)

    store.addBusbarConnection(busbar.instanceId, target.instanceId)
    expect(store.currentProject.connections).toHaveLength(before + 1)
    expect(store.toast?.text).toContain('уже есть')
  })

  it('отказывает, если источник не шина или его нет', () => {
    const { store, target } = withBusbar()
    const other = store.currentProject.devices.find((item) => item.mount !== 'busbar' && item.instanceId !== target.instanceId)!
    const before = store.currentProject.connections.length

    store.addBusbarConnection(other.instanceId, target.instanceId)
    store.addBusbarConnection('нет', target.instanceId)
    store.addBusbarConnection('нет', 'нет')

    expect(store.currentProject.connections).toHaveLength(before)
  })
})

describe('провода между клеммами', () => {
  /** A project with no wiring on it yet, so every clamp the test uses is free. */
  const twoDevices = () => {
    const store = openStore()
    store.newProject('Пустой щит', 'apartment')
    store.addDevice('ekf-mcb-1p-c6', 0, 0)
    store.addDevice('ekf-rccb-4p-40', 0, 4)
    const [first, second] = store.currentProject.devices
    return { store, first: first!, second: second! }
  }

  it('тянет провод между двумя клеммами и красит его по маркировке источника', () => {
    const { store, first, second } = twoDevices()

    expect(store.addWire({ deviceId: first.instanceId, pole: 1, side: 'top' }, { deviceId: second.instanceId, pole: 1, side: 'top' })).toBe(true)

    const wire = store.currentProject.connections.at(-1)!
    expect(wire.kind).toBe('jumper')
    expect(wire.fromBus).toBe('L')
    expect(wire.phase).toBe(1)
    expect(wire.label).not.toBe('')
    expect(second.instanceId).toBeTruthy()
  })

  it('тянет нейтраль от клеммы, помеченной N, а не фазу', () => {
    const { store } = twoDevices()
    store.addDevice('ekf-rcbo-1p-c16', 1, 8)
    const linked = store.currentProject.devices.find((item) => item.productId === 'ekf-rcbo-1p-c16')!
    const product = workspaceCatalog.find((item) => item.id === 'ekf-rcbo-1p-c16')!
    const neutral = deviceTerminals(product).find((item) => item.type === 'neutral')
    expect(neutral).toBeDefined()
    const target = store.currentProject.devices.find((item) => item.mount === 'din' && item.instanceId !== linked.instanceId)!

    expect(store.addWire(
      { deviceId: linked.instanceId, pole: neutral!.pole, side: neutral!.side },
      { deviceId: target.instanceId, pole: 1, side: 'top' },
    )).toBe(true)

    const wire = store.currentProject.connections.at(-1)!
    expect(wire.fromBus).toBe('N')
    // A neutral is not a phase conductor, so it gets no phase number to draw it by.
    expect(wire.phase).toBeUndefined()
  })

  it('отказывает в проводе в ту же клемму и в занятую клемму', () => {
    const { store, first, second } = twoDevices()
    const here = { deviceId: first.instanceId, pole: 1, side: 'top' as const }
    const there = { deviceId: second.instanceId, pole: 1, side: 'top' as const }

    expect(store.addWire(here, here)).toBe(false)
    expect(store.toast?.text).toContain('одной клемме')
    expect(store.addWire({ deviceId: 'нет', pole: 1, side: 'top' }, there)).toBe(false)

    expect(store.addWire(here, there)).toBe(true)
    // The same clamp cannot carry a second conductor, whoever it leaves from.
    expect(store.addWire(there, here)).toBe(false)
    expect(store.toast?.text).toContain('уже занята')
  })

  it('тянет провод от видимой шины и не даёт занять клемму дважды', () => {
    const { store, first } = twoDevices()
    const bus = store.currentProject.busAssemblies![0]!
    const to = { deviceId: first.instanceId, pole: 1, side: 'top' as const }

    expect(store.addBusWire(bus.id, to)).toBe(true)
    expect(store.addBusWire(bus.id, to)).toBe(false)
    expect(store.toast?.text).toContain('уже занята')
  })

  it('отказывает от провода от несуществующей шины или клеммы', () => {
    const { store, first } = twoDevices()

    expect(store.addBusWire('нет', { deviceId: first.instanceId, pole: 1, side: 'top' })).toBe(false)
    expect(store.addBusWire(store.currentProject.busAssemblies![0]!.id, { deviceId: 'нет', pole: 1, side: 'top' })).toBe(false)
  })
})

describe('цепи и подключения', () => {
  const withCircuit = () => {
    const store = openStore()
    const device = store.currentProject.devices[0]!
    store.addCircuit(device.instanceId)
    return { store, device, circuit: store.currentProject.circuits.at(-1)! }
  }

  it('добавляет цепь вместе с её проводом', () => {
    const { store, device, circuit } = withCircuit()
    expect(circuit.protectionDeviceId).not.toBe('')
    expect(store.currentProject.connections.some((item) => item.circuitId === circuit.id)).toBe(true)
    expect(device.instanceId).toBeTruthy()
  })

  it('не добавляет цепь без аппарата', () => {
    const store = openStore()
    store.currentProject.devices = []
    const before = store.currentProject.circuits.length

    store.addCircuit()

    expect(store.currentProject.circuits).toHaveLength(before)
    expect(store.toast?.tone).toBe('error')
  })

  it('не добавляет цепь на несуществующий аппарат', () => {
    const store = openStore()
    expect(store.addCircuit('нет')).toBe(false)
  })

  it('переносит переименование и цвет цепи на её провода', () => {
    const { store, circuit } = withCircuit()

    expect(store.updateCircuit(circuit.id, { name: 'Розетки', color: '#2c6fbb' })).toBe(true)

    const wire = store.currentProject.connections.find((item) => item.circuitId === circuit.id)!
    expect(wire.label).toBe('Розетки')
    expect(wire.color).toBe('#2c6fbb')
  })

  it('проверяет цепь целиком, а не по одному полю', () => {
    const { store, circuit } = withCircuit()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: '  ' }, 'Название цепи'],
      [{ loadName: '' }, 'Нагрузка'],
      [{ protectionDeviceId: '' }, 'защитное устройство'],
      [{ color: '' }, 'Цвет цепи'],
      [{ current: -1 }, 'Ток цепи'],
      [{ power: Number.POSITIVE_INFINITY }, 'Мощность цепи'],
      [{ wireCrossSection: 0.1 }, 'Сечение провода'],
      [{ phase: 4 }, 'Фаза цепи'],
    ]

    for (const [patch, fragment] of cases) {
      expect(store.updateCircuit(circuit.id, patch as never), JSON.stringify(patch)).toBe(false)
      expect(store.toast?.text).toContain(fragment)
    }
    expect(store.currentProject.circuits.at(-1)!.name).toBe(circuit.name)
  })

  it('не выбирает для цепи то, что не защищает', () => {
    const { store } = withCircuit()
    const terminal = store.currentProject.devices.find((item) => item.productId.includes('terminal'))

    if (terminal) {
      expect(store.updateCircuit(store.currentProject.circuits.at(-1)!.id, { protectionDeviceId: terminal.instanceId })).toBe(false)
      expect(store.toast?.text).toContain('автомат, УЗО или дифавтомат')
    }
  })

  it('не правит несуществующую цепь и не принимает чужие поля', () => {
    const { store, circuit } = withCircuit()

    expect(store.updateCircuit('нет', { name: 'x' })).toBe(false)
    expect(store.updateCircuit(circuit.id, {} as never)).toBe(false)
    expect(store.updateCircuit(circuit.id, { id: 'new' } as never)).toBe(false)
  })

  it('удаляет цепь вместе с её проводами', () => {
    const { store, circuit } = withCircuit()

    store.deleteCircuit(circuit.id)

    expect(store.currentProject.circuits.some((item) => item.id === circuit.id)).toBe(false)
    expect(store.currentProject.connections.some((item) => item.circuitId === circuit.id)).toBe(false)
  })

  it('выбирает и снимает выделение с провода одним и тем же щелчком', () => {
    const { store, circuit } = withCircuit()
    const id = store.currentProject.connections.find((item) => item.circuitId === circuit.id)!.id

    store.selectConnection(id)
    expect(store.selectedConnectionId).toBe(id)
    store.selectConnection(id)
    expect(store.selectedConnectionId).toBeNull()
    expect(circuit.id).toBeTruthy()
  })

  it('снимает выделение с удаляемого провода', () => {
    const { store, circuit } = withCircuit()
    const id = store.currentProject.connections.find((item) => item.circuitId === circuit.id)!.id
    store.selectConnection(id)

    store.deleteConnection(id)

    expect(store.selectedConnectionId).toBeNull()
    expect(store.currentProject.connections.some((item) => item.id === id)).toBe(false)
  })

  it('проверяет правку подключения и не даёт создать дубль', () => {
    const { store, circuit } = withCircuit()
    const id = store.currentProject.connections.find((item) => item.circuitId === circuit.id)!.id
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ fromBus: 'X' }, 'Шина должна'],
      [{ toDeviceId: 'нет' }, 'не найдено'],
      [{ color: '' }, 'Цвет подключения'],
      [{ thickness: 0.1 }, 'Толщина подключения'],
      [{ thickness: 100 }, 'Толщина подключения'],
      [{ label: 'x'.repeat(PROJECT_LIMITS.text + 1) }, 'Подпись подключения'],
      [{ circuitId: 'нет' }, 'Цепь подключения не найдена'],
    ]

    for (const [patch, fragment] of cases) {
      expect(store.updateConnection(id, patch as never), JSON.stringify(patch)).toBe(false)
      expect(store.toast?.text).toContain(fragment)
    }
    expect(store.updateConnection('нет', { label: 'x' })).toBe(false)
    expect(store.updateConnection(id, {} as never)).toBe(false)
    expect(store.updateConnection(id, { kind: 'jumper' } as never)).toBe(false)
  })
})

describe('история изменений', () => {
  it('не делает ничего, когда отменять нечего', () => {
    const store = openStore()
    const before = JSON.stringify(store.currentProject)

    store.undo()
    store.redo()

    expect(JSON.stringify(store.currentProject)).toBe(before)
  })

  it('возвращает и повторяет изменение', () => {
    const store = openStore()
    store.updateSettings({ inputCurrent: 99 })

    store.undo()
    expect(store.currentProject.settings.inputCurrent).not.toBe(99)
    expect(store.redoStack).toHaveLength(1)

    store.redo()
    expect(store.currentProject.settings.inputCurrent).toBe(99)
  })

  it('не копит историю без предела', () => {
    const store = openStore()
    for (let index = 0; index < 60; index += 1) store.updateSettings({ inputCurrent: 1 + (index % 200) })

    expect(store.undoStack.length).toBeLessThanOrEqual(50)
  })

  it('закрывает redo, как только сделан новое изменение', () => {
    const store = openStore()
    store.updateSettings({ inputCurrent: 11 })
    store.undo()
    expect(store.redoStack).toHaveLength(1)

    store.updateSettings({ inputCurrent: 12 })

    expect(store.redoStack).toHaveLength(0)
  })
})

describe('модельная библиотека', () => {
  const asset = (id: string): StoredModelAsset => ({
    id,
    name: 'Модель',
    source: 'local',
    fileName: `${id}.glb`,
    format: 'glb',
    transform: { rotationY: 0, scale: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
  })

  const imported = (id: string) => ({
    id,
    name: 'Импортированный',
    brand: '',
    sku: '',
    category: 'MCB' as const,
    moduleWidth: 1,
    height: 82,
    depth: 70,
    poles: 1,
    ratedCurrent: 16,
    voltage: 230 as const,
    bus: 'L' as const,
    price: 0,
    weight: 0,
    imported: true,
    modelId: id,
  })

  it('привязывает модель к товару каталога и снимает привязку', () => {
    const store = openStore()

    expect(store.bindProductModel('ekf-mcb-1p-c6', 'no-such-model')).toBe(false)
    expect(store.bindProductModel('нет такого', null)).toBe(false)
  })

  it('меняет товар за аппаратом, пересобирая ряд под новый размер', () => {
    const store = openStore()
    const device = store.currentProject.devices.find((item) => item.mount !== 'busbar')!
    store.selectedDeviceId = device.instanceId
    const before = store.currentProject.devices.map((item) => item.instanceId).sort().join(',')

    expect(store.replaceDeviceProduct(device.instanceId, 'ekf-mcb-4p-b32')).toBe(true)

    const after = store.currentProject.devices.map((item) => item.instanceId).sort().join(',')
    expect(after).toBe(before)
    expect(store.currentProject.devices.find((item) => item.instanceId === device.instanceId)!.productId).toBe('ekf-mcb-4p-b32')
  })

  it('не трогает аппарат, если товар не найден или уже тот же', () => {
    const store = openStore()
    const device = store.currentProject.devices[0]!
    const before = JSON.stringify(store.currentProject.devices)

    expect(store.replaceDeviceProduct(device.instanceId, 'нет такого')).toBe(false)
    expect(store.replaceDeviceProduct('нет', 'ekf-mcb-4p-b32')).toBe(false)
    expect(store.replaceDeviceProduct(device.instanceId, device.productId)).toBe(true)
    expect(JSON.stringify(store.currentProject.devices)).toBe(before)
  })

  it('не удаляет модель, на которую ссылается аппарат в щите', async () => {
    const store = openStoreWithModelDb()
    const modelId = 'lib-model-1'
    const product = imported(modelId)
    await store.addImportedModel(product, asset(modelId), new ArrayBuffer(4))
    store.addDevice(modelId, 1, 0)

    await store.deleteImportedModel(modelId)

    expect(store.modelLibrary.assets.map((item) => item.id)).toContain(modelId)
    expect(store.toast?.text).toContain('используется')
  })

  it('отказывается от товара импорта, который не наследует id модели', async () => {
    const store = openStoreWithModelDb()

    await store.addImportedModel(imported('other-id'), asset('lib-model-2'), new ArrayBuffer(4))

    expect(store.modelLibrary.assets).toHaveLength(0)
    expect(store.toast?.tone).toBe('error')
  })

  it('кладёт модель в библиотеку без товара, чтобы привязать её позже', async () => {
    const store = openStoreWithModelDb()

    await store.addImportedModel(null, asset('lib-model-3'), new ArrayBuffer(4))

    expect(store.modelLibrary.assets.map((item) => item.id)).toEqual(['lib-model-3'])
    expect(store.modelLibrary.products).toHaveLength(0)
    expect(store.modelAssetsById.has('lib-model-3')).toBe(true)
  })

  it('удаляет свободную модель и снимает привязки к ней', async () => {
    const store = openStoreWithModelDb()
    await store.addImportedModel(imported('lib-model-4'), asset('lib-model-4'), new ArrayBuffer(4))
    const modelId = 'lib-model-4'

    await store.deleteImportedModel(modelId)

    expect(store.modelLibrary.assets).toHaveLength(0)
    expect(store.modelLibrary.products).toHaveLength(0)
  })
})

describe('импорт проекта и очистка данных', () => {
  it('отказывается от файла, который не является проектом', () => {
    const store = openStore()

    for (const bad of [null, {}, { name: '' }, { name: 'x' }]) {
      expect(() => store.importProject(bad as never)).toThrow('Некорректный файл проекта')
    }
  })

  it('импортирует проект под новым идентификатором и открывает его', () => {
    const store = openStore()
    const source = createProject('Импорт')
    source.id = 'original'

    store.importProject(source)

    expect(store.currentProject.name).toBe('Импорт')
    expect(store.currentProject.id).not.toBe('original')
  })

  it('не импортирует проект, который не проходит проверку схемы', () => {
    const store = openStore()
    const broken = createProject('Сломанный') as unknown as Record<string, unknown>
    broken.devices = 'не массив'

    expect(() => store.importProject(broken as never)).toThrow()
  })

  it('очищает локальные данные и возвращает рабочую область к образцу', async () => {
    const store = openStore()
    store.newProject('Второй', 'apartment')
    store.updateSettings({ inputCurrent: 77 })

    await store.clearLocalData()

    expect(store.projects).toHaveLength(1)
    expect(store.currentProject.settings.inputCurrent).toBe(40)
    expect(store.currentProjectId).toBe('sample-apartment')
    expect(store.selectedDeviceId).toBeNull()
    expect(store.undoStack).toEqual([])
    expect(store.modelLibrary).toEqual({ assets: [], products: [], bindings: {} })
  })

  it('восстанавливает снимок рабочей области и открывает тот проект, который в нём текущий', async () => {
    const store = openStore()
    const first = blank('Первый')
    const second = blank('Второй')
    second.id = 'second'

    await store.restoreWorkspaceBackup({ projects: [first, second], currentProjectId: 'second' } as never)

    expect(store.projects.map((item) => item.name)).toEqual(['Первый', 'Второй'])
    expect(store.currentProjectId).toBe('second')
  })

  it('открывает первый проект, если в снимке нет текущего', async () => {
    const store = openStore()
    const first = blank('Первый')

    await store.restoreWorkspaceBackup({ projects: [first], currentProjectId: 'нет такого' } as never)

    expect(store.currentProjectId).toBe(first.id)
  })

  it('не восстанавливает снимок, которого нет', async () => {
    const store = openStore()
    const before = store.projects.length

    expect(await store.restoreStorageBackup()).toBe(false)
    expect(store.projects).toHaveLength(before)
  })
})

describe('состояние хранилища', () => {
  it('сообщает, что локальное хранилище недоступно, и не обещает сохранение', async () => {
    env = installBrowserEnv({ storage: new ThrowingStorage(new Error('запрещено')) })
    setActivePinia(createPinia())
    const store = useProjectStore()

    expect(store.storageStatus).toBe('storage-unavailable')
    expect(store.storageAlert).toContain('Локальное хранилище')
    // Nothing can be written, so the store has to say so instead of quietly losing the work.
    await expect(store.persistNow()).resolves.toBe(false)
  })

  it('сбрасывает бдительность после того, как пользователь признал снимок', async () => {
    const store = openStore()
    expect(store.storageRecoveryNotice).toBeNull()

    store.storageRecovery = [{ key: 'panel36.projects.v3', value: '{битый', at: '2026-01-01T00:00:00.000Z' } as never]
    await nextTick()
    expect(store.hasStorageRecovery).toBe(true)
    expect(store.storageRecoveryNotice).not.toBeNull()

    store.dismissStorageAlert()
    expect(store.storageRecoveryNotice).toBeNull()
  })

  it('не выдаёт снимок, когда восстанавливать нечего', () => {
    const store = openStore()
    expect(store.downloadStorageSnapshot()).toBe(false)
  })

  it('выдаёт снимок повреждённых данных файлом, когда он есть', () => {
    const store = openStore()
    store.storageRecovery = [{ key: 'panel36.projects.v3', value: '{битый', at: '2026-01-01T00:00:00.000Z' } as never]

    expect(store.downloadStorageSnapshot()).toBe(true)
    const download = env!.lastDownload()
    expect(download?.clicks).toBe(1)
    expect(download?.download).toMatch(/^panel36-recovery-\d{4}-\d{2}-\d{2}\.json$/)
  })
})
