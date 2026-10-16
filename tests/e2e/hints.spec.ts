import { expect, test } from '@playwright/test'
import { gotoEditor, openSidePanels } from './helpers'

test('the orientation card shows once and remembers its dismissal', async ({ page }) => {
  await gotoEditor(page)
  await openSidePanels(page)

  const hints = page.locator('[data-editor-hints]')
  await expect(hints).toBeVisible()
  await expect(hints).toContainText('вкладки над схемой')
  await expect(hints).toContainText('«Настройках»')

  // A reload does not count as a second first visit while the card is still open.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(hints).toBeVisible()

  await page.getByRole('button', { name: /Понятно, скрыть/ }).click()
  await expect(hints).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(hints).toHaveCount(0)
})
