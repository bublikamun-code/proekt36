import { describe, expect, it } from 'vitest'
import { buildBoardScene } from '../src/domain/boardScene'
import { busZoneBottomMm, BUS_ORDER } from '../src/domain/busRail'
import { faceTerminals, terminalForBus } from '../src/domain/wiring'
import { validateProject } from '../src/domain/validation'
import { migrateProject } from '../src/domain/project'
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
      // The named terminal wins over the bus: on a terminal block every screw carries the same bus,
      // and the wire says which one it enters.
      const terminal = terminalForBus(device.terminals, wire.bus, connection.toSide ?? 'top', connection.terminal)!

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
  /**
   * The buses the wiring comes from.
   *
   * A wire fed from the bus used to start at a fixed point in the left margin, six millimetres
   * above whichever device it served: the line came out of nothing, and the picture never said
   * where L, N and PE were. The rails now live in the margin above the first row, which the
   * geometry reserves for exactly this and which no device can reach.
   */
  it('рисует три шины над первым рядом и не залезает на него', () => {
    expect(scene.busRails.map((rail) => rail.bus)).toEqual(BUS_ORDER)
    const firstRow = scene.rails[0]!
    for (const rail of scene.busRails) {
      expect(rail.y + rail.height).toBeLessThanOrEqual(firstRow.y)
      expect(rail.x).toBeGreaterThanOrEqual(0)
      expect(rail.x + rail.width).toBeLessThanOrEqual(scene.width)
    }
    // Three rails stacked in the reserved margin, and the margin ends above the first row.
    expect(scene.busRails.at(-1)!.y + scene.busRails.at(-1)!.height).toBeLessThanOrEqual(busZoneBottomMm())
    expect(busZoneBottomMm()).toBeLessThan(firstRow.y)
  })

  it('ведёт каждый провод от своей шины, а не из левого поля', () => {
    const railBottom = new Map(scene.busRails.map((rail) => [rail.bus, rail.y + rail.height]))
    const fed = scene.wires.filter((wire) => Math.abs(wire.from.y - (railBottom.get(wire.bus) ?? -1)) < 0.01)
    // Every feed of the demo comes from a rail, and each from the rail of its own bus.
    expect(fed).toHaveLength(scene.wires.filter((wire) => wire.source === 'busbar').length)
    for (const wire of fed) {
      expect(wire.from.x).toBeGreaterThanOrEqual(scene.railStartX)
      expect(wire.from.x).toBeLessThanOrEqual(scene.railStartX + scene.capacity * scene.modulePitch)
    }
  })

  /**
   * No conductor through the body of a breaker.
   *
   * A feed to a lower row has to get past the rows above it. Drawn as a straight drop it goes
   * through whatever stands in the way, and the board then claims that a wire passes through a
   * device — which is not a drawing anybody can install from. The wire falls down a free module
   * boundary instead, the way it is run in the vertical duct of a real panel.
   */
  it('не проводит провод сквозь корпус аппарата', () => {
    /**
     * The segments of a path, read properly.
     *
     * Treating the numbers of a path as pairs of coordinates is wrong: "M 1 2 H 3 V 4" carries four
     * numbers and three points, not two. Reading them as pairs draws a diagonal across the board and
     * then reports a crossing that the router never drew.
     */
    const segmentsOf = (d: string) => {
      const points: { x: number; y: number }[] = []
      let cursor = { x: 0, y: 0 }
      for (const [, command, rest] of d.matchAll(/([MH VL])\s*([^MH VL]*)/g)) {
        const numbers = (rest.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
        if (command === 'M') cursor = { x: numbers[0]!, y: numbers[1]! }
        else if (command === 'H') cursor = { x: numbers[0]!, y: cursor.y }
        else if (command === 'V') cursor = { x: cursor.x, y: numbers[0]! }
        else cursor = { x: numbers[0]!, y: numbers[1]! }
        points.push(cursor)
      }
      return points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1]! }))
    }
    const inside = (device: typeof scene.devices[number], x: number, y: number) =>
      x > device.x + 0.3 && x < device.x + device.width - 0.3 && y > device.y + 0.3 && y < device.y + device.height - 0.3

    for (const wire of scene.wires) {
      // A wire has to enter the device it feeds and leave the one it comes from — those are the
      // clamps at its ends. It has no business crossing any other body on the way.
      const own = new Set([wire.toDeviceId, wire.fromDeviceId].filter(Boolean))
      for (const { from, to } of segmentsOf(wire.d)) {
        const steps = Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 0.25)
        for (let step = 0; step <= steps; step += 1) {
          const ratio = steps ? step / steps : 0
          const x = from.x + (to.x - from.x) * ratio
          const y = from.y + (to.y - from.y) * ratio
          for (const device of scene.devices) {
            if (own.has(device.instanceId)) continue
            if (inside(device, x, y)) {
              throw new Error(`провод ${wire.id} [${wire.d}] идёт сквозь ${device.instanceId} в точке ${x.toFixed(1)}, ${y.toFixed(1)}`)
            }
          }
        }
      }
    }
  })

  /**
   * Six devices fed from one rail would be six lines drawn on top of each other, and the drawing
   * would show one connection where there are six.
   */
  it('разводит провода одной связки, чтобы они не лежали друг на друге', () => {
    // One rail feeding three devices of the first row: the bundle is the rail and the row, so the
    // devices in a row are told apart by the row they stand in.
    const fed = scene.wires.filter((wire) => wire.fromName === 'шина L')
    const rows = new Map<number, typeof fed>()
    for (const wire of fed) {
      const list = rows.get(Math.round(wire.to.y))
      if (list) list.push(wire)
      else rows.set(Math.round(wire.to.y), [wire])
    }
    const bundle = [...rows.values()].sort((a, b) => b.length - a.length)[0]!
    expect(bundle.length).toBeGreaterThan(1)
    const starts = new Set(bundle.map((wire) => `${wire.from.x},${wire.from.y}`))
    expect(starts.size).toBe(bundle.length)
  })

  it('ведёт каскад вверх, когда аппарат назначения выше', () => {
    // QF01 sits in the first row and QF02 in the second, so a feed from QF02 down to QF01 is the
    // one case where the run has to climb instead of dropping.
    const upward = buildBoardScene({
      ...demoProject,
      connections: [{
        id: 'up', circuitId: '', fromBus: 'L', toDeviceId: 'demo-qf01',
        color: '#a44d37', thickness: 2, label: 'QF02 → QF01', kind: 'busbar', fromDeviceId: 'demo-qf02',
      }],
    }, definitions)
    const wire = upward.wires.find((item) => item.id === 'up')!
    expect(wire).toBeDefined()
    // The path leaves the source, and never drops below the clamp it is going into.
    expect(wire.from.y).toBeGreaterThan(wire.to.y)
    const ys = (wire.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, index) => index % 2 === 1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(wire.to.y - 1)
  })
})

describe('запитка от шины щита в правилах', () => {
  const base = demoProject
  const feed = { id: 'feed-pe', circuitId: '', fromBus: 'PE' as const, toDeviceId: 'demo-qfi03', color: '#47a067', thickness: 2, label: 'PE → QFI03', kind: 'bus' as const }

  it('не считается подключением без цепи', () => {
    const issues = validateProject({ ...base, connections: [...base.connections, feed] }, definitions)
    expect(issues.filter((entry) => entry.ruleCode === 'connection.circuit.missing')).toEqual([])
  })

  it('ловит запись, которая называет аппарат-источник', () => {
    const issues = validateProject({
      ...base,
      connections: [...base.connections, { ...feed, fromDeviceId: 'demo-qf01' }],
    }, definitions)
    expect(issues.some((entry) => entry.ruleCode === 'connection.bus.source.unexpected')).toBe(true)
  })

  it('переживает чтение и запись проекта', () => {
    const migrated = migrateProject({ ...structuredClone(base), connections: [...structuredClone(base.connections), { ...feed }] })
    const written = migrated.connections.find((connection) => connection.id === feed.id)
    expect(written?.kind).toBe('bus')
    // And an older record with no kind at all keeps meaning what it meant.
    const legacy = migrateProject({
      ...structuredClone(base),
      connections: [{ id: 'legacy', circuitId: '', fromBus: 'L', toDeviceId: 'demo-qf03', color: '#a44d37', thickness: 2, label: 'L → QF03' }],
    })
    expect(legacy.connections[0]?.kind).toBe('circuit')
  })
})

/**
 * A terminal block is six screws, not two.
 *
 * It used to offer one terminal at the top and one at the bottom, both of them the leftmost screw,
 * so four of its screws could not be connected to and three wires arriving at the same block were
 * drawn on top of each other. That is the one thing a terminal block is not: the place where the
 * circuits of a panel come together, and where more than one wire always lands on the same screw.
 */
describe('клеммная колодка', () => {
  const block = definitions.get('iek-terminal-1p-blue')!

  it('отдаёт каждый винт как отдельный зажим', () => {
    const terminals = faceTerminals(block)
    // A six-screw block: two on the top row and four below it, numbered as it is numbered on the face.
    expect(terminals.top.map((terminal) => terminal.label)).toEqual(['1', '2'])
    expect(terminals.bottom.map((terminal) => terminal.label)).toEqual(['3', '4', '5', '6'])
    // A PE block is PE throughout, which is what makes the screws interchangeable to the person wiring it.
    expect([...terminals.top, ...terminals.bottom].every((terminal) => terminal.bus === 'PE')).toBe(true)
    // And no two terminals share a point on the face.
    const points = [...terminals.top, ...terminals.bottom].map((terminal) => `${terminal.x.toFixed(2)}:${terminal.y.toFixed(2)}`)
    expect(new Set(points).size).toBe(points.length)
  })

  it('ведёт каждый провод к своему винту', () => {
    const project: PanelProject = {
      ...demoProject,
      connections: [
        { id: 'first', circuitId: '', fromBus: 'PE', toDeviceId: 'demo-xt02', color: '#47a067', thickness: 2, label: 'PE → XT02 (1)', kind: 'bus' },
        { id: 'second', circuitId: '', fromBus: 'PE', toDeviceId: 'demo-xt02', terminal: 1, color: '#47a067', thickness: 2, label: 'PE → XT02 (2)', kind: 'bus' },
      ],
    }
    const built = buildBoardScene(project, definitions)
    const block2 = built.devices.find((device) => device.instanceId === 'demo-xt02')!
    const first = built.wires.find((wire) => wire.id === 'first')!
    const second = built.wires.find((wire) => wire.id === 'second')!
    expect(endOf(first.d).x).toBeCloseTo(block2.x + block2.terminals.top[0]!.x, 1)
    expect(endOf(second.d).x).toBeCloseTo(block2.x + block2.terminals.top[1]!.x, 1)
    // Two wires to the same block are two wires, not a duplicate that the second one is refused for.
    expect(validateProject(project, definitions).filter((entry) => entry.ruleCode === 'connection.duplicate')).toEqual([])
  })

  it('ловит зажим, которого у колодки нет', () => {
    const project: PanelProject = {
      ...demoProject,
      connections: [{ id: 'nowhere', circuitId: '', fromBus: 'PE', toDeviceId: 'demo-xt02', terminal: 9, color: '#47a067', thickness: 2, label: 'PE → XT02 (10)', kind: 'bus' }],
    }
    const issues = validateProject(project, definitions)
    expect(issues.some((entry) => entry.ruleCode === 'connection.terminal.missing')).toBe(true)
  })

  it('ловит шину, которой у аппарата нет', () => {
    // A single-pole breaker has one clamp and it is the line: there is nowhere else for a neutral to go.
    const project: PanelProject = {
      ...demoProject,
      connections: [{ id: 'neutral-into-mcb', circuitId: '', fromBus: 'N', toDeviceId: 'demo-qf02', color: '#8a9599', thickness: 2, label: 'N → QF02', kind: 'bus' }],
    }
    const issues = validateProject(project, definitions)
    expect(issues.some((entry) => entry.ruleCode === 'connection.clamp.bus.missing')).toBe(true)
  })
})
