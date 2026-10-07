import { PROJECT_SCHEMA_VERSION } from '../domain/projectSchema'
import type { PanelProject } from '../domain/types'

export const demoProject: PanelProject = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
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
    { instanceId: 'demo-qf01', productId: 'ekf-mcb-2p-c16', row: 0, slot: 0, address: 'QF01', marking: 'QF01', quantity: 1, phase: 1, note: 'Вводной автомат', mount: 'din' },
    { instanceId: 'demo-qfi01', productId: 'ekf-rcbo-1p-c16', row: 0, slot: 2, address: 'QFI01', marking: 'QFI01', quantity: 1, phase: 1, note: 'Розетки гостиной', mount: 'din' },
    { instanceId: 'demo-qfi02', productId: 'ekf-rcbo-1p-c16', row: 0, slot: 4, address: 'QFI02', marking: 'QFI02', quantity: 1, phase: 1, note: 'Кухня', mount: 'din' },
    { instanceId: 'demo-qfi03', productId: 'ekf-rcbo-1p-c16', row: 0, slot: 6, address: 'QFI03', marking: 'QFI03', quantity: 1, phase: 1, note: 'Влажные зоны', mount: 'din' },
    { instanceId: 'demo-qf02', productId: 'ekf-mcb-1p-c6', row: 0, slot: 8, address: 'QF02', marking: 'QF02', quantity: 1, phase: 1, note: 'Освещение', mount: 'din' },
    { instanceId: 'demo-qf03', productId: 'ekf-mcb-1p-c6', row: 0, slot: 9, address: 'QF03', marking: 'QF03', quantity: 1, phase: 1, note: 'Розетки спальни', mount: 'din' },
    { instanceId: 'demo-spd01', productId: 'ekf-spd-t1-2p', row: 0, slot: 10, address: 'SPD01', marking: 'SPD01', quantity: 1, phase: 1, note: 'Защита ввода', mount: 'din' },
    { instanceId: 'demo-xt01', productId: 'iek-terminal-1p-gray', row: 1, slot: 0, address: 'XT01', marking: 'XT01', quantity: 1, phase: 1, note: 'Клемма ШК', mount: 'din' },
    { instanceId: 'demo-xt02', productId: 'iek-terminal-1p-blue', row: 1, slot: 1, address: 'XT02', marking: 'XT02', quantity: 1, phase: 1, note: 'Клемма КБР', mount: 'din' },
    { instanceId: 'demo-xt03', productId: 'ekf-terminal-1p-gray', row: 1, slot: 2, address: 'XT03', marking: 'XT03', quantity: 1, phase: 1, note: 'Клемма КСВ', mount: 'din' },
  ],
  circuits: [
    { id: 'demo-circuit-living', name: 'Розетки гостиной', loadName: 'Розетки гостиной', current: 16, power: 1500, phase: 1, protectionDeviceId: 'demo-qfi01', color: '#d65b43', wireCrossSection: 2.5, note: 'Демонстрационная цепь' },
    { id: 'demo-circuit-kitchen', name: 'Кухня', loadName: 'Кухня', current: 16, power: 2200, phase: 1, protectionDeviceId: 'demo-qfi02', color: '#d65b43', wireCrossSection: 2.5, note: 'Демонстрационная цепь' },
    { id: 'demo-circuit-light', name: 'Освещение', loadName: 'Освещение', current: 6, power: 720, phase: 1, protectionDeviceId: 'demo-qf02', color: '#d65b43', wireCrossSection: 1.5, note: 'Демонстрационная цепь' },
  ],
  /**
   * Every circuit is wired on all three buses. A single L-only connection was what the demo used
   * to carry, and it made the board look plausible while telling the reader nothing about where the
   * neutral and the earth go — and left the bus-completeness check reporting a gap on a fixture
   * that is meant to be clean.
   *
   * The earth and the neutral of the lighting circuit go to the terminal blocks, not to the
   * protective devices. QF02 is a single-pole breaker: it has one clamp, and that clamp is the
   * line. A 1P+N residual current device has two — line in, neutral out — and no earth at all, so
   * a PE wire drawn into either would enter a clamp that does not exist, and three wires would be
   * drawn on top of each other where the picture claimed one connection. XT01 is an N block (ПВ)
   * and XT02 a PE block (ЗБИ), which is where a real panel puts them.
   *
   * The check that reports this is new: it asks whether a device has a clamp of the bus being
   * connected, and the fixture says no for exactly these two lines. That is the rule working.
   */
  connections: [
    { id: 'demo-connection-living-l', circuitId: 'demo-circuit-living', fromBus: 'L', toDeviceId: 'demo-qfi01', color: '#d65b43', thickness: 2, label: 'L → QFI01' },
    { id: 'demo-connection-living-n', circuitId: 'demo-circuit-living', fromBus: 'N', toDeviceId: 'demo-qfi01', color: '#8a9599', thickness: 2, label: 'N → QFI01' },
    { id: 'demo-connection-living-pe', circuitId: 'demo-circuit-living', fromBus: 'PE', toDeviceId: 'demo-xt02', color: '#47a067', thickness: 2, label: 'PE → XT02 (1)' },
    { id: 'demo-connection-kitchen-l', circuitId: 'demo-circuit-kitchen', fromBus: 'L', toDeviceId: 'demo-qfi02', color: '#d65b43', thickness: 2, label: 'L → QFI02' },
    { id: 'demo-connection-kitchen-n', circuitId: 'demo-circuit-kitchen', fromBus: 'N', toDeviceId: 'demo-qfi02', color: '#8a9599', thickness: 2, label: 'N → QFI02' },
    { id: 'demo-connection-kitchen-pe', circuitId: 'demo-circuit-kitchen', fromBus: 'PE', toDeviceId: 'demo-xt02', terminal: 1, color: '#47a067', thickness: 2, label: 'PE → XT02 (2)' },
    { id: 'demo-connection-light-l', circuitId: 'demo-circuit-light', fromBus: 'L', toDeviceId: 'demo-qf02', color: '#d65b43', thickness: 2, label: 'L → QF02' },
    { id: 'demo-connection-light-n', circuitId: 'demo-circuit-light', fromBus: 'N', toDeviceId: 'demo-xt01', color: '#8a9599', thickness: 2, label: 'N → XT01' },
    // Two conductors under one screw is how a real terminal block takes three earth wires: the
    // block offers six screws, and the person wiring it decides which of them each circuit sits on.
    { id: 'demo-connection-light-pe', circuitId: 'demo-circuit-light', fromBus: 'PE', toDeviceId: 'demo-xt02', toSide: 'bottom', terminal: 0, color: '#47a067', thickness: 2, label: 'PE → XT02 (3)' },
    // A cascade: the lighting feed leaves the main breaker rather than the busbar. This is how most
    // real boards are wired, and until the wiring was routed to terminals it could not be drawn.
    { id: 'demo-connection-cascade-light', circuitId: 'demo-circuit-light', fromBus: 'L', toDeviceId: 'demo-qf02', color: '#d65b43', thickness: 2, label: 'QF01 → QF02', kind: 'busbar', fromDeviceId: 'demo-qf01' },
  ],
}
