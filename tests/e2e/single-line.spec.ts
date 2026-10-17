import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * The single-line diagram lives in the print report, so its two states are checked where they
 * occur: the demo project draws the real supply path — three protections and the QF01 → QFI01
 * cascade read out of the same jumper the board draws — and a fresh editor workspace, whose
 * seeded board has devices but no circuits yet, says so instead of inventing columns.
 */
test.describe('однолинейная схема в печатном отчёте', () => {
  test('демо-проект рисует ввод, защиты и каскад', async ({ page }) => {
    await page.goto('/demo/project')
    // The report is display:none outside print media, which also keeps it out of the
    // accessibility tree — so it is asserted under the print stylesheet.
    await page.emulateMedia({ media: 'print' })
    const figure = page.locator('[data-single-line]')
    await expect(figure).toBeVisible()
    await expect(figure.locator('.sl-source')).toContainText('Ввод')
    await expect(figure.locator('.sl-device:not(.sl-unprotected)')).toHaveCount(3)

    const cascade = figure.locator('.single-line-notes', { hasText: 'каскадом' })
    await expect(cascade).toHaveCount(1)
    await expect(cascade).toContainText('QF01 → QFI01')

    // The incoming breaker and the terminal blocks carry no circuit, and the diagram names
    // them rather than dropping them off the drawing.
    const unmodelled = figure.locator('.single-line-notes', { hasText: 'цепь не заведена' })
    await expect(unmodelled).toContainText('QF01')
    await expect(unmodelled).toContainText('XT01')
  })

  test('в редакторе без цепей схема честно сообщает, что строить не из чего', async ({ page }) => {
    await unlockWorkspace(page)
    await page.goto('/app/editor?tab=report')
    const figure = page.locator('[data-single-line]')
    await expect(figure.locator('.single-line-empty')).toBeVisible()
    await expect(figure.locator('.sl-device')).toHaveCount(0)
  })
})
