import { expect, test } from '@playwright/test'
import { gotoEditor, seedProject, unlockWorkspace } from './helpers'

/**
 * The working area fits the board to whatever room it has, and the user can also scale it by hand.
 * Those used to be one number — the manual zoom multiplied an automatic fit factor — so the
 * percentage on screen moved when the side panels opened and the zoom could not be trusted as the
 * board's own size. It is now either the fit or the user's own multiple, never both.
 */

const label = (page: import('@playwright/test').Page) => page.locator('.editor-2d .zoom-controls span')
const fitButton = (page: import('@playwright/test').Page) => page.locator('.editor-2d .zoom-controls .fit-toggle')

test.use({ viewport: { width: 1440, height: 900 } })

test('a manual zoom is not disturbed by the side panels', async ({ page }) => {
  await gotoEditor(page)
  await expect(label(page)).toBeVisible()
  // The editor opens in focused mode, so the board is being scaled by the fit and not by hand.
  await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Увеличить масштаб' }).click()
  await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'false')
  const manual = await label(page).textContent()

  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await expect(label(page)).toHaveText(manual ?? '')
  await page.getByRole('button', { name: 'Скрыть боковые панели' }).click()
  await expect(label(page)).toHaveText(manual ?? '')
})

test('the buttons, the wheel and the fit button all scale the same board', async ({ page }) => {
  await gotoEditor(page)
  const cabinet = page.locator('.cabinet')
  const scroll = page.locator('.canvas-scroll')
  const before = (await cabinet.boundingBox())?.width ?? 0
  expect(before).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Увеличить масштаб' }).click()
  const grown = (await cabinet.boundingBox())?.width ?? 0
  expect(grown).toBeGreaterThan(before)

  // Ctrl + wheel is the gesture the working area is expected to answer to, and it zooms in rather
  // than scrolling the page.
  await page.keyboard.down('Control')
  await page.mouse.move(700, 450)
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await cabinet.boundingBox())?.width ?? 0).toBeGreaterThan(grown)

  // Enlarged past the working area, the board must stay reachable: its left edge cannot drift out
  // of the scrollable range, which is what a centred stage used to do.
  const scrollBox = await scroll.boundingBox()
  const cabinetBox = await cabinet.boundingBox()
  if (!scrollBox || !cabinetBox) throw new Error('Canvas geometry is unavailable')
  expect(cabinetBox.x).toBeGreaterThanOrEqual(scrollBox.x - 1)

  await fitButton(page).click()
  await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true')
  const fitted = await cabinet.boundingBox()
  if (!fitted) throw new Error('Cabinet geometry is unavailable')
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 1)
  expect(fitted.y + fitted.height).toBeLessThanOrEqual(scrollBox.y + scrollBox.height + 1)
})

test('the chosen scale is still there after a reload', async ({ page }) => {
  // A project seeded into storage has a stable URL, so the reload lands on the same board. The
  // app only persists a project once it changes, and a plain reload of the working area has
  // nothing stored to come back to.
  await unlockWorkspace(page)
  await seedProject(page, [{ id: 'zoom-lab', row: 0, slot: 0 }])
  await gotoEditor(page)
  await expect(page.locator('.editor-2d')).toBeVisible()

  for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: 'Увеличить масштаб' }).click()
  const manual = await label(page).textContent()

  // A full page load, not a client-side route change: the scale is kept in local storage, so
  // only a fresh document proves it comes back.
  await gotoEditor(page)
  await expect(label(page)).toHaveText(manual ?? '')

  // Auto-fit is what a fresh working area starts from; the stored scale has to be clearable.
  await fitButton(page).click()
  await expect(label(page)).not.toHaveText(manual ?? '')
  await gotoEditor(page)
  await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true')
})
