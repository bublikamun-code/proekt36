import { expect, test } from '@playwright/test'
import { gotoEditor } from './helpers'

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

    expect(await items.count()).toBeGreaterThan(100)
    expect(await flagged.count()).toBeGreaterThan(0)
    // A missing status is its own case: the built-in catalogue has no `verificationStatus`
    // at all, and those are real products, not historical data.
    await expect(page.locator('.catalog-list .verify-flag', { hasText: 'Статус не указан' }).first()).toBeAttached()
    expect(await page.locator('.catalog-list .verify-flag', { hasText: 'Исторические данные' }).count()).toBe(0)
  })

  test('the filter narrows the list to confirmed entries only', async ({ page }) => {
    const items = page.locator('.catalog-list .catalog-item')
    const before = await items.count()

    const toggle = page.getByRole('button', { name: 'Только проверенные' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()

    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const after = await items.count()
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
    // Nothing unconfirmed may survive the filter.
    expect(await page.locator('.catalog-list .verify-flag').count()).toBe(0)
  })

  test('the filter combines with a search', async ({ page }) => {
    await page.getByRole('button', { name: 'Только проверенные' }).click()
    await page.getByLabel('Поиск по каталогу').fill('NB1-63H')

    const items = page.locator('.catalog-list .catalog-item')
    await expect.poll(() => items.count()).toBeGreaterThan(0)
    expect(await page.locator('.catalog-list .verify-flag').count()).toBe(0)
  })
})
