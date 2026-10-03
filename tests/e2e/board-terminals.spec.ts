import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * Terminal blocks are where a wire lands on a real board, so being unable to connect one made the
 * wire tool unusable at exactly the point it matters.
 *
 * The socket geometry moved from the component into the domain. The first test is the guard for
 * that move: the screws must land on the same pixels as before, or a refactor silently became a
 * redesign of every terminal block in the catalogue.
 */
test.describe('клеммные колодки', () => {
  test.setTimeout(180_000)

  const openBoard = async (page: import('@playwright/test').Page) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  }

  test('винты колодки нарисованы там же, где и раньше', async ({ page }) => {
    await openBoard(page)
    // Six screws in three rows, the same grid the component used to compute on its own.
    const sockets = await page.locator('.scene-device[data-instance-id="demo-xt01"] .dv-socket').evaluateAll(
      (els) => els.map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, r: Math.round(el.getBoundingClientRect().width * 10) / 10 } }),
    )
    expect(sockets).toHaveLength(6)
    // Two columns, three rows: the shape a 1-module terminal block is drawn with.
    expect(new Set(sockets.map((s) => s.x)).size).toBe(2)
    expect(new Set(sockets.map((s) => s.y)).size).toBe(3)
    expect(new Set(sockets.map((s) => s.r)).size).toBe(1)
  })

  test('в колодку можно провести провод', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()

    // XT03 is an L block; the breaker that feeds it is QF03, also L.
    const end = page.locator('.scene-terminal[data-terminal^="demo-xt03:L:top:"]')
    await expect(end).toBeAttached()

    const before = await page.locator('.scene-wire').count()
    await page.locator('.scene-terminal[data-terminal="demo-qf03:L:top:0"]').click()
    await end.click()

    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before + 1)
  })

  test('в колодку нельзя провести чужую шину', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()
    // XT02 is a PE block. A live conductor does not go into it.
    const earth = page.locator('.scene-terminal[data-terminal="demo-xt02:PE:top:0"]')
    await expect(earth).toBeAttached()

    const before = await page.locator('.scene-wire').count()
    await page.locator('.scene-terminal[data-terminal="demo-qf03:L:top:0"]').click()
    await earth.click()

    await expect(page.locator('.board-wire-refusal')).toContainText('одну шину')
    expect(await page.locator('.scene-wire').count()).toBe(before)
  })
})
