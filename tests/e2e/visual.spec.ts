import { expect, test } from '@playwright/test'
import { gotoEditor, seedProject, unlockWorkspace } from './helpers'

/**
 * Visual regression for the board and the public shell.
 *
 * The geometry and contrast suites check behaviour and colour maths, but nothing until now
 * pinned what the thing actually looks like. A clipped marking or a shifted cabinet is a
 * pure appearance defect and slips past every assertion that does not read a pixel.
 *
 * Two caveats worth knowing before a baseline is regenerated:
 * - Manrope and IBM Plex Mono are bundled from @fontsource, Latin and Cyrillic both, so the
 *   render does not depend on what the machine happens to have installed. What it does still
 *   depend on is the platform: text antialiasing differs between operating systems and
 *   versions.
 * - Baselines live per platform in tests/e2e/visual.spec.ts-snapshots and are named for the OS.
 *   Running on a new one produces a diff that says nothing about the design, and it needs a new
 *   baseline rather than a repair of the existing one.
 */
const freeze = async (page: import('@playwright/test').Page) => {
  // The board animates width and transform; a screenshot mid-transition is a coin flip.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' })
  await page.evaluate(() => document.fonts.ready)
  // A transient notice is part of the page but not part of its design, and how long it happens to
  // still be on screen differs between a first load and a warm cache.
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

test.describe('visual', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the home page renders as designed', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible()
    await freeze(page)
    await expect(page).toHaveScreenshot('home.png', { fullPage: true, animations: 'disabled' })
  })

  test('the read-only demo board renders as designed', async ({ page }) => {
    await page.goto('/demo/project')
    await expect(page.locator('.demo-project-cabinet')).toBeVisible()
    await freeze(page)
    await expect(page).toHaveScreenshot('demo-project.png', { fullPage: true, animations: 'disabled' })
  })

  test('the same board renders in the dark theme', async ({ page }) => {
    await page.goto('/demo/project')
    await expect(page.locator('.demo-project-cabinet')).toBeVisible()
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await freeze(page)
    await expect(page).toHaveScreenshot('demo-project-dark.png', { fullPage: true, animations: 'disabled' })
  })

  /**
   * The rebuilt board gets its own baseline from the start, so "the new one is not worse than the
   * old one" stops being an opinion. Recording it before the side panels arrive means every later
   * change to the new workspace shows up here as a diff of its own.
   */
  test('the rebuilt board renders as designed', async ({ page }) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    // The panels are part of what this baseline is for, so the snapshot is taken with them open.
    // Preferences persist in the browser profile, so the state is set explicitly rather than assumed.
    const toggle = page.getByRole('button', { name: /боковые панели/ })
    // isVisible() does not wait, and the header is not mounted on the first tick after navigation,
    // so the toggle is awaited before its label is read.
    await expect(toggle).toBeVisible()
    if ((await toggle.textContent())?.includes('Показать')) await toggle.click()
    // The panel element itself carries no box, so visibility is asserted on its contents.
    await expect(page.getByLabel('Поиск по каталогу')).toBeVisible()
    await expect(page.locator('.scene-wire').first()).toBeVisible()
    await freeze(page)
    await expect(page.locator('.workspace')).toHaveScreenshot('board-workspace.png', { animations: 'disabled' })
  })

  test('the editor board renders as designed', async ({ page }) => {
    await seedProject(page, [
      { id: 'qf01', row: 0, slot: 0 },
      { id: 'qf02', row: 0, slot: 1 },
      { id: 'xt01', row: 0, slot: 2 },
    ])
    await gotoEditor(page)
    await expect(page.locator('.placed-device').first()).toBeVisible()
    await page.getByRole('button', { name: 'Показать боковые панели' }).click()
    await freeze(page)
    await expect(page).toHaveScreenshot('editor-board.png', { animations: 'disabled' })
  })
})
