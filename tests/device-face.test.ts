import { describe, expect, it } from 'vitest'
import { allCatalog, builtinCatalog } from '../src/data/catalog'
import {
  FACE_MODULE_MM,
  faceDetailFor,
  faceLabels,
  faceSharedToggle,
  faceShellFamily,
  faceTerminalColumns,
  fitFaceText,
  getDeviceFaceMetrics,
} from '../src/components/catalog/deviceFace/metrics'
import type { DeviceDefinition } from '../src/domain/types'
import { closedPolylinePath, polylinePath } from '../src/components/catalog/deviceFace/path'

const definitions = new Map(allCatalog.map((product) => [product.id, product]))
const product = (id: string): DeviceDefinition => {
  const found = definitions.get(id)
  if (!found) throw new Error(`Нет позиции каталога ${id}`)
  return found
}

describe('frontal device face geometry', () => {
  it('derives the face width from module width, not quantity', () => {
    const metrics = getDeviceFaceMetrics(product('ekf-mcb-3p-c25'))
    expect(metrics.moduleWidth).toBe(3)
    expect(metrics.widthMm).toBeCloseTo(3 * FACE_MODULE_MM)
    expect(metrics.heightMm).toBe(82)
  })

  it('keeps a 1P face minimal so tiny labels are not drawn', () => {
    const metrics = getDeviceFaceMetrics(product('ekf-mcb-1p-c6'))
    expect(metrics.detail).toBe('minimal')
    expect(faceDetailFor(metrics.widthMm)).toBe('minimal')
    expect(faceDetailFor(28)).toBe('compact')
    expect(faceDetailFor(2 * FACE_MODULE_MM)).toBe('full')
    expect(faceDetailFor(4 * FACE_MODULE_MM)).toBe('full')
  })

  it('draws one shared lever for a linked 1P+N device and one lever per pole otherwise', () => {
    const linked = product('ekf-rcbo-1p-c16')
    expect(linked.moduleWidth).toBeGreaterThan(linked.poles)
    expect(faceSharedToggle(linked)).toBe(true)
    const linkedFace = getDeviceFaceMetrics(linked)
    expect(linkedFace.toggles).toHaveLength(1)
    expect(linkedFace.toggles[0]!.shared).toBe(true)

    const twoPole = product('ekf-rccb-2p-25')
    expect(faceSharedToggle(twoPole)).toBe(false)
    const twoPoleFace = getDeviceFaceMetrics(twoPole)
    expect(twoPoleFace.toggles).toHaveLength(twoPoleFace.columns)
    expect(twoPoleFace.toggles.every((toggle) => !toggle.shared)).toBe(true)

    const onePole = getDeviceFaceMetrics(product('ekf-mcb-1p-c6'))
    expect(onePole.toggles).toHaveLength(1)
  })

  it('gives every terminal column a pocket above and below, inside the body', () => {
    for (const id of ['ekf-mcb-1p-c6', 'ekf-rcbo-1p-c16', 'ekf-rccb-4p-40', 'ekf-meter-3p', 'iek-terminal-1p-gray']) {
      const face = getDeviceFaceMetrics(product(id))
      const columns = faceTerminalColumns(product(id))
      const top = face.pockets.filter((pocket) => pocket.y < face.heightMm / 2)
      const bottom = face.pockets.filter((pocket) => pocket.y >= face.heightMm / 2)
      expect(top).toHaveLength(columns)
      expect(bottom).toHaveLength(columns)
      for (const pocket of face.pockets) {
        expect(pocket.x).toBeGreaterThanOrEqual(face.body.x)
        expect(pocket.x + pocket.width).toBeLessThanOrEqual(face.body.x + face.body.width + 0.01)
        expect(pocket.y).toBeGreaterThanOrEqual(face.body.y)
        expect(pocket.y + pocket.height).toBeLessThanOrEqual(face.body.y + face.body.height)
      }
    }
  })

  it('labels linked 1P+N terminals as 1/N above and 3/4 below', () => {
    const face = getDeviceFaceMetrics(product('ekf-rcbo-1p-c16'))
    const top = face.pockets.filter((pocket) => pocket.y < face.heightMm / 2)
    const bottom = face.pockets.filter((pocket) => pocket.y >= face.heightMm / 2)
    expect(top.map((pocket) => pocket.topLabel)).toEqual(['1', 'N'])
    expect(bottom.map((pocket) => pocket.bottomLabel)).toEqual(['3', '4'])
  })

  it('truncates labels that cannot fit their field', () => {
    expect(fitFaceText('AVO-10', 6, 2.4)).toBe('AVO…')
    expect(fitFaceText('16A', 20, 2.4)).toBe('16A')
  })

  it('keeps printed text inside the body', () => {
    for (const definition of builtinCatalog) {
      const metrics = getDeviceFaceMetrics(definition)
      for (const label of faceLabels(definition, metrics)) {
        expect(label.x).toBeGreaterThanOrEqual(metrics.body.x - 0.01)
        expect(label.x).toBeLessThanOrEqual(metrics.body.x + metrics.body.width + 0.01)
        expect(label.y).toBeGreaterThanOrEqual(metrics.body.y)
        expect(label.y).toBeLessThanOrEqual(metrics.body.y + metrics.body.height)
        expect(label.text.length * label.size * 0.62).toBeLessThanOrEqual(metrics.widthMm)
      }
    }
  })

  it('renders every catalog product without NaN geometry', () => {
    for (const definition of builtinCatalog) {
      const face = getDeviceFaceMetrics(definition)
      for (const value of [face.widthMm, face.heightMm, face.body.width, face.body.height, face.markArea.width]) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThan(0)
      }
    }
  })
})

describe('2.5D face relief', () => {
  it('cuts a chamfered outline and recessed centre panel inside the body for every device', () => {
    for (const definition of builtinCatalog) {
      const face = getDeviceFaceMetrics(definition)
      expect(face.outline).toHaveLength(8)
      for (const point of face.outline) {
        expect(point.x).toBeGreaterThanOrEqual(face.body.x - 0.01)
        expect(point.x).toBeLessThanOrEqual(face.body.x + face.body.width + 0.01)
        expect(point.y).toBeGreaterThanOrEqual(face.body.y - 0.01)
        expect(point.y).toBeLessThanOrEqual(face.body.y + face.body.height + 0.01)
      }
      // The top corners are cut, the bottom only slightly: a moulded case, not a plain rectangle.
      const topCut = face.outline[1]!.x - face.body.x
      const bottomCut = face.outline[6]!.x - face.body.x
      expect(topCut).toBeGreaterThan(0.5)
      expect(bottomCut).toBeGreaterThanOrEqual(0)
      expect(topCut).toBeGreaterThan(bottomCut)

      // The centre panel is sunk inside the shell on every side.
      expect(face.panel.x).toBeGreaterThan(face.body.x)
      expect(face.panel.y).toBeGreaterThan(face.body.y)
      expect(face.panel.x + face.panel.width).toBeLessThan(face.body.x + face.body.width)
      expect(face.panel.y + face.panel.height).toBeLessThan(face.body.y + face.body.height)
      expect(face.sidewalls).toHaveLength(2)
    }
  })

  it('draws every terminal as a two-stage recess with a screw inside the well', () => {
    for (const definition of builtinCatalog) {
      const face = getDeviceFaceMetrics(definition)
      for (const pocket of face.pockets) {
        expect(pocket.well.x).toBeGreaterThanOrEqual(pocket.x)
        expect(pocket.well.y).toBeGreaterThanOrEqual(pocket.y)
        expect(pocket.well.x + pocket.well.width).toBeLessThanOrEqual(pocket.x + pocket.width + 0.01)
        expect(pocket.well.y + pocket.well.height).toBeLessThanOrEqual(pocket.y + pocket.height)
        expect(pocket.screw.cx).toBeGreaterThan(pocket.well.x)
        expect(pocket.screw.cx).toBeLessThan(pocket.well.x + pocket.well.width)
        expect(pocket.screw.cy).toBeGreaterThan(pocket.well.y)
        expect(pocket.screw.cy).toBeLessThan(pocket.well.y + pocket.well.height)
        expect(pocket.screw.r).toBeGreaterThan(0)
        // Pockets sit on the recessed panel, never over its edge.
        expect(pocket.y).toBeGreaterThanOrEqual(face.panel.y)
        expect(pocket.y + pocket.height).toBeLessThanOrEqual(face.panel.y + face.panel.height + 0.01)
      }
    }
  })

  it('shapes the lever as an asymmetric paddle with a seat, grips and highlight', () => {
    const face = getDeviceFaceMetrics(product('ekf-mcb-3p-c25'))
    for (const toggle of face.toggles) {
      expect(toggle.points).toHaveLength(4)
      const [topLeft, topRight, bottomRight, bottomLeft] = toggle.points
      // The grip end is narrower than the pivot end, so the lever is not a rectangle.
      expect(topRight!.x - topLeft!.x).toBeLessThan(toggle.width)
      expect(topLeft!.x).toBeGreaterThan(toggle.x)
      expect(topRight!.x).toBeLessThan(toggle.x + toggle.width)
      expect(bottomLeft!.x).toBe(toggle.x)
      expect(bottomRight!.x).toBe(toggle.x + toggle.width)
      // It leans off-axis.
      expect(topLeft!.y).toBeLessThan(bottomLeft!.y)
      expect(topLeft!.y).not.toBe(topRight!.y)
      for (const point of toggle.points) {
        expect(point.x).toBeGreaterThanOrEqual(face.body.x - 0.01)
        expect(point.x).toBeLessThanOrEqual(face.body.x + face.body.width + 0.01)
        expect(point.y).toBeGreaterThanOrEqual(face.body.y - 0.01)
        expect(point.y).toBeLessThanOrEqual(face.body.y + face.body.height + 0.01)
      }
      expect(toggle.grips).toHaveLength(3)
      for (const grip of toggle.grips) {
        expect(grip[0]!.x).toBeLessThan(grip[1]!.x)
        expect(grip[0]!.x).toBeGreaterThanOrEqual(toggle.x)
        expect(grip[1]!.x).toBeLessThanOrEqual(toggle.x + toggle.width)
      }
      expect(toggle.shine[0]!.x).toBeLessThan(toggle.shine[1]!.x)
      // The seat frames the paddle without leaving the case.
      expect(toggle.seat.x).toBeGreaterThanOrEqual(face.body.x)
      expect(toggle.seat.x + toggle.seat.width).toBeLessThanOrEqual(face.body.x + face.body.width + 0.01)
    }
  })

  it('keeps the shared 1P+N lever inside a one-module case', () => {
    const face = getDeviceFaceMetrics(product('ekf-rcbo-1p-c16'))
    expect(face.toggles).toHaveLength(1)
    const [lever] = face.toggles
    for (const point of lever!.points) {
      expect(point.x).toBeGreaterThanOrEqual(face.body.x)
      expect(point.x).toBeLessThanOrEqual(face.body.x + face.body.width)
    }
    expect(lever!.seat.x).toBeGreaterThanOrEqual(face.body.x)
    expect(lever!.seat.x + lever!.seat.width).toBeLessThanOrEqual(face.body.x + face.body.width)
  })

  it('groups catalog devices into a small set of neutral shell families', () => {
    expect(faceShellFamily(product('ekf-mcb-1p-c6'))).toBe('light')
    expect(faceShellFamily(product('ekf-contactor-2p-25'))).toBe('warm')
    expect(faceShellFamily(product('enmas-nb1-63h-2p-40a-c'))).toBe('light')
    expect(faceShellFamily(product('enmas-nu6-iig-2p-440v'))).toBe('graphite')
    expect(faceShellFamily(product('meanwell-psu-24v-10a'))).toBe('psu')
    expect(faceShellFamily(product('ekf-mcb-1p-c6'))).not.toBe(faceShellFamily(product('ekf-contactor-2p-25')))
    const families = new Set(allCatalog.map(faceShellFamily))
    expect(families.size).toBeGreaterThan(1)
    expect(families.size).toBeLessThanOrEqual(7)
  })
})

/**
 * A path that does not open with a moveto command is a parse error, and the browser drops it
 * without drawing anything: the chassis outline, the lever and its grips simply vanish while the
 * markup still looks complete. Nothing else in the suite could see that, because the markup was
 * correct and only the value of `d` was not.
 */
describe('drawn device face paths', () => {
  const startsWithMoveto = (path: string) => /^[Mm]/.test(path)

  it('opens every polyline with a moveto command', () => {
    expect(polylinePath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M 1 2 L 3 4')
    expect(closedPolylinePath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M 1 2 L 3 4 Z')
  })

  it('returns an empty path rather than a bare moveto for no points', () => {
    expect(polylinePath([])).toBe('')
    expect(closedPolylinePath([])).toBe('')
  })

  it('produces a drawable path for the outline and levers of every catalog device', () => {
    let checked = 0
    for (const definition of allCatalog) {
      const metrics = getDeviceFaceMetrics(definition)
      const paths = [
        closedPolylinePath(metrics.outline),
        ...metrics.toggles.flatMap((toggle) => [
          closedPolylinePath(toggle.points),
          ...toggle.grips.map((grip) => polylinePath(grip)),
          polylinePath(toggle.shine),
        ]),
      ]
      for (const path of paths) {
        expect(path, `устройство ${definition.id}`).not.toBe('')
        expect(startsWithMoveto(path), `устройство ${definition.id}: ${path}`).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
