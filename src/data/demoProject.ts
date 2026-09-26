import type { PanelProject } from '../domain/types'

export const demoProject: PanelProject = {
  schemaVersion: 2,
  id: 'demo-panel-36-project',
  name: 'Квартира · распределительный щит',
  preset: 'demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {
    inputCurrent: 40,
    phase: 1,
    enclosureWidth: 310,
    enclosureHeight: 350,
    enclosureDepth: 105,
    rows: 2,
    reserveModules: 8,
    cabinetId: 'enmas-nx8-24-embedded',
    railId: 'rail-12',
  },
  devices: [
    { instanceId: 'demo-qf01', productId: 'enmas-nb1-63h-2p-40a-c', row: 0, slot: 0, address: 'QF01', marking: 'QF01', quantity: 1, phase: 1, note: 'Вводной автомат', mount: 'din' },
    { instanceId: 'demo-qfi01', productId: 'enmas-nb1l-2p-16a-c-30ma', row: 0, slot: 2, address: 'QFI01', marking: 'QFI01', quantity: 1, phase: 1, note: 'Розетки гостиной', mount: 'din' },
    { instanceId: 'demo-qfi02', productId: 'enmas-nb1l-2p-16a-c-30ma', row: 0, slot: 4, address: 'QFI02', marking: 'QFI02', quantity: 1, phase: 1, note: 'Кухня', mount: 'din' },
    { instanceId: 'demo-qfi03', productId: 'enmas-nb1l-2p-10a-b-30ma', row: 0, slot: 6, address: 'QFI03', marking: 'QFI03', quantity: 1, phase: 1, note: 'Влажные зоны', mount: 'din' },
    { instanceId: 'demo-qf02', productId: 'enmas-nb1-63h-1p-6a-c', row: 0, slot: 8, address: 'QF02', marking: 'QF02', quantity: 1, phase: 1, note: 'Освещение', mount: 'din' },
    { instanceId: 'demo-qf03', productId: 'enmas-nb1-63h-1p-10a-c', row: 0, slot: 9, address: 'QF03', marking: 'QF03', quantity: 1, phase: 1, note: 'Розетки спальни', mount: 'din' },
    { instanceId: 'demo-spd01', productId: 'enmas-nu6-iig-2p-440v', row: 0, slot: 10, address: 'SPD01', marking: 'SPD01', quantity: 1, phase: 1, note: 'Защита ввода', mount: 'din' },
    { instanceId: 'demo-xt01', productId: 'enmas-template-shk', row: 1, slot: 0, address: 'XT01', marking: 'XT01', quantity: 1, phase: 1, note: 'Клемма ШК', mount: 'din' },
    { instanceId: 'demo-xt02', productId: 'enmas-template-kbr', row: 1, slot: 1, address: 'XT02', marking: 'XT02', quantity: 1, phase: 1, note: 'Клемма КБР', mount: 'din' },
    { instanceId: 'demo-xt03', productId: 'enmas-template-ksv', row: 1, slot: 2, address: 'XT03', marking: 'XT03', quantity: 1, phase: 1, note: 'Клемма КСВ', mount: 'din' },
  ],
  circuits: [
    { id: 'demo-circuit-living', name: 'Розетки гостиной', loadName: 'Розетки гостиной', current: 16, power: 1500, phase: 1, protectionDeviceId: 'demo-qfi01', color: '#d65b43', wireCrossSection: 2.5, note: 'Демонстрационная цепь' },
    { id: 'demo-circuit-kitchen', name: 'Кухня', loadName: 'Кухня', current: 16, power: 2200, phase: 1, protectionDeviceId: 'demo-qfi02', color: '#d65b43', wireCrossSection: 2.5, note: 'Демонстрационная цепь' },
    { id: 'demo-circuit-light', name: 'Освещение', loadName: 'Освещение', current: 6, power: 720, phase: 1, protectionDeviceId: 'demo-qf02', color: '#d65b43', wireCrossSection: 1.5, note: 'Демонстрационная цепь' },
  ],
  connections: [
    { id: 'demo-connection-living', circuitId: 'demo-circuit-living', fromBus: 'L', toDeviceId: 'demo-qfi01', color: '#d65b43', thickness: 2, label: 'L → QFI01' },
    { id: 'demo-connection-kitchen', circuitId: 'demo-circuit-kitchen', fromBus: 'L', toDeviceId: 'demo-qfi02', color: '#d65b43', thickness: 2, label: 'L → QFI02' },
    { id: 'demo-connection-light', circuitId: 'demo-circuit-light', fromBus: 'L', toDeviceId: 'demo-qf02', color: '#d65b43', thickness: 2, label: 'L → QF02' },
  ],
}
