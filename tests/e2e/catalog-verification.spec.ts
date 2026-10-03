import { expect, test } from '@playwright/test'
import { workspaceCatalog } from '../../src/data/catalog'
import { gotoEditor } from './helpers'

const workspaceCatalogSize = workspaceCatalog.length

/**
 * The catalogue is mostly generated from a series template, so "confirmed" is the exception.
 * These cover the two things a reader relies on: that an unconfirmed entry says so before it is
 * picked, and that the filter can be used to work in the exception on purpose.
 */
test.describe('catalogue provenance', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await gotoEditor(page)
    // The editor opens in focused mode with the side panels hidden. The toggle's label flips
    // between "Показать боковые панели" and "Скрыть", so a plain click on the named button is
    // both the action and the wait — asking whether it exists first races the mount.
    await page.getByRole('button', { name: 'Показать боковые панели' }).click()
    await expect(page.getByRole('button', { name: 'Только проверенные' })).toBeVisible()
  })

  test('marks catalogue entries that are not confirmed', async ({ page }) => {
    const items = page.locator('.catalog-list .catalog-item')
    const flagged = page.locator('.catalog-list .verify-flag')

    // The working catalogue is a short list on purpose — one position per kind, plus the pole
    // variants that change the wiring. The size assertion that used to demand more than a hundred
    // rows was defending a list nobody chose from.
    expect(await items.count()).toBeGreaterThanOrEqual(workspaceCatalogSize)
    expect(await flagged.count()).toBeGreaterThan(0)
    // No position may be left without a status. The built-in catalogue used to have no
    // `verificationStatus` at all, which the list rendered as "Статус не указан" — a wording
    // that reads like unfinished data rather than the deliberate statement it is.
    expect(await page.locator('.catalog-list .verify-flag', { hasText: 'Статус не указан' }).count()).toBe(0)
    // Those positions are real products whose parameters nobody checked, which is not the same
    // claim as "historical data" and must not borrow its wording.
    await expect(page.locator('.catalog-list .verify-flag', { hasText: 'Параметры не подтверждены' }).first()).toBeAttached()
    expect(await page.locator('.catalog-list .verify-flag', { hasText: 'Исторические данные' }).count()).toBe(0)
  })

  test('the filter narrows the list to confirmed entries only', async ({ page }) => {
    const items = page.locator('.catalog-list .catalog-item')
    const before = await items.count()

    const toggle = page.getByRole('button', { name: 'Только проверенные' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()

    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // No position in the working catalogue claims to have been checked against a datasheet, so
    // the honest result of this filter today is an empty list — and an empty list that says so is
    // a correct answer, not a broken control. Marking a row confirmed to make a test green would
    // be the exact claim this catalogue refuses to make.
    const after = await items.count()
    expect(after).toBeLessThan(before)
    if (after === 0) {
      await expect(page.locator('.catalog-list .empty-list')).toBeVisible()
    }
    // Nothing unconfirmed may survive the filter either way.
    expect(await page.locator('.catalog-list .verify-flag').count()).toBe(0)
  })

  test('the filter combines with a search', async ({ page }) => {
    await page.getByRole('button', { name: 'Только проверенные' }).click()
    await page.getByLabel('Поиск по каталогу').fill('AVO-10')

    const items = page.locator('.catalog-list .catalog-item')
    await expect.poll(() => items.count()).toBe(0)
    expect(await page.locator('.catalog-list .verify-flag').count()).toBe(0)

    // The same search without the filter finds its rows, so the empty result above is the filter
    // working rather than the search being broken.
    await page.getByRole('button', { name: 'Только проверенные' }).click()
    await expect.poll(() => items.count()).toBeGreaterThan(0)
  })
})
