import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * A circuit made from the board.
 *
 * The person wires a device to a load and describes the load. Everything the circuit needs is
 * created in one action — the store makes the wire too — and the only thing genuinely missing is
 * what it feeds, which is asked for where the person is already looking.
 */
test.describe('цепи с доски', () => {
  test.setTimeout(180_000)

  const openBoard = async (page: import('@playwright/test').Page) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  }

  test('цепь создаётся с доски и спрашивает нагрузку на месте', async ({ page }) => {
    await openBoard(page)
    const wiresBefore = await page.locator('.scene-wire').count()

    await page.locator('.scene-device[data-instance-id="demo-qf03"]').click()
    await page.getByRole('button', { name: 'Создать цепь' }).click()

    // The circuit came with its wire, so the board gained a conductor without anybody drawing one.
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(wiresBefore + 1)

    // And it asks what the circuit feeds, here, rather than in a panel.
    const load = page.getByLabel('Нагрузка цепи')
    await expect(load).toBeVisible()
    await load.fill('Розетки спальни')
    await load.press('Enter')
    await expect(load).toHaveCount(0)
  })

  test('название нагрузки, набранное на доске, сохраняется в проекте', async ({ page }) => {
    await openBoard(page)
    await page.locator('.scene-device[data-instance-id="demo-qf03"]').click()
    await page.getByRole('button', { name: 'Создать цепь' }).click()

    const load = page.getByLabel('Нагрузка цепи')
    await load.fill('Балкон')
    await load.press('Enter')

    // Checked in what is actually persisted, not in a label that could disagree with the project.
    // Persistence is debounced, so this polls instead of reading once and declaring a failure.
    await expect.poll(async () => {
      const raw = await page.evaluate(() => window.localStorage.getItem('panel36.projects.v2') ?? '')
      return raw.includes('Балкон')
    }, { timeout: 15_000 }).toBe(true)
  })

  test('кнопка цепи без выбранного аппарата не нажимается', async ({ page }) => {
    await openBoard(page)
    // A circuit needs a device to protect and a device to feed. Offering the action with nothing
    // selected would only produce a refusal after the person clicked.
    await page.locator('.board-scene').click({ position: { x: 20, y: 20 } })
    await expect(page.getByRole('button', { name: 'Создать цепь' })).toBeDisabled()
  })

  test('клавиша C создаёт цепь для выбранного аппарата', async ({ page }) => {
    await openBoard(page)
    await page.locator('.scene-device[data-instance-id="demo-qf03"]').click()
    const wiresBefore = await page.locator('.scene-wire').count()
    await page.keyboard.press('c')
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(wiresBefore + 1)
  })
})
