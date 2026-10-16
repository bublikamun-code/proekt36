import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * What the board says about the project.
 *
 * The important half of this criterion is the negative one: the board shows exactly what
 * validateProject says and not a rule of its own. A panel that is louder than its own export is a
 * panel nobody trusts, so the marks come from the same validator the report and the printout use.
 *
 * Only states a person can actually reach are used here. An empty address is not one of them: the
 * domain refuses it, and the board says so rather than pretending to have saved it.
 */
test.describe('проверки на доске', () => {
  test.setTimeout(180_000)

  const openBoard = async (page: import('@playwright/test').Page) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  }

  test('пустой адрес не сохраняется молча', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="address"]').click()
    await page.locator('.scene-device[data-instance-id="demo-qf03"]').click()
    const field = page.getByLabel(/^Адрес:/)
    await field.fill('')
    await field.press('Enter')

    // The edit is refused in words, and the address on the board is the one it had.
    await expect(page.locator('.board-wire-refusal')).toContainText('не может быть пустым')
    await expect(page.locator('.scene-device[data-instance-id="demo-qf03"]')).toContainText('QF03')
  })

  test('повторяющийся адрес помечает оба аппарата и объясняется словами', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="address"]').click()
    await page.locator('.scene-device[data-instance-id="demo-qf03"]').click()
    await page.getByLabel(/^Адрес:/).fill('QF02')
    await page.getByLabel(/^Адрес:/).press('Enter')

    const copy = page.locator('.scene-device[data-instance-id="demo-qf03"]')
    const original = page.locator('.scene-device[data-instance-id="demo-qf02"]')
    await expect(copy).toHaveClass(/has-issue/)
    // Exactly one mark, because the validator names only the device that took an address already in
    // use. Marking the original too would be the board inventing a rule of its own — the half of
    // this criterion that actually protects trust.
    await expect(original).not.toHaveClass(/has-issue/)
    expect(await page.locator('.scene-issue').count()).toBe(1)

    // The mark alone is a nuisance; the person has to be told what to do, in a sentence.
    await copy.click()
    await expect(page.locator('.board-issue-note')).toContainText('QF02')
    await expect(page.locator('.board-issue-note')).not.toContainText('device.address')
  })

  test('удаление аппарата, на котором держится цепь, замечено на доске', async ({ page }) => {
    await openBoard(page)
    // qf02 protects the «Освещение» circuit; qf01 protects nothing and would orphan no circuit.
    const guarded = page.locator('.scene-device[data-instance-id="demo-qf02"]')
    await guarded.click()
    await page.keyboard.press('Delete')

    await expect(guarded).toHaveCount(0)
    // The circuits QF01 protected now hang on nothing. The rule has no device to mark — the
    // breaker is gone — so it has to be said in words, or the board looks finished and is not.
    const orphans = page.locator('.board-general-issues')
    await expect(orphans).toBeVisible()
    await expect(orphans).toContainText('не найден автомат')
    await expect(orphans).toContainText('Освещение')
    // Words, not a rule code: a person is not going to look up circuit.protection.missing.
    await expect(orphans).not.toContainText('circuit.protection')
  })

  test('чистая доска не рисует ни одного знака', async ({ page }) => {
    await openBoard(page)
    // The demo project is a finished one. Marks here would be the board inventing rules the
    // project does not have, which is exactly the failure this suite exists to catch.
    expect(await page.locator('.scene-issue').count()).toBe(0)
    expect(await page.locator('.scene-device.has-issue').count()).toBe(0)
  })
})
