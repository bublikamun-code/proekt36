import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProject, migrateProject, normalizeCircuit } from '../src/domain/project'
import { PROJECT_SCHEMA_VERSION, validateProjectSchema } from '../src/domain/projectSchema'
import { useProjectStore } from '../src/stores/project'
import { validateProject } from '../src/domain/validation'
import { CABLE_DROP_LIMIT_PERCENT, voltageDrop } from '../src/domain/voltageDrop'
import { wireBadge } from '../src/domain/wireRouting'
import type { PanelProject } from '../src/domain/types'
import { MemoryStorage, installBrowserEnv, resetFakeIndexedDB } from './support/browser-env'
import type { BrowserEnv } from './support/browser-env'

let env: BrowserEnv | null = null

afterEach(() => {
  env?.restore()
  env = null
  resetFakeIndexedDB()
  vi.useRealTimers()
})

const openStore = () => {
  env = installBrowserEnv({ storage: new MemoryStorage() })
  setActivePinia(createPinia())
  return useProjectStore()
}

const blankProject = (): PanelProject => {
  const project = createProject('Стенд линий')
  project.devices = []
  project.circuits = []
  project.connections = []
  project.combs = []
  return project
}

describe('потери напряжения', () => {
  it('считает однофазную линию по двойной длине', () => {
    // 2·35·16·0,0175/2,5 = 7,84 В → 3,41 % от 230 В
    const drop = voltageDrop({ lengthM: 35, currentA: 16, crossSectionMm2: 2.5, system: 1 })
    expect(drop.dropV).toBeCloseTo(7.84, 2)
    expect(drop.dropPercent).toBeCloseTo(3.41, 2)
    expect(drop.ok).toBe(true)
  })

  it('считает трёхфазную линию по √3 и 400 В', () => {
    // √3·30·25·0,0175/4 = 5,68 В → 1,42 % от 400 В
    const drop = voltageDrop({ lengthM: 30, currentA: 25, crossSectionMm2: 4, system: 3 })
    expect(drop.dropV).toBeCloseTo(5.68, 2)
    expect(drop.dropPercent).toBeCloseTo(1.42, 2)
  })

  it('ловит превышение лимита 4 %', () => {
    // 2·50·20·0,0175/1,5 = 23,3 В → 10,1 %
    const drop = voltageDrop({ lengthM: 50, currentA: 20, crossSectionMm2: 1.5, system: 1 })
    expect(drop.ok).toBe(false)
    expect(drop.dropPercent).toBeGreaterThan(CABLE_DROP_LIMIT_PERCENT)
  })

  it('не проверяет линию без длины, тока или сечения', () => {
    expect(voltageDrop({ lengthM: 0, currentA: 16, crossSectionMm2: 2.5, system: 1 }).dropPercent).toBe(0)
    expect(voltageDrop({ lengthM: 30, currentA: 0, crossSectionMm2: 2.5, system: 1 }).dropPercent).toBe(0)
    expect(voltageDrop({ lengthM: 30, currentA: 16, crossSectionMm2: 0, system: 1 }).dropPercent).toBe(0)
  })
})

describe('схема v4: помещения и поля линии', () => {
  it('нормализует новые поля цепи с дефолтами планировщика', () => {
    const circuit = normalizeCircuit({ id: 'c1', name: 'Розетки', protectionDeviceId: 'qf1' })
    expect(circuit.kind).toBe('power')
    expect(circuit.cableLength).toBe(0)
    expect(circuit.roomId).toBeUndefined()
  })

  it('миграция поднимает проект до v4 и сохраняет комнаты', () => {
    const migrated = migrateProject({
      ...blankProject(),
      schemaVersion: 3,
      rooms: [{ id: 'r1', name: 'Кухня', floor: 2 }],
      circuits: [{ id: 'c1', name: 'Свет', protectionDeviceId: '', roomId: 'r1' }],
    })
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(migrated.rooms).toHaveLength(1)
    expect(migrated.circuits[0]!.roomId).toBe('r1')
  })

  it('валидатор отвергает нереальную длину кабеля и битую комнату', () => {
    const base = () => {
      const project = blankProject()
      project.rooms = [{ id: 'r1', name: 'Кухня', floor: 1 }]
      project.devices = [{ instanceId: 'qf1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: 'QF01', quantity: 1, phase: 1, note: '', marking: 'QF01', mount: 'din' }]
      return project
    }
    // Полевая проверка: длина за пределами.
    const withBadLength = base()
    withBadLength.circuits = [{
      id: 'c1', name: 'Свет', loadName: 'Свет', current: 1, power: 0, phase: 1,
      protectionDeviceId: 'qf1', color: '#fff', wireCrossSection: 1.5, note: '',
      roomId: 'r1', cableLength: 5000,
    }]
    const fieldResult = validateProjectSchema(withBadLength)
    expect(fieldResult.valid).toBe(false)
    expect(fieldResult.errors.join('\n')).toMatch(/cableLength/)
    // Ссылочная проверка: поля в порядке, комната не существует.
    const withBadRoom = base()
    withBadRoom.circuits = [{
      id: 'c1', name: 'Свет', loadName: 'Свет', current: 1, power: 0, phase: 1,
      protectionDeviceId: 'qf1', color: '#fff', wireCrossSection: 1.5, note: '',
      roomId: 'нет-такого', cableLength: 25,
    }]
    const refResult = validateProjectSchema(withBadRoom)
    expect(refResult.valid).toBe(false)
    expect(refResult.errors.join('\n')).toMatch(/roomId/)
  })

  it('валидатор принимает корректную комнату и длину', () => {
    const project = blankProject()
    project.rooms = [{ id: 'r1', name: 'Кухня', floor: 1 }]
    project.devices = [{ instanceId: 'qf1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: 'QF01', quantity: 1, phase: 1, note: '', marking: 'QF01', mount: 'din' }]
    project.circuits = [{
      id: 'c1', name: 'Свет', loadName: 'Свет', current: 1, power: 0, phase: 1,
      protectionDeviceId: 'qf1', color: '#fff', wireCrossSection: 1.5, note: '',
      roomId: 'r1', kind: 'light', cableLength: 25,
    }]
    expect(validateProjectSchema(project).valid).toBe(true)
  })
})

describe('команды планировщика', () => {
  it('addRoom добавляет помещение, deleteRoom отвязывает его линии', () => {
    const store = openStore()
    const room = store.addRoom('Гостиная', 2)
    expect(room).not.toBeNull()
    expect(store.currentProject.rooms).toHaveLength(1)

    store.addLine({ name: 'Розетки 1', roomId: room!.id, protectionProductId: 'ekf-mcb-1p-c6' })
    expect(store.currentProject.circuits[0]!.roomId).toBe(room!.id)

    store.deleteRoom(room!.id)
    expect(store.currentProject.rooms).toHaveLength(0)
    // Линия переживает комнату — она просто выпадает из группы, а не исчезает из плана.
    expect(store.currentProject.circuits).toHaveLength(1)
    expect(store.currentProject.circuits[0]!.roomId).toBeUndefined()
  })

  it('addLine ставит аппарат защиты на доску и тянет провод от фазы', () => {
    const store = openStore()
    store.deleteSelected()
    store.currentProject.devices = []

    const id = store.addLine({ name: 'Розетки 1', protectionProductId: 'ekf-mcb-1p-c6', current: 16 })
    expect(id).toBeTruthy()

    const circuit = store.currentProject.circuits[0]!
    expect(circuit.name).toBe('Розетки 1')
    expect(circuit.kind).toBe('power')
    expect(circuit.cableLength).toBe(0)

    const placed = store.currentProject.devices.find((item) => item.instanceId === circuit.protectionDeviceId)
    expect(placed).toBeDefined()
    expect(placed!.row).toBe(0)
    expect(placed!.address).toMatch(/^QF/)

    const feed = store.currentProject.connections.find((item) => item.circuitId === id)
    expect(feed).toBeDefined()
    expect(feed!.fromBus).toBe('L')
    expect(feed!.label).toBe('Розетки 1')
  })

  it('addLine отказывает, когда аппарат не защитный, и не трогает проект', () => {
    const store = openStore()
    const before = JSON.stringify(store.currentProject)
    const id = store.addLine({ name: 'Плохая', protectionProductId: 'iek-terminal-1p-blue' })
    expect(id).toBeNull()
    expect(JSON.stringify(store.currentProject)).toBe(before)
  })

  it('wireLine тянет N от шины в нейтральную клемму дифавтомата', () => {
    const store = openStore()
    store.currentProject.devices = []
    const id = store.addLine({ name: 'Свет', protectionProductId: 'ekf-rcbo-1p-c16' })
    expect(id).toBeTruthy()

    expect(store.wireLine(id!)).toBe(true)
    const neutral = store.currentProject.connections.find((item) => item.circuitId === id && item.fromBus === 'N')
    expect(neutral).toBeDefined()
    expect(neutral!.busId).toBe('bus-n-bottom')
    expect(neutral!.toTerminal).toBeDefined()
    expect(neutral!.label).toMatch(/^Свет \/ QFI/)
    // Повторный вызов ничего не дорисовывает — клемма занята.
    store.wireLine(id!)
    expect(store.currentProject.connections.filter((item) => item.circuitId === id && item.fromBus === 'N')).toHaveLength(1)
  })

  it('deleteLine снимает линию вместе с её аппаратом и проводами', () => {
    const store = openStore()
    store.currentProject.devices = []
    const id = store.addLine({ name: 'Розетки 2', protectionProductId: 'ekf-mcb-1p-c6' })
    const circuit = store.currentProject.circuits.find((item) => item.id === id)!
    const protectionId = circuit.protectionDeviceId
    expect(store.currentProject.devices.some((item) => item.instanceId === protectionId)).toBe(true)

    store.deleteLine(id!)
    expect(store.currentProject.circuits).toHaveLength(0)
    // У линии не остаётся ни своих проводов, ни её аппарата; чужие провода демо-щита живы.
    expect(store.currentProject.connections.filter((item) => item.circuitId === id)).toHaveLength(0)
    expect(store.currentProject.devices.some((item) => item.instanceId === protectionId)).toBe(false)
  })

  it('cascadeLabel называет аппарат, от которого питание пришло перемычкой', () => {
    const store = openStore()
    store.currentProject.devices = []
    const first = store.addLine({ name: 'А', protectionProductId: 'ekf-mcb-1p-c6' })
    const second = store.addLine({ name: 'Б', protectionProductId: 'ekf-mcb-1p-c6' })
    const firstCircuit = store.currentProject.circuits.find((item) => item.id === first)!
    const secondCircuit = store.currentProject.circuits.find((item) => item.id === second)!
    // Перемычка верх—верх, как их рисует инструмент «Провод».
    store.addWire(
      { deviceId: firstCircuit.protectionDeviceId, pole: 2, side: 'bottom' },
      { deviceId: secondCircuit.protectionDeviceId, pole: 1, side: 'top' },
    )
    const label = store.cascadeLabel(secondCircuit.protectionDeviceId)
    expect(label).toMatch(/^запитано от QF/)
  })

  it('undo откатывает линию целиком — аппарат, цепь и провод одним шагом', () => {
    const store = openStore()
    store.currentProject.devices = []
    const id = store.addLine({ name: 'Розетки 3', protectionProductId: 'ekf-mcb-1p-c6' })
    expect(store.currentProject.circuits).toHaveLength(1)

    store.undo()
    expect(store.currentProject.circuits).toHaveLength(0)
    expect(store.currentProject.connections.filter((item) => item.circuitId === id)).toHaveLength(0)
    const circuit = { protection: store.currentProject.circuits[0] }
    expect(circuit.protection).toBeUndefined()
  })
})

describe('бирка и проверки линии', () => {
  it('бирка провода линии показывает её имя, а не фазу', () => {
    expect(wireBadge({ label: 'Розетки 1', fromBus: 'L', phase: 1, toTerminal: { deviceId: 'x', pole: 1, side: 'top' } as object }, 'Розетки 1')).toBe('Розетки 1')
    expect(wireBadge({ label: 'x', fromBus: 'L', phase: 2, toTerminal: { deviceId: 'x', pole: 1, side: 'top' } as object })).toBe('L2')
    expect(wireBadge({ label: 'x', fromBus: 'N', toTerminal: { deviceId: 'x', pole: 1, side: 'top' } as object })).toBe('N')
    expect(wireBadge({ label: 'Своя надпись', fromBus: 'L' })).toBe('Своя надпись')
  })

  it('бирка обрезает длинное имя линии', () => {
    expect(wireBadge({ label: 'x', fromBus: 'L', toTerminal: { deviceId: 'x', pole: 1, side: 'top' } as object }, 'Очень длинное название линии щита')).toMatch(/…$/)
  })

  it('проверки предупреждают о потерях выше 4 %', () => {
    const store = openStore()
    const project = store.currentProject
    project.circuits = [{
      id: 'c1', name: 'Далёкие розетки', loadName: 'Розетки', current: 20, power: 0, phase: 1,
      protectionDeviceId: '', color: '#fff', wireCrossSection: 1.5, note: '',
      cableLength: 50, kind: 'power',
    }]
    const issues = validateProject(project, store.definitions)
    const drop = issues.find((issue) => issue.ruleCode === 'cable.drop.exceeded')
    expect(drop).toBeDefined()
    expect(drop!.level).toBe('warning')
    expect(drop!.message).toMatch(/Далёкие розетки/)
  })
})
