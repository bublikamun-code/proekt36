import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

test.beforeEach(async ({ page }) => {
  await unlockWorkspace(page)
  await page.goto('/app/board?fixture=demo')
  await expect(page.locator('.board-scene')).toBeVisible()
})

test('exact source and destination survive property edits, undo and reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Провести', exact: true }).click()
  const source = page.locator('[data-terminal="demo-xt03:L:bottom:3"]')
  const target = page.locator('[data-terminal="demo-qf03:L:bottom:0"]')
  const boardPoint = async (locator: typeof source) => locator.evaluate((node) => {
    const circle = node as SVGCircleElement
    const transform = (circle.parentElement as unknown as SVGGElement).transform.baseVal.consolidate()!.matrix
    const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(transform)
    return { x: point.x, y: point.y }
  })
  const from = await boardPoint(source)
  const to = await boardPoint(target)
  const before = await page.locator('.scene-wire').count()
  await source.click()
  await target.hover()
  await expect(page.locator('.scene-wire-ghost')).toBeVisible()
  const previewPath = await page.locator('.scene-wire-ghost').getAttribute('d')
  await target.click()
  await expect(page.locator('.scene-wire')).toHaveCount(before + 1)
  const hit = page.getByRole('button', { name: 'Провод: XT03 → QF03, шина L' })
  const id = await hit.getAttribute('data-wire-id')
  const path = page.locator(`.scene-wire[data-wire-id="${id}"]`)
  const d = await path.getAttribute('d')
  expect(d).toBe(previewPath)
  const numbers = d!.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  expect(numbers[0]).toBeCloseTo(from.x, 1)
  expect(numbers[1]).toBeCloseTo(from.y, 1)
  expect(numbers.at(-2)).toBeCloseTo(to.x, 1)
  expect(numbers.at(-1)).toBeCloseTo(to.y, 1)
  await hit.focus()
  await hit.press('Enter')
  await page.getByLabel('Зажим источника').click()
  await page.getByRole('option', { name: '5 · снизу', exact: true }).click()
  await expect(path).not.toHaveAttribute('d', d!)
  await page.getByRole('button', { name: /Отменить/ }).click()
  await expect(path).toHaveAttribute('d', d!)
  await expect(page.locator('.storage-banner')).toContainText('Все изменения сохранены')
  await page.reload()
  await expect(path).toHaveAttribute('d', d!)
})

test('cancelled wire does not resume after switching tools; bottom bus feed uses selected screw', async ({ page }) => {
  await page.keyboard.press('3')
  await page.locator('[data-terminal="demo-qf03:L:top:0"]').click()
  await page.keyboard.press('1')
  await page.keyboard.press('3')
  await expect(page.locator('.scene-terminal.is-start')).toHaveCount(0)
  const before = await page.locator('.scene-wire').count()
  await page.locator('[data-terminal="demo-xt02:PE:bottom:3"]').press('Enter')
  await page.getByRole('button', { name: 'Заземление PE', exact: true }).press('Enter')
  await expect(page.locator('.scene-wire')).toHaveCount(before + 1)
})

test('zoomed board scrolls and fit restores a centered board', async ({ page }) => {
  await page.getByLabel('Масштаб', { exact: true }).fill('2.5')
  const scroll = page.locator('.board-scene-canvas')
  expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Вписать', exact: true }).click()
  const bounds = await page.locator('.board-scene').boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
  expect(bounds!.x + bounds!.width / 2).toBeCloseTo(viewport.width / 2, 0)
})

for (const width of [390, 900, 1280]) {
  test(`tools and side panels remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: 'Показать боковые панели', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible()
    if (width <= 1100) {
      await page.getByRole('button', { name: 'Свойства', exact: true }).click()
      await expect(page.locator('.inspector-panel')).toBeVisible()
    }
    await page.getByRole('button', { name: 'Скрыть боковые панели', exact: true }).click()
    await expect(page.locator('.board-scene')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
