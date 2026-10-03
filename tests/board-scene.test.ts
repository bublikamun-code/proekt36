import { describe, expect, it } from 'vitest'
import { buildBoardScene } from '../src/domain/boardScene'
import { demoProject } from '../src/data/demoProject'
import { workspaceCatalog } from '../src/data/catalog'
import type { PanelProject } from '../src/domain/types'

const definitions = new Map(workspaceCatalog.map((product) => [product.id, product]))
const scene = buildBoardScene(demoProject, definitions)

/** The last point of a path like "M 3 12 H 40 V 20 L 40 24". */
const endOf = (d: string) => {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  return { x: numbers.at(-2) ?? NaN, y: numbers.at(-1) ?? NaN }
}

describe('сцена доски', () => {
  it('рисует рейки, аппараты и провода в одних миллиметрах', () => {
    expect(scene.rails).toHaveLength(demoProject.settings.rows)
    expect(scene.devices).toHaveLength(demoProject.devices.length)
    expect(scene.devices.every((device) => device.x >= 0 && device.y >= 0)).toBe(true)
    expect(scene.wires.length).toBeGreaterThan(0)
  })

  it('кладёт конец каждого провода в зажим того аппарата, куда он приходит', () => {
    const byId = new Map(scene.devices.map((device) => [device.instanceId, device]))
    for (const wire of scene.wires) {
      const connection = demoProject.connections.find((item) => item.id === wire.id)!
      const device = byId.get(connection.toDeviceId)!
      const terminal = device.terminals.top.find((item) => item.bus === wire.bus) ?? device.terminals.top[0]

      // The path carries two decimals, which is a tenth of a millimetre — finer than the clamp.
      const end = endOf(wire.d)
      // The point is the centre of the clamp, in the same millimetres the clamp is drawn from.
      expect(end.x).toBeCloseTo(device.x + terminal.x, 1)
      expect(end.y).toBeCloseTo(device.y + terminal.y, 1)
      // And it is genuinely inside the clamp, not merely at the same x.
      expect(Math.abs(end.x - (device.x + terminal.x))).toBeLessThan(terminal.width / 2)
      expect(Math.abs(end.y - (device.y + terminal.y))).toBeLessThan(terminal.height / 2)
    }
  })

  it('отличает каскад от прямой запитки шиной', () => {
    const cascade = scene.wires.find((wire) => wire.source === 'device')
    const direct = scene.wires.find((wire) => wire.source === 'busbar')
    expect(cascade).toBeDefined()
    expect(direct).toBeDefined()
    // A cascade leaves the bottom terminal of another device and has to come back up.
    expect(cascade!.d).toMatch(/^M [\d.]+ [\d.]+ V/)
    expect(direct!.d).toMatch(/^M [\d.]+ [\d.]+ H/)
  })

  it('показывает отсутствующий товар как заглушку, а не как дыру в доске', () => {
    const broken: PanelProject = {
      ...demoProject,
      devices: [{ ...demoProject.devices[0]!, productId: 'no-such-product' }],
      connections: [],
    }
    const withHole = buildBoardScene(broken, definitions)
    expect(withHole.devices[0]!.missingProduct).toBe(true)
    expect(withHole.devices[0]!.width).toBeGreaterThan(0)
    expect(withHole.devices[0]!.face.widthMm).toBeGreaterThan(0)
  })

  it('назначает зажимам шины, а не номера столбцов', () => {
    // A 230 V residual current device switches the line and the neutral: L, then N.
    const rcbo = scene.devices.find((device) => device.category === 'RCBO')!
    expect(rcbo.terminals.top.map((item) => item.bus)).toEqual(['L', 'N'])

    // A three-phase breaker at 400 V switches three lines. Calling its last terminal a neutral
    // would put a single-phase neutral wire into a phase clamp, so it stays a line.
    const threePhase = buildBoardScene(
      { ...demoProject, devices: [{ ...demoProject.devices[0]!, productId: 'ekf-mcb-3p-c25' }], connections: [] },
      definitions,
    ).devices[0]!
    expect(threePhase.terminals.top.map((item) => item.bus)).toEqual(['L', 'L', 'L'])

    // A 400 V residual current device with three poles or more does carry the neutral, last.
    const rccb = buildBoardScene(
      { ...demoProject, devices: [{ ...demoProject.devices[0]!, productId: 'ekf-rccb-4p-40' }], connections: [] },
      definitions,
    ).devices[0]!
    expect(rccb.terminals.top.map((item) => item.bus)).toEqual(['L', 'L', 'L', 'N'])
  })
})
