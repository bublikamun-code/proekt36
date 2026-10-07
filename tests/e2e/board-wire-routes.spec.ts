import { expect, test, type Page } from '@playwright/test'
import { demoProject } from '../../src/data/demoProject'
import { unlockWorkspace } from './helpers'

const devices = ['source', 'target'].map((instanceId, index) => ({ instanceId, productId: 'ekf-mcb-1p-c6', row: index, slot: index * 4, address: `QF0${index + 1}`, marking: `QF0${index + 1}`, quantity: 1, phase: 1 as const, note: '', mount: 'din' as const }))
const wires = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('panel36.projects.v2') || '[]')[0]?.connections ?? [])
const pointClick = async (page: Page, x: number, y: number) => {
  const screen = await page.locator('.board-scene').evaluate((svg, point) => {
    const p = new DOMPoint(point.x, point.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
    return { x: p.x, y: p.y }
  }, { x, y })
  await page.mouse.click(screen.x, screen.y)
}

test.beforeEach(async ({ page }) => {
  await unlockWorkspace(page)
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('wire-routes-seeded')) return
    localStorage.setItem('panel36.projects.v2', JSON.stringify([project]))
    sessionStorage.setItem('wire-routes-seeded', 'true')
  }, { ...demoProject, id: 'wire-routes', devices, connections: [], circuits: [] })
  await page.goto('/app/board')
  await expect(page.locator('.scene-device[data-instance-id="source"]')).toBeVisible()
})

const drawRoute = async (page: Page) => {
  await page.getByRole('button', { name: 'Провести', exact: true }).click()
  await page.locator('[data-terminal="source:L:bottom:0"]').click()
  await pointClick(page, 18, 170)
  await page.getByLabel('Слой нового участка').selectOption('rear')
  await pointClick(page, 80, 200)
  await page.locator('[data-terminal="target:L:top:0"]').click()
  await expect(page.locator('.scene-wire')).toHaveCount(1)
  await expect.poll(async () => (await wires(page)).length).toBe(1)
}

const selectWire = async (page: Page) => {
  await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
  await page.locator('.scene-wire-hit').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('board-wire-inspector')).toBeVisible()
}

test('draws bends and rear segments atomically, remains in wire mode and restores route after reload', async ({ page }) => {
  await drawRoute(page)
  await expect(page.getByRole('button', { name: 'Провести', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const saved = (await wires(page))[0]
  expect(saved.route.points).toHaveLength(2)
  expect(saved.route.segmentLayers).toEqual(['front', 'rear', 'rear'])
  await expect(page.locator('.scene-front-wires .scene-wire-segment')).toHaveCount(1)
  await expect(page.locator('.scene-wires .scene-wire-segment')).toHaveCount(2)
  const thickness = await page.locator('.scene-wire-segment').first().evaluate((el) => Number.parseFloat(getComputedStyle(el).strokeWidth))
  expect(thickness).toBeGreaterThanOrEqual(2.8)
  await page.reload()
  expect((await wires(page))[0].route).toEqual(saved.route)
  await expect(page.locator('.scene-wire')).toHaveCount(1)
})

test('edits route points and layer as one undo; cancel discards draft', async ({ page }) => {
  await drawRoute(page)
  await selectWire(page)
  const before = (await wires(page))[0].route
  await page.getByRole('button', { name: 'Изменить трассу', exact: true }).click()
  await page.getByLabel('Слой участка 1', { exact: true }).selectOption('rear')
  await page.getByRole('button', { name: 'Добавить поворот на участке 1', exact: true }).click()
  await expect(page.locator('.scene-route-handle')).toHaveCount(3)
  const handle = page.locator('.scene-route-handle').first()
  const oldX = Number(await handle.getAttribute('cx'))
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  expect(Number(await handle.getAttribute('cx'))).toBe(oldX + 1)
  const box = await handle.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 18, box!.y + box!.height / 2 + 12, { steps: 4 })
  await page.mouse.up()
  expect(Number(await handle.getAttribute('cx'))).toBeGreaterThan(oldX + 1)
  expect((await wires(page))[0].route).toEqual(before)
  await page.getByRole('button', { name: 'Применить трассу', exact: true }).click()
  await expect.poll(async () => (await wires(page))[0].route.points.length).toBe(3)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await wires(page))[0].route).toEqual(before)
  await page.getByRole('button', { name: 'Изменить трассу', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить поворот 1', exact: true }).click()
  await expect(page.locator('.scene-route-handle')).toHaveCount(1)
  await page.getByRole('button', { name: 'Отменить трассу', exact: true }).click()
  expect((await wires(page))[0].route).toEqual(before)
})

test('Escape cancels an unfinished routed wire without saving', async ({ page }) => {
  await page.getByRole('button', { name: 'Провести', exact: true }).click()
  await page.locator('[data-terminal="source:L:bottom:0"]').click()
  await pointClick(page, 18, 170)
  await expect(page.locator('.scene-pending-points circle')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.scene-wire-ghost')).toHaveCount(0)
  await expect(page.locator('.scene-wire')).toHaveCount(0)
  expect(await wires(page)).toEqual([])
})

for (const reverse of [false, true]) {
  test(`bus route preview matches committed geometry (${reverse ? 'terminal first' : 'bus first'})`, async ({ page }) => {
    await page.getByRole('button', { name: 'Провести', exact: true }).click()
    const terminal = page.locator('[data-terminal="target:L:top:0"]')
    const bus = page.locator('[data-bus="L"]')
    await (reverse ? terminal : bus).click()
    await pointClick(page, 18, 170)
    await page.getByLabel('Слой нового участка').selectOption('rear')
    await pointClick(page, 80, 200)
    const end = reverse ? bus : terminal
    await end.hover()
    const preview = await page.locator('.scene-wire-ghost').getAttribute('d')
    await end.click()
    await expect(page.locator('.scene-wire')).toHaveAttribute('d', preview!)
    await expect.poll(async () => (await wires(page)).length).toBe(1)
    expect((await wires(page))[0].route.segmentLayers).toEqual(reverse ? ['rear', 'rear', 'front'] : ['front', 'rear', 'rear'])
    await page.keyboard.press('Control+z')
    await expect(page.locator('.scene-wire')).toHaveCount(0)
  })
}

test('starting to edit an automatic route preserves its geometry and rear layer', async ({ page }) => {
  await page.goto('/app/board?fixture=demo')
  const wire = page.locator('.scene-wire').first()
  await expect(wire).toBeAttached()
  const metrics = () => wire.evaluate((el) => {
    const path = el as SVGPathElement
    const box = path.getBBox()
    return { length: path.getTotalLength(), x: box.x, y: box.y, width: box.width, height: box.height }
  })
  const before = await metrics()
  await page.locator('.scene-wire-hit').first().focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Изменить трассу', exact: true }).click()
  await expect(page.locator('.scene-route-handle').first()).toBeVisible()
  const after = await metrics()
  for (const key of Object.keys(before) as (keyof typeof before)[]) expect(after[key]).toBeCloseTo(before[key], 1)
  const layers = await page.locator('.route-editor select').evaluateAll((selects) => selects.map((el) => (el as HTMLSelectElement).value))
  expect(layers.length).toBeGreaterThan(1)
  expect(layers.every((layer) => layer === 'rear')).toBe(true)
  await page.locator('.scene-route-handle').first().focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.route-editor')).toBeVisible()
  await expect(page.locator('.scene-wire')).toHaveCount(10)
  await page.getByRole('button', { name: 'Отменить трассу', exact: true }).click()
  expect(await metrics()).toEqual(before)
})

for (const width of [1440, 390]) {
  test(`route apply and cancel remain reachable in a ${width}px viewport`, async ({ page }) => {
    await drawRoute(page)
    await page.setViewportSize({ width, height: 844 })
    await selectWire(page)
    await page.getByRole('button', { name: 'Изменить трассу', exact: true }).click()
    const inspector = page.getByTestId('board-wire-inspector')
    const apply = page.getByRole('button', { name: 'Применить трассу', exact: true })
    const cancel = page.getByRole('button', { name: 'Отменить трассу', exact: true })
    await expect(inspector.locator('fieldset')).toHaveCount(0)
    await expect(inspector.locator('.route-segment-control')).toHaveCount(3)
    await expect(apply).toBeInViewport({ ratio: 1 })
    await expect(cancel).toBeInViewport({ ratio: 1 })
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Добавить поворот на участке 1', exact: true }).click()
    await expect(apply).toBeInViewport({ ratio: 1 })
    await expect(cancel).toBeInViewport({ ratio: 1 })
    await inspector.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect(apply).toBeInViewport({ ratio: 1 })
    await cancel.click()
    await expect(inspector.locator('fieldset')).toBeVisible()
  })
}
