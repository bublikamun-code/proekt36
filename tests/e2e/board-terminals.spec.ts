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

  test('у колодки шесть зажимов, и в каждый можно провести провод', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()

    // Six screws, two of them on the top row: a terminal block used to offer two terminals in
    // total, both on the leftmost screw, so a wire to any other screw could not be drawn at all.
    const screws = await page.locator('.scene-terminal[data-terminal^="demo-xt03:L:"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('data-terminal')),
    )
    expect(screws).toHaveLength(6)
    expect(screws.filter((key) => key?.includes(':top:'))).toHaveLength(2)

    // XT03 is an L block; the breaker that feeds it is QF03, also L.
    const before = await page.locator('.scene-wire').count()
    await page.locator('.scene-terminal[data-terminal="demo-qf03:L:top:0"]').click()
    await page.locator('.scene-terminal[data-terminal="demo-xt03:L:top:0"]').click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before + 1)

    // And the second top screw is a place of its own, not a copy of the first: the same wire to the
    // second screw is a second wire, and it is drawn arriving there. The tool returns to selection
    // after a wire is drawn — the clamps are only targets while it is on — so it is switched back.
    await page.locator('.board-tools [data-tool="wire"]').click()
    await page.locator('.scene-terminal[data-terminal="demo-qf03:L:top:0"]').click()
    await page.locator('.scene-terminal[data-terminal="demo-xt03:L:top:1"]').click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before + 2)

    const landings = await page.evaluate(() => {
      const group = document.querySelector('.scene-device[data-instance-id="demo-xt03"]')!
      const place = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(group.getAttribute('transform') ?? '')
      const dx = Number(place?.[1] ?? 0)
      const dy = Number(place?.[2] ?? 0)
      const screws = [...group.querySelectorAll('.dv-socket')].map((circle) => ({
        x: dx + Number(circle.getAttribute('cx')), y: dy + Number(circle.getAttribute('cy')),
      }))
      return [...document.querySelectorAll('.scene-wire')].map((path) => {
        const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
        const end = { x: numbers.at(-2)!, y: numbers.at(-1)! }
        return Math.min(...screws.map((screw) => Math.hypot(screw.x - end.x, screw.y - end.y)))
      })
    })
    // Two wires, two screws: neither of them is drawn on top of the other.
    expect(landings.filter((distance) => distance < 0.5)).toHaveLength(2)
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
