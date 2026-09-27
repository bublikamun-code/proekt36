import { expect, test } from '@playwright/test'
import { gotoEditor, seedProject, unlockWorkspace } from './helpers'

/**
 * A refresh is a pause, not a restart: the user has to come back to the board they were on, at
 * the size they had chosen, with the panels they were working with. Each of the three was a
 * separate way to lose that — a dead deep link, a reset scale, and a board that always opened
 * alone — so each is asserted on its own here.
 */

const zoomLabel = (page: import('@playwright/test').Page) => page.locator('.editor-2d .zoom-controls span')
const shell = (page: import('@playwright/test').Page) => page.locator('.app-shell')

test.use({ viewport: { width: 1440, height: 900 } })

test('a refresh keeps the project, the scale and the panels', async ({ page }) => {
  await unlockWorkspace(page)
  await seedProject(page, [{ id: 'a', row: 0, slot: 0 }])
  await gotoEditor(page)
  await expect(page.locator('.editor-2d')).toBeVisible()

  await page.getByRole('button', { name: 'Увеличить масштаб' }).click()
  await page.getByRole('button', { name: 'Увеличить масштаб' }).click()
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await expect(shell(page)).toHaveClass(/panels-open/)
  const scale = await zoomLabel(page).textContent()
  const url = page.url()

  await page.reload()

  await expect(page.locator('.editor-2d')).toBeVisible()
  await expect(page).toHaveURL(url)
  await expect(zoomLabel(page)).toHaveText(scale ?? '')
  await expect(shell(page)).toHaveClass(/panels-open/)
  await expect(page.locator('.catalog-panel')).toBeVisible()
  await expect(page.locator('.inspector-panel')).toBeVisible()
})

test('a first visit keeps its project across a refresh', async ({ page }) => {
  // With nothing in storage the editor opened a project that only existed in memory, so the
  // refresh met a different one and dropped the user on the project list.
  await gotoEditor(page)
  await expect(page.locator('.editor-2d')).toBeVisible()
  const url = page.url()

  await page.reload()

  await expect(page.locator('.editor-2d')).toBeVisible()
  await expect(page).toHaveURL(url)
  await expect(shell(page)).toHaveClass(/canvas-focus/)
})

test('closing the panels is remembered too', async ({ page }) => {
  await unlockWorkspace(page)
  await seedProject(page, [{ id: 'a', row: 0, slot: 0 }])
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await expect(shell(page)).toHaveClass(/panels-open/)
  await page.getByRole('button', { name: 'Скрыть боковые панели' }).click()
  await expect(shell(page)).not.toHaveClass(/panels-open/)

  await page.reload()
  await expect(shell(page)).toHaveClass(/canvas-focus/)
  await expect(shell(page)).not.toHaveClass(/panels-open/)
})
