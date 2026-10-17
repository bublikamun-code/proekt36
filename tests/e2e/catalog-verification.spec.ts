import { expect, test } from '@playwright/test'
import { gotoEditor, openSidePanels } from './helpers'

/**
 * The catalogue is mostly generated from a series template, so "confirmed" is the exception.
 * These cover the two things a reader relies on: that an unconfirmed entry says so before it is
 * picked, and that the filter can be used to work in the exception on purpose.
 */
test.describe('catalogue provenance', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await gotoEditor(page)
    await openSidePanels(page)
    await expect(page.getByRole('button', { name: 'Только проверенные' })).toBeVisible()
  })

  test('marks catalogue entries that are not confirmed', async ({ page }) => {
    const items = page.locator('.catalog-list .catalog-item')
    const flagged = page.locator('.catalog-list .verify-flag')

    expect(await items.count()).toBeGreaterThan(100)
    expect(await flagged.count()).toBeGreaterThan(0)
    // Since the A3 catalogue split every entry carries a status: generated CHINT templates and
    // verified series say «Подтверждено»/«Шаблон», the 40 legacy EKF entries honestly say
    // «Исторические данные» — and nothing is left without a word about where it came from.
    expect(await page.locator('.catalog-list .verify-flag', { hasText: 'Исторические данные' }).count()).toBeGreaterThan(0)
    expect(await page.locator('.catalog-list .verify-flag', { hasText: 'Статус не указан' }).count()).toBe(0)
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
