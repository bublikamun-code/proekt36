import { describe, expect, it } from 'vitest'
import { builtinCatalog } from '../src/data/catalog'
import { cabinetById, cabinetSpecLabel, railById } from '../src/data/enclosures'
import { getEnclosureMinimum, getFreeSlots, getRowCapacity, moveDevice, placeProduct, resolveDeviceMove } from '../src/domain/layout'
import { getPanelGeometry } from '../src/domain/panelGeometry'
import { createDevice, createProject, migrateProject } from '../src/domain/project'
import type { DeviceDefinition } from '../src/domain/types'

const definitions = new Map(builtinCatalog.map((product) => [product.id, product]))
const product = (id: string, width: number): DeviceDefinition => ({ ...definitions.get('ekf-mcb-1p-c6')!, id, moduleWidth: width })
const legacyProject = () => migrateProject({ settings: { enclosureWidth: 540, enclosureHeight: 650, enclosureDepth: 110, rows: 9 } })

describe('slot layout', () => {
  const p1 = product('p1', 1)
  const p3 = product('p3', 3)
  const localDefinitions = new Map([[p1.id, p1], [p3.id, p3]])

  it('uses the selected catalog rail capacity', () => {
    const project = createProject('Каталог', 'apartment', { cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' })
    expect(getRowCapacity(project)).toBe(12)
    expect(getFreeSlots(project, definitions)).toBe(24)
  })

  it('keeps the 17.5 mm fallback for legacy projects', () => {
    const project = legacyProject()
    expect(getRowCapacity(project)).toBe(29)
    expect(getFreeSlots(project, definitions)).toBe(261)
  })

  it('places devices and auto-shifts neighbours to the right when adding', () => {
    const first = placeProduct([], p3, 0, 0, 29, () => 'one', localDefinitions)
    const second = placeProduct(first.devices, p1, 0, 0, 29, () => 'two', localDefinitions)
    expect(second.slot).toBe(0)
    expect(second.devices.find((item) => item.instanceId === 'one')?.slot).toBe(1)
  })

  it('leaves the devices left of an insertion point exactly where they are', () => {
    const first = placeProduct([], p1, 0, 0, 12, () => 'one', localDefinitions)
    const second = placeProduct(first.devices, p1, 0, 1, 12, () => 'two', localDefinitions)
    const third = placeProduct(second.devices, p1, 0, 6, 12, () => 'three', localDefinitions)
    expect(third.error).toBeUndefined()
    expect(third.slot).toBe(6)
    expect(third.devices.find((item) => item.instanceId === 'one')?.slot).toBe(0)
    expect(third.devices.find((item) => item.instanceId === 'two')?.slot).toBe(1)
  })

  it('inserts into the last free module of a full row instead of failing', () => {
    // Every module but the last is taken. Reflowing the row from the insertion
    // point would need twelve more modules and used to report the row as too full.
    const devices = Array.from({ length: 11 }, (_, index) => createDevice(p1, 0, index))
    const result = placeProduct(devices, p1, 0, 11, 12, () => 'late', localDefinitions)
    expect(result.error).toBeUndefined()
    expect(result.slot).toBe(11)
    expect(result.devices.find((item) => item.instanceId === 'late')?.slot).toBe(11)
    expect(result.devices.find((item) => item.instanceId === devices[0]!.instanceId)?.slot).toBe(0)
    expect(result.devices.find((item) => item.instanceId === devices[10]!.instanceId)?.slot).toBe(10)
  })

  it('moves into a free interval without shifting neighbours', () => {
    const first = createDevice(p1, 0, 1)
    const second = createDevice(p1, 0, 3)
    const placed = [first, second]
    const moved = moveDevice(placed, first.instanceId, 0, 0, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.devices.find((item) => item.instanceId === first.instanceId)?.slot).toBe(0)
    expect(moved.devices.find((item) => item.instanceId === second.instanceId)?.slot).toBe(3)
  })

  it('pushes a neighbour aside when a device is dropped onto it', () => {
    const first = createDevice(p1, 0, 1)
    const second = createDevice(p1, 0, 3)
    const moved = moveDevice([first, second], first.instanceId, 0, 3, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.devices.find((item) => item.instanceId === first.instanceId)?.slot).toBe(3)
    expect(moved.devices.find((item) => item.instanceId === second.instanceId)?.slot).toBe(4)
  })

  it('keeps the devices a rightward move passes over in their order', () => {
    const moving = createDevice(p1, 0, 0)
    const first = createDevice(p1, 0, 2)
    const last = createDevice(p1, 0, 8)
    const moved = moveDevice([moving, first, last], moving.instanceId, 0, 4, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.devices.map((item) => [item.instanceId, item.slot])).toEqual([[first.instanceId, 2], [moving.instanceId, 4], [last.instanceId, 8]])
  })

  it('leaves a hole in the source row when a device moves to another one', () => {
    const moving = createDevice(p1, 0, 2)
    const moved = moveDevice([moving, createDevice(p1, 0, 4)], moving.instanceId, 1, 0, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.devices.find((item) => item.instanceId === moving.instanceId)).toMatchObject({ row: 1, slot: 0 })
  })

  it('rejects a move whose neighbours no longer fit in the row', () => {
    const devices = Array.from({ length: 12 }, (_, index) => createDevice(p1, 0, index))
    const result = moveDevice(devices, devices[0]!.instanceId, 0, 4, 12, localDefinitions)
    expect(result.error).toBe('Для сдвига соседей не хватает места в ряду')
    expect(result.devices).toBe(devices)
  })

  it('clamps a move past the end of the rail onto its last free module', () => {
    const first = createDevice(p1, 0, 1)
    const moved = resolveDeviceMove([first], first.instanceId, 0, 12, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.slot).toBe(11)
    expect(moved.devices.find((item) => item.instanceId === first.instanceId)?.slot).toBe(11)
  })

  it('keeps a busbar in slot 0 and only changes its row', () => {
    const busbar = { ...createDevice(p1, 0, 4), mount: 'busbar' as const }
    const moved = resolveDeviceMove([busbar], busbar.instanceId, 2, 7, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.devices[0]).toMatchObject({ row: 2, slot: 0 })
  })

  it('previews exactly the layout the move commits, without touching the source', () => {
    const first = createDevice(p1, 0, 1)
    const second = createDevice(p3, 0, 2)
    const placed = [first, second]
    const previewed = resolveDeviceMove(placed, first.instanceId, 0, 4, 12, localDefinitions)
    const committed = moveDevice(placed, first.instanceId, 0, 4, 12, localDefinitions)
    expect(previewed.devices).toEqual(committed.devices)
    expect(placed.find((item) => item.instanceId === first.instanceId)?.slot).toBe(1)
    expect(placed.find((item) => item.instanceId === second.instanceId)?.slot).toBe(2)
  })

  it('treats a move to the same position as a successful no-op', () => {
    const first = createDevice(p1, 0, 1)
    const second = createDevice(p1, 0, 3)
    const placed = [first, second]
    const moved = moveDevice(placed, first.instanceId, 0, 1, 12, localDefinitions)
    expect(moved.error).toBeUndefined()
    expect(moved.devices).toBe(placed)
  })

  it('uses the catalog cabinet width as the minimum, including legacy offsets', () => {
    const catalog = createProject('Каталог', 'apartment')
    catalog.devices = [createDevice(p3, 0, 0)]
    expect(getEnclosureMinimum(catalog, localDefinitions).width).toBe(310)

    const legacy = legacyProject()
    legacy.devices = [createDevice(p3, 0, 0)]
    expect(getEnclosureMinimum(legacy, localDefinitions).width).toBe(83)
  })

  it('measures the minimum width by the widest row, not by the total module count', () => {
    const project = createProject('Четыре ряда', 'apartment', { cabinetId: 'panel36-48-r12-embedded', railId: 'rail-12' })
    project.devices = [
      ...Array.from({ length: 8 }, (_, index) => createDevice(p1, 0, index)),
      ...Array.from({ length: 6 }, (_, index) => createDevice(p1, 1, index)),
      ...Array.from({ length: 4 }, (_, index) => createDevice(p1, 2, index)),
    ]
    const minimum = getEnclosureMinimum(project, localDefinitions)
    expect(minimum.width).toBe(283)
    expect(minimum.width).toBeLessThan(project.devices.length * 18 + 30)
  })
})

describe('catalog enclosure dimensions', () => {
  const catalog = new Map(builtinCatalog.map((item) => [item.id, item]))

  it('stores the TEHNOPLAST C series at its published millimetre dimensions', () => {
    const expected: [string, { width: number; height: number; depth: number; rows: number; modules: number; railId: string }][] = [
      ['panel36-12-embedded', { width: 283, height: 232, depth: 106, rows: 1, modules: 12, railId: 'rail-12' }],
      ['panel36-18-r18-embedded', { width: 392, height: 232, depth: 106, rows: 1, modules: 18, railId: 'rail-18' }],
      ['panel36-24-embedded', { width: 283, height: 357, depth: 106, rows: 2, modules: 24, railId: 'rail-12' }],
      ['panel36-36-r12-embedded', { width: 283, height: 482, depth: 106, rows: 3, modules: 36, railId: 'rail-12' }],
      ['panel36-48-r12-embedded', { width: 283, height: 676, depth: 106, rows: 4, modules: 48, railId: 'rail-12' }],
    ]
    for (const [id, spec] of expected) {
      const cabinet = cabinetById.get(id)
      expect(cabinet, id).toBeDefined()
      expect(cabinet).toMatchObject(spec)
      expect(cabinet!.verificationStatus).toBe('verified')
      expect(cabinet!.sourceUrl).toMatch(/nvacontact\.com/)
    }
  })

  it('renders a 48-module cabinet as a tall housing, not a wide one', () => {
    const project = createProject('U48C', 'test', { cabinetId: 'panel36-48-r12-embedded', railId: 'rail-12' })
    const geometry = getPanelGeometry(project, catalog)
    expect(geometry.cabinetWidthMm).toBe(283)
    expect(geometry.cabinetHeightMm).toBe(676)
    expect(geometry.cabinetDepthMm).toBe(106)
    expect(geometry.capacity).toBe(12)
    expect(geometry.rowHeightsMm).toHaveLength(4)
    expect(geometry.cabinetWidthPx / geometry.cabinetHeightPx).toBeCloseTo(283 / 676, 5)
    expect(geometry.cabinetWidthPx).toBeLessThan(geometry.cabinetHeightPx)
  })

  it('keeps every unconfirmed housing as a profile, never as a verified product', () => {
    for (const cabinet of cabinetById.values()) {
      if (cabinet.brand === 'Panel36') expect(cabinet.verificationStatus).toBe('template')
    }
  })

  it('uses the rail that matches the housing', () => {
    expect(railById.get('rail-12')?.slots).toBe(12)
    expect(railById.get('rail-18')?.slots).toBe(18)
    for (const cabinet of cabinetById.values()) {
      const rail = railById.get(cabinet.railId)
      expect(rail).toBeDefined()
      expect(cabinet.rows * rail!.slots).toBe(cabinet.modules)
    }
  })

  it('labels the physical size and flags profiles', () => {
    expect(cabinetSpecLabel(cabinetById.get('panel36-48-r12-embedded'))).toBe('283×676×106 мм')
    expect(cabinetSpecLabel(cabinetById.get('panel36-36-r18-surface'))).toMatch(/· профиль$/)
    expect(cabinetSpecLabel(undefined)).toBe('Параметры не заданы')
  })
})

describe('physical panel geometry', () => {
  it('uses 18 mm for 12- and 18-module catalog rails', () => {
    const definitions = new Map(builtinCatalog.map((item) => [item.id, item]))
    const rail12 = createProject('12', 'test', { cabinetId: 'panel36-12-embedded', railId: 'rail-12' })
    const rail18 = createProject('18', 'test', { cabinetId: 'panel36-18-r18-embedded', railId: 'rail-18' })

    expect(getPanelGeometry(rail12, definitions)).toMatchObject({ capacity: 12, modulePitchMm: 18, railWidthMm: 216, legacy: false })
    expect(getPanelGeometry(rail18, definitions)).toMatchObject({ capacity: 18, modulePitchMm: 18, railWidthMm: 324, legacy: false })
  })

  it('keeps the 17.5 mm fallback for legacy projects', () => {
    const geometry = getPanelGeometry(legacyProject(), new Map(builtinCatalog.map((item) => [item.id, item])))
    expect(geometry.capacity).toBe(29)
    expect(geometry.modulePitchMm).toBe(17.5)
    expect(geometry.railWidthMm).toBe(507.5)
    expect(geometry.legacy).toBe(true)
  })

  it('derives device width from footprint and never from purchase quantity', () => {
    const base = builtinCatalog.find((item) => item.id === 'ekf-mcb-1p-c6')!
    const p4 = { ...base, id: 'p4', moduleWidth: 4 }
    const definitions = new Map([[p4.id, p4]])
    const project = createProject('Footprint', 'test', { cabinetId: 'panel36-12-embedded', railId: 'rail-12' })
    const device = { ...createDevice(p4, 0, 0), quantity: 7 }
    project.devices = [device]
    const geometry = getPanelGeometry(project, definitions)

    expect(geometry.deviceWidthMm(p4.id)).toBe(72)
    expect(geometry.deviceWidthPx(p4.id)).toBe(108)
    expect(geometry.deviceWidthMm(p4.id)).toBe(72)
  })

  it('increases a row height for a physically taller device', () => {
    const base = builtinCatalog.find((item) => item.id === 'ekf-mcb-1p-c6')!
    const standard = { ...base, id: 'standard' }
    const tall = { ...base, id: 'tall', height: 120 }
    const definitions = new Map([[standard.id, standard], [tall.id, tall]])
    const project = createProject('Heights', 'test', { cabinetId: 'panel36-12-embedded', railId: 'rail-12' })
    const normalGeometry = getPanelGeometry(project, definitions)
    project.devices = [createDevice(tall, 0, 0)]
    const tallGeometry = getPanelGeometry(project, definitions)

    expect(tallGeometry.rowHeightsMm[0]).toBeGreaterThan(normalGeometry.rowHeightsMm[0])
  })
})
