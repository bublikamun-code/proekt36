import { describe, expect, it } from 'vitest'
import { demoProject } from '../src/data/demoProject'
import { workspaceCatalog } from '../src/data/catalog'
import { buildLabelSheet, labelSheetWarning, positionWord } from '../src/domain/labelSheet'
import { autoNumber } from '../src/domain/project'
import type { PanelProject } from '../src/domain/types'

const definitions = new Map(workspaceCatalog.map((product) => [product.id, product]))
const sheet = buildLabelSheet(demoProject, definitions)

const withDevices = (devices: PanelProject['devices'], circuits: PanelProject['circuits'] = []) => ({
  ...demoProject,
  devices,
  circuits,
  connections: [],
})

const device = (over: Partial<PanelProject['devices'][number]> = {}) => ({
  instanceId: 'd1', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0,
  address: 'QF1', marking: 'QF1', quantity: 1, phase: 1 as const, note: '', ...over,
})

describe('лист маркировки', () => {
  it('даёт по одной этикетке на позицию в порядке доски', () => {
    expect(sheet.labels).toHaveLength(demoProject.devices.length)
    const positions = sheet.labels.map((label) => [label.row, label.slot] as const)
    expect(positions).toEqual([...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    expect(sheet.unmarked).toBe(0)
    expect(sheet.duplicated).toBe(0)
  })

  it('пишет то, что ввёл пользователь, а название цепи — только если адреса нет', () => {
    const byPosition = new Map(sheet.labels.map((label) => [label.position, label]))
    // Every demo position carries an explicit marking, and that is what goes on the label.
    expect(byPosition.get('1.3')!.text).toBe('QFI01')

    // The same position without an address takes the circuit's name, which says more than a number.
    const filled = buildLabelSheet(withDevices([
      device({ instanceId: 'a', address: '', marking: '' }),
    ], [{ id: 'c1', name: 'Кухня', loadName: 'Кухня', current: 16, power: 0, phase: 1, protectionDeviceId: 'a', color: '#000', wireCrossSection: 2.5, note: '' }]), definitions)
    expect(filled.labels[0]!.text).toBe('Кухня')
    expect(filled.unmarked).toBe(1)
  })

  it('считает позиции без адреса и повторы и говорит об этом прямо', () => {
    const incomplete = buildLabelSheet(withDevices([
      device({ instanceId: 'a', address: 'QF1', marking: 'QF1' }),
      device({ instanceId: 'b', slot: 1, address: 'QF2', marking: 'QF2' }),
      device({ instanceId: 'c', slot: 2, address: '', marking: '' }),
    ]), definitions)
    expect(incomplete.unmarked).toBe(1)
    const duplicated = buildLabelSheet(withDevices([
      device({ instanceId: 'a', address: 'QF1', marking: 'QF1' }),
      device({ instanceId: 'b', slot: 1, address: 'QF1', marking: 'QF1' }),
    ]), definitions)
    expect(duplicated.duplicated).toBe(2)

    const warning = labelSheetWarning(incomplete)
    expect(warning).toContain('1 позиция без адреса')
    expect(labelSheetWarning(sheet)).toBe('')
  })

  it('сохраняет длинное название целиком и предупреждает о переносе', () => {
    const long = 'Розетки кухни, холодильник и посудомоечная машина'
    const built = buildLabelSheet(withDevices([
      device({ instanceId: 'a', address: '', marking: '' }),
    ], [{ id: 'c1', name: long, loadName: long, current: 16, power: 0, phase: 1, protectionDeviceId: 'a', color: '#000', wireCrossSection: 2.5, note: '' }]), definitions)
    const label = built.labels[0]!
    expect(label.text).toBe(long)
    expect(built.longLabels).toBe(1)
    expect(labelSheetWarning(built)).toContain('Длинные подписи перенесены')
    expect(label.fullText).toBe(long)
  })

  it('разрешает одинаковые подписи при разных адресах, а дубли адресов отмечает независимо от подписи', () => {
    const repeatedNames = buildLabelSheet(withDevices([
      device({ instanceId: 'a', address: 'QF1', marking: 'Освещение' }),
      device({ instanceId: 'b', address: 'QF2', marking: 'Освещение' }),
    ]), definitions)
    expect(repeatedNames.duplicated).toBe(0)
    const repeatedAddresses = buildLabelSheet(withDevices([
      device({ instanceId: 'a', address: 'QF1', marking: 'Кухня' }),
      device({ instanceId: 'b', address: ' QF1 ', marking: 'Спальня' }),
    ]), definitions)
    expect(repeatedAddresses.duplicated).toBe(2)
  })

  it('обновляет автоматическую подпись при нумерации, сохраняет ручную и выдаёт уникальные адреса', () => {
    const numbered = autoNumber([
      device({ instanceId: 'a', address: 'QF08', marking: 'QF08' }),
      device({ instanceId: 'b', address: 'QF09', marking: 'Кухня' }),
      device({ instanceId: 'c', address: '', marking: '' }),
    ], definitions)
    expect(numbered.map((item) => item.address)).toEqual(['QF01', 'QF02', 'QF03'])
    expect(numbered.map((item) => item.marking)).toEqual(['QF01', 'Кухня', 'QF03'])
    expect(autoNumber(numbered, definitions)).toEqual(numbered)
  })

  it('не маркирует шины и устройства вне DIN-рейки', () => {
    const built = buildLabelSheet(withDevices([
      device({ instanceId: 'a' }),
      device({ instanceId: 'b', slot: 1, mount: 'busbar' }),
    ]), definitions)
    expect(built.labels).toHaveLength(1)
  })

  it('склоняет позицию по-русски, включая 11–14', () => {
    expect([1, 2, 5, 11, 12, 14, 21, 22, 25].map(positionWord))
      .toEqual(['позиция', 'позиции', 'позиций', 'позиций', 'позиций', 'позиций', 'позиция', 'позиции', 'позиций'])
  })
})
