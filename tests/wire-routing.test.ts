import { describe, expect, it } from 'vitest'
import { workspaceCatalog } from '../src/data/catalog'
import { demoProject } from '../src/data/demoProject'
import { buildBoardScene } from '../src/domain/boardScene'
import { manualWireSegments } from '../src/domain/wiring'
import type { Connection, WirePoint, WireRoute } from '../src/domain/types'

const firstPoint = (d: string): WirePoint => {
  const [, x, y] = d.match(/^M (-?[\d.]+) (-?[\d.]+)/)!
  return { x: Number(x), y: Number(y) }
}
const lastPoint = (d: string): WirePoint => {
  const coordinates = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  return { x: coordinates.at(-2)!, y: coordinates.at(-1)! }
}

// Straight runs must be axis-aligned. Curves may only round an orthogonal corner, with their
// control point aligned with both their start and end, rather than introducing a diagonal.
const expectOrthogonal = (d: string) => {
  let cursor = firstPoint(d)
  for (const [, command, values] of d.matchAll(/([LQ])\s*([^LQM]+)/g)) {
    const numbers = values!.trim().split(/\s+/).map(Number)
    const control = { x: numbers[0]!, y: numbers[1]! }
    expect(cursor.x === control.x || cursor.y === control.y).toBe(true)
    if (command === 'Q') {
      const end = { x: numbers[2]!, y: numbers[3]! }
      expect(control.x === end.x || control.y === end.y).toBe(true)
      cursor = end
    } else cursor = control
  }
}

const route: WireRoute = {
  points: [{ x: 20, y: 40 }, { x: 60, y: 40 }],
  segmentLayers: ['rear', 'front', 'rear'],
}

describe('manual orthogonal wire runs', () => {
  it('preserves clicked anchors exactly and assigns a layer to each run', () => {
    const from = { x: 10, y: 10 }
    const to = { x: 80, y: 90 }
    const before = structuredClone(route)
    const segments = manualWireSegments(from, to, route)
    expect(segments.map((segment) => segment.layer)).toEqual(['rear', 'front', 'rear'])
    expect(segments.map((segment) => segment.index)).toEqual([0, 1, 2])
    const anchors = [from, ...route.points, to]
    segments.forEach((segment, index) => {
      expect(firstPoint(segment.d)).toEqual(anchors[index])
      expect(lastPoint(segment.d)).toEqual(anchors[index + 1])
      expectOrthogonal(segment.d)
    })
    expect(segments[0]!.d).toContain(' Q ')
    expect(segments[1]!.d).not.toContain(' Q ')
    expect(route).toEqual(before)
  })

  it('keeps source exit and target entry vertical when anchors are diagonal from their contacts', () => {
    const segments = manualWireSegments({ x: 10, y: 10 }, { x: 80, y: 90 }, route)
    expect(segments[0]!.d).toMatch(/^M 10 10 L 10 /)
    expect(segments.at(-1)!.d).toMatch(/Q 80 40 80 42 L 80 90$/)
  })

  it('supports a whole-wire layer choice with no interior anchors', () => {
    const segments = manualWireSegments({ x: 0, y: 0 }, { x: 30, y: 40 }, { points: [], segmentLayers: ['front'] })
    expect(segments).toHaveLength(1)
    expect(segments[0]!.layer).toBe('front')
    expect(firstPoint(segments[0]!.d)).toEqual({ x: 0, y: 0 })
    expect(lastPoint(segments[0]!.d)).toEqual({ x: 30, y: 40 })
    expect(segments[0]!.d).toMatch(/^M 0 0 L 0 /)
    expect(segments[0]!.d).toMatch(/ L 30 40$/)
    expectOrthogonal(segments[0]!.d)
  })

  it('limits rounding on short runs and never overshoots the endpoints', () => {
    const segments = manualWireSegments({ x: 0, y: 0 }, { x: 3, y: 4 }, {
      points: [{ x: 1, y: 1 }], segmentLayers: ['rear', 'front'],
    })
    expect(segments[0]!.d).toBe('M 0 0 L 0 0.5 Q 0 1 0.5 1 L 1 1')
    segments.forEach(({ d }) => {
      expectOrthogonal(d)
      expect(d).not.toMatch(/NaN|Infinity/)
    })
  })

  it('retains run indices for coincident anchors without creating invalid SVG', () => {
    const point = { x: 7, y: 9 }
    const segments = manualWireSegments(point, { x: 10, y: 9 }, {
      points: [point, point], segmentLayers: ['rear', 'front', 'rear'],
    })
    expect(segments).toHaveLength(3)
    expect(segments.map(({ index }) => index)).toEqual([0, 1, 2])
    expect(segments[0]!.d).toBe('M 7 9')
    expect(segments[1]!.d).toBe('M 7 9')
    expect(segments[2]!.d).toBe('M 7 9 L 10 9')
  })
})

const definitions = new Map(workspaceCatalog.map((product) => [product.id, product]))
const cascade: Connection = {
  id: 'manual-cascade', circuitId: '', kind: 'busbar', fromBus: 'L',
  fromDeviceId: 'demo-qf01', fromSide: 'bottom', fromTerminal: 0,
  toDeviceId: 'demo-qf02', toSide: 'top', terminal: 0,
  color: '#a44d37', thickness: 2, label: 'Ручная трасса', route,
}

describe('manual routes in the board scene', () => {
  it('exposes resolved endpoints and anchors without allowing an editor to mutate saved data', () => {
    const project = { ...structuredClone(demoProject), connections: [structuredClone(cascade)] }
    const scene = buildBoardScene(project, definitions)
    const wire = scene.wires[0]!
    expect(wire.routePoints).toEqual([wire.from, ...route.points, { x: wire.to.x, y: wire.to.y }])
    expect(wire.segments).toEqual(manualWireSegments(wire.from, wire.to, route))
    expect(wire.d).toBe(wire.segments.map(({ d }) => d).join(' '))
    wire.routePoints[1]!.x = -200
    expect(project.connections[0]!.route).toEqual(route)
  })

  it('moves both endpoint clamps with their devices while retaining interior anchors and layers', () => {
    const project = { ...structuredClone(demoProject), connections: [structuredClone(cascade)] }
    const before = buildBoardScene(project, definitions).wires[0]!
    project.devices.find((device) => device.instanceId === 'demo-qf01')!.slot += 2
    project.devices.find((device) => device.instanceId === 'demo-qf02')!.row += 1
    const after = buildBoardScene(project, definitions).wires[0]!
    expect(after.from.x).not.toBe(before.from.x)
    expect(after.to.y).not.toBe(before.to.y)
    expect(after.routePoints.slice(1, -1)).toEqual(route.points)
    expect(after.segments.map(({ layer }) => layer)).toEqual(route.segmentLayers)
    expect(firstPoint(after.d).x).toBeCloseTo(after.from.x, 2)
    expect(lastPoint(after.d).y).toBeCloseTo(after.to.y, 2)
    expect(after.segments[1]).toEqual(before.segments[1])
  })

  it('anchors a manual bus tap to the first waypoint without spreading it when other wires change', () => {
    const feed: Connection = { ...cascade, id: 'manual-bus', kind: 'bus', fromDeviceId: undefined,
      route: { points: [{ x: 60, y: 40 }, { x: 100, y: 40 }], segmentLayers: ['rear', 'front', 'rear'] } }
    const project = { ...structuredClone(demoProject), connections: [feed] }
    const before = buildBoardScene(project, definitions).wires[0]!
    expect(before.from.x).toBe(feed.route!.points[0]!.x)
    project.connections.push({ ...feed, id: 'another', route: undefined, toDeviceId: 'demo-qf03' })
    project.devices.find((device) => device.instanceId === feed.toDeviceId)!.slot += 1
    const after = buildBoardScene(project, definitions).wires.find((wire) => wire.id === feed.id)!
    expect(after.from).toEqual(before.from)
    expect(after.segments[0]).toEqual(before.segments[0])
  })

  it('clamps only a rail tap to its visible bounds, never the manual anchors', () => {
    const feed: Connection = { ...cascade, kind: 'bus', fromDeviceId: undefined,
      route: { points: [{ x: 5000, y: 40 }], segmentLayers: ['front', 'rear'] } }
    const scene = buildBoardScene({ ...demoProject, connections: [feed] }, definitions)
    const rail = scene.busRails.find((item) => item.bus === 'L')!
    expect(scene.wires[0]!.from.x).toBe(rail.x + rail.width)
    expect(scene.wires[0]!.routePoints[1]).toEqual({ x: 5000, y: 40 })
  })

  it('exposes unchanged automatic geometry as one rear run', () => {
    const scene = buildBoardScene(demoProject, definitions)
    for (const wire of scene.wires) {
      expect(wire.segments).toEqual([{ d: wire.d, layer: 'rear', index: 0 }])
      expect(wire.routePoints).toEqual([wire.from, { x: wire.to.x, y: wire.to.y }])
      expect(wire.d).not.toContain('Q')
    }
  })

  it('does not use a manual route to bypass invalid physical endpoints', () => {
    const badSource = { ...cascade, fromTerminal: 99 }
    const badTarget = { ...cascade, terminal: 99 }
    expect(buildBoardScene({ ...demoProject, connections: [badSource, badTarget] }, definitions).wires).toEqual([])
  })
})


/** Read rendered straight polyline vertices, discarding repeated segment move points. */
const straightVertices = (path: string): WirePoint[] => {
  let cursor = { x: 0, y: 0 }
  const points: WirePoint[] = []
  for (const [, command, values] of path.matchAll(/([MLHV])\s*([^MLHV]+)/g)) {
    const numbers = values!.trim().split(/\s+/).map(Number)
    if (command === 'H') cursor = { x: numbers[0]!, y: cursor.y }
    else if (command === 'V') cursor = { x: cursor.x, y: numbers[0]! }
    else cursor = { x: numbers[0]!, y: numbers[1]! }
    const last = points.at(-1)
    if (!last || last.x !== cursor.x || last.y !== cursor.y) points.push(cursor)
  }
  return points
}

describe('preserving existing routes when opening the manual editor', () => {
  it('seeds all automatic demo wires with their rendered bends, taps and rear layers', () => {
    const original = buildBoardScene(demoProject, definitions)
    for (const wire of original.wires) {
      const editedProject = { ...demoProject, connections: demoProject.connections.map((connection) =>
        connection.id === wire.id ? { ...connection, route: wire.editableRoute } : connection) }
      const converted = buildBoardScene(editedProject, definitions).wires.find((item) => item.id === wire.id)!
      expect(converted.from).toEqual(wire.from)
      expect(converted.to).toEqual(wire.to)
      expect(converted.segments.every((segment) => segment.layer === 'rear')).toBe(true)
      expect(straightVertices(converted.d), wire.id).toEqual(straightVertices(wire.d))
      expect(converted.d).not.toContain('Q')
    }
  })

  it('provides a detached seed for an existing manual route', () => {
    const project = { ...structuredClone(demoProject), connections: [structuredClone(cascade)] }
    const wire = buildBoardScene(project, definitions).wires[0]!
    expect(wire.editableRoute).toEqual(route)
    wire.editableRoute.points[0]!.x = 900
    wire.editableRoute.segmentLayers[0] = 'front'
    expect(project.connections[0]!.route).toEqual(route)
  })
})
