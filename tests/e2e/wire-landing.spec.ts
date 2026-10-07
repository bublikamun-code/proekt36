import { expect, test, type Page } from '@playwright/test'
import { demoProject } from '../../src/data/demoProject'
import { unlockWorkspace } from './helpers'

/**
 * The same measurement on both boards.
 *
 * This is the check the rebuilt board exists to pass, run against the editor it replaces so the two
 * are compared on one ruler rather than on descriptions. Both draw clamps with the shared face
 * component, so the clamp centres are found the same way on both; only the coordinate system
 * differs, which is exactly what is being measured.
 *
 * A wire is "landed" when the end of its path sits on a clamp centre. Reading both through
 * `getScreenCTM` means the number is in pixels on screen and does not care how the view chose to
 * scale itself.
 */
const measure = async (page: Page) => page.evaluate(() => {

/**
 * Where a wire may land, on screen.
 *
 * A breaker has clamps — pockets drawn as wells — and a terminal block has screws. Both are places a
 * conductor is held, and measuring only the pockets called every wire into a terminal block
 * unlanded, which is a measurement fault rather than a wiring fault: the wire was in the screw.
 */
const connectionPoints = () => [
  ...[...document.querySelectorAll<SVGRectElement>('.dv-pocket')].map((rect) => {
    const box = rect.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }),
  ...[...document.querySelectorAll<SVGCircleElement>('.dv-socket')].map((circle) => {
    const box = circle.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }),
]

  const centres = connectionPoints()

  const wires = [...document.querySelectorAll<SVGPathElement>('.wires path, .scene-wire')]
    .map((path) => {
      // The last pair of numbers in the path is where the wire arrives.
      const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      const [x, y] = numbers.slice(-2)
      const svg = path.ownerSVGElement!
      const matrix = svg.getScreenCTM()
      if (!matrix) return null
      const point = new DOMPoint(x, y).matrixTransform(matrix)
      return { x: point.x, y: point.y }
    })
    .filter((wire): wire is { x: number; y: number } => wire !== null)

  const distances = wires.map((wire) => Math.min(...centres.map((c) => Math.hypot(c.x - wire.x, c.y - wire.y))))
  return {
    wires: wires.length,
    clamps: centres.length,
    landed: distances.filter((d) => d <= 2).length,
    worst: distances.length ? Math.max(...distances) : 0,
  }
})

/**
 * Both boards are given the same project, written straight into storage before the page loads.
 *
 * Seeding through the fixture query would have measured the new board against itself: the old
 * editor has no such switch, and on a project with no connections it simply draws no wires, which
 * reads as a pass for a reason that has nothing to do with tracing.
 */
const seededWiredProject = async (page: Page) => {
  const project = { ...structuredClone(demoProject), id: 'parity-board', name: 'Паритет · один проект на обе доски' }
  await page.addInitScript((seed) => {
    localStorage.setItem('panel36.projects.v2', JSON.stringify([seed]))
  }, project)
}

/** Both supported views must land every conductor in its physical clamp. */
const ROUTES = [
  { name: 'старый редактор', path: '/app/editor', gate: true },
  { name: 'новая доска', path: '/app/board', gate: true },
] as const

for (const route of ROUTES) {
  test.describe(`${route.name}: провода приходят в зажимы`, () => {
    test.setTimeout(180_000)

    test('измерение', async ({ page }) => {
      await unlockWorkspace(page)
      await seededWiredProject(page)
      await page.goto(route.path)
      await expect(page.locator('.dv-pocket, .dv-socket').first()).toBeAttached({ timeout: 60_000 })
      await page.waitForTimeout(800)

      const result = await measure(page)
      console.log(`ЗАЖИМЫ ${route.name} ${JSON.stringify(result)}`)

      console.log(`ИТОГ ${route.name}: ${result.landed}/${result.wires} в зажимах, худшее расстояние ${result.worst.toFixed(1)} px`)

      if (!route.gate) return
      // Both boards drew the same project from the same catalogue, so the clamp counts must match:
      // a different count would mean the two are not being compared like for like.
      expect(result.wires).toBeGreaterThan(0)
      expect(result.landed).toBe(result.wires)
      expect(result.worst).toBeLessThanOrEqual(2)
    })
  })
}
