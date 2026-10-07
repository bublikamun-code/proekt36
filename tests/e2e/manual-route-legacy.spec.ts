import { expect, test } from '@playwright/test'
import { demoProject } from '../../src/data/demoProject'
import { unlockWorkspace } from './helpers'

test('legacy editor preserves manual front/rear route and lands on the same terminal after reload', async ({ page }) => {
  await unlockWorkspace(page)
  const connection = { ...demoProject.connections.find((wire) => wire.fromDeviceId)!, route: {
    points: [{ x: 25, y: 145 }, { x: 190, y: 145 }], segmentLayers: ['front', 'rear', 'front'] as const,
  } }
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('manual-legacy-seed')) return
    localStorage.setItem('panel36.projects.v2', JSON.stringify([project]))
    sessionStorage.setItem('manual-legacy-seed', '1')
  }, { ...demoProject, id: 'manual-legacy', connections: [connection] })
  await page.goto('/app/editor')
  await expect(page.locator('.wires-front path')).toHaveCount(2)
  await expect(page.locator('.wires-rear path')).toHaveCount(1)
  const distance = await page.locator('.wires-front path').last().evaluate((node) => {
    const path = node as SVGPathElement
    const point = path.getPointAtLength(path.getTotalLength())
    const end = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    const clamps = [...document.querySelectorAll('.dv-pocket')].map((clamp) => clamp.getBoundingClientRect())
    return Math.min(...clamps.map((box) => Math.hypot(end.x - box.x - box.width / 2, end.y - box.y - box.height / 2)))
  })
  expect(distance).toBeLessThan(2)
  const paths = await page.locator('.wires path').evaluateAll((elements) => elements.map((el) => el.getAttribute('d')))
  await page.reload()
  await expect(page.locator('.wires-front path')).toHaveCount(2)
  expect(await page.locator('.wires path').evaluateAll((elements) => elements.map((el) => el.getAttribute('d')))).toEqual(paths)
})
