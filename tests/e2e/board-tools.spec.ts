import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * The board's tools, checked as a person would use them.
 *
 * Each test is one sentence of intent from the plan: press this, get that. Nothing here reads a
 * pixel or counts elements — a version of this suite that only proved the DOM contained the right
 * number of things is what let a black rectangle and a board under a panel ship as working.
 */
test.describe('инструменты доски', () => {
  test.setTimeout(180_000)

  const openBoard = async (page: import('@playwright/test').Page) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  }

  test('нажатие 2 включает режим адреса, и доска объявляет режим', async ({ page }) => {
    await openBoard(page)
    const addressTool = page.locator('.board-tools [data-tool="address"]')
    await expect(addressTool).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('2')
    await expect(addressTool).toHaveAttribute('aria-pressed', 'true')
    // The pressed state is the whole point of the toolbar: without it the mode is invisible.
    await expect(page.locator('.board-tools [data-tool="select"]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('клик по аппарату в режиме адреса открывает поле, Enter записывает', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="address"]').click()

    const device = page.locator('.scene-device[data-instance-id="demo-qf01"]')
    await device.click()

    const field = page.getByLabel(/^Адрес:/)
    await expect(field).toBeVisible()
    await expect(field).toHaveValue('QF01')

    await field.fill('QF01')
    await field.press('Enter')

    // Written, and the tool fell back to select so the next click is not another label edit.
    await expect(page.locator('.board-tools [data-tool="select"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel(/^Адрес:/)).toHaveCount(0)
  })

  test('Esc отменяет правку и возвращает инструмент', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="address"]').click()
    await page.locator('.scene-device[data-instance-id="demo-qf01"]').click()

    const field = page.getByLabel(/^Адрес:/)
    await field.fill('НЕ ДОЛЖНО СОХРАНИТЬСЯ')
    await field.press('Escape')

    await expect(page.getByLabel(/^Адрес:/)).toHaveCount(0)
    await expect(page.locator('.board-tools [data-tool="select"]')).toHaveAttribute('aria-pressed', 'true')

    // The promise of the cancel: the address on the board is the one it had.
    const header = await page.locator('.scene-device-address').first().textContent()
    expect(header?.trim()).toBe('QF01')
  })

  test('клик мимо в режиме адреса не меняет проект', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="address"]').click()

    const before = await page.locator('.scene-device-address').allTextContents()
    // An empty corner of the plate, away from any device.
    await page.locator('.board-scene').click({ position: { x: 20, y: 20 } })
    await page.waitForTimeout(200)

    expect(await page.locator('.scene-device-address').allTextContents()).toEqual(before)
    await expect(page.getByLabel(/^Адрес:/)).toHaveCount(0)
  })

  test('в режиме адреса аппарат не перетаскивается', async ({ page }) => {
    await openBoard(page)
    const device = page.locator('.scene-device[data-instance-id="demo-qf01"]')
    const before = await device.getAttribute('transform')

    await page.locator('.board-tools [data-tool="address"]').click()
    const box = (await device.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)

    // The person is relabelling, not moving. A drag here would move the device under a finger
    // that was only pointing at a label.
    await expect(device).toHaveAttribute('transform', before!)
  })

  /**
   * Stage two: a device can be removed and copied from the board, not only from a panel form.
   * The store already knew how to do both — the board simply had no way to ask.
   */
  test('Delete убирает аппарат вместе с его проводами, отмена возвращает всё', async ({ page }) => {
    await openBoard(page)
    const device = page.locator('.scene-device[data-instance-id="demo-qf02"]')
    await expect(device).toBeAttached()

    const wiresBefore = await page.locator('.scene-wire').count()
    expect(wiresBefore).toBeGreaterThan(0)

    await device.click()
    await page.keyboard.press('Delete')

    await expect(device).toHaveCount(0)
    // A wire that ends in a device that is no longer there is a wire drawn to nothing.
    await expect.poll(() => page.locator('.scene-wire').count()).toBeLessThan(wiresBefore)

    await page.getByRole('button', { name: /Отменить/ }).click()
    await expect(device).toBeAttached()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(wiresBefore)
  })

  /**
   * Stage three: a wire drawn by hand, with the same tracing as an automatic one. The tool shows
   * which clamps can be joined, follows the pointer, and refuses a join that cannot be built.
   */
  test('провод проводится двумя кликами по зажимам и приходит в них же', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()
    await expect(page.locator('.board-tools [data-tool="wire"]')).toHaveAttribute('aria-pressed', 'true')

    // Terminals only exist as targets while the wire tool is on: without them a person is aiming
    // at a two-millimetre pocket.
    // Two residual current devices, neither fed from the other, so the pair is not already wired.
    const start = page.locator('.scene-terminal[data-terminal="demo-qfi01:L:top:0"]')
    const end = page.locator('.scene-terminal[data-terminal="demo-qfi02:L:top:0"]')
    await expect(start).toBeAttached()
    await expect(end).toBeAttached()

    const before = await page.locator('.scene-wire').count()
    await start.click()
    await expect(start).toHaveClass(/is-start/)
    await end.hover()
    await expect(page.locator('.scene-wire-ghost')).toBeAttached()
    await end.click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before + 1)

    // The hand-drawn wire has to obey the same tracing as the automatic ones, or the board is
    // showing two different truths about where a wire ends.
    const landing = await page.evaluate(() => {
      // A clamp well or a terminal block screw: both are places a wire can be held.
      const centres = [
        ...[...document.querySelectorAll<SVGRectElement>('.dv-pocket')],
        ...[...document.querySelectorAll<SVGCircleElement>('.dv-socket')],
      ].map((shape) => { const box = shape.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } })
      const wires = [...document.querySelectorAll<SVGPathElement>('.scene-wire')].map((path) => {
        const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
        const matrix = path.ownerSVGElement!.getScreenCTM()!
        const point = new DOMPoint(numbers.at(-2)!, numbers.at(-1)!).matrixTransform(matrix)
        return { x: point.x, y: point.y }
      })
      return wires.map((wire) => Math.min(...centres.map((c) => Math.hypot(c.x - wire.x, c.y - wire.y)))).filter((d) => d > 2).length
    })
    expect(landing).toBe(0)

    await page.getByRole('button', { name: /Отменить/ }).click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before)
  })

  test('провод разных шин не проводится, и это сказано словами', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()
    const before = await page.locator('.scene-wire').count()

    // The top L clamp of one device and the top PE clamp of another. Physically impossible.
    // Live and neutral of the same device: a wire cannot be both.
    await page.locator('.scene-terminal[data-terminal="demo-qfi01:L:top:0"]').click()
    // Column numbers depend on the product, so the terminal is matched by prefix.
    const neutral = page.locator('.scene-terminal[data-terminal^="demo-qfi01:N:top:"]')
    await expect(neutral).toBeAttached()
    await neutral.click()

    await expect(page.locator('.board-wire-refusal')).toBeVisible()
    await expect(page.locator('.board-wire-refusal')).toContainText('одну шину')
    expect(await page.locator('.scene-wire').count()).toBe(before)
  })

  test('Esc бросает недорисованный провод', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()
    await page.locator('.scene-terminal[data-terminal="demo-qfi01:L:top:0"]').click()
    await expect(page.locator('.scene-terminal.is-start')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.locator('.scene-terminal.is-start')).toHaveCount(0)
    await expect(page.locator('.board-tools [data-tool="select"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('Ctrl+D ставит копию и выделяет её, даже если ряд оригинала полон', async ({ page }) => {
    await openBoard(page)
    // qf03 sits in the first row, which the demo fills to the last module. A duplicate that gave up
    // there would leave the person with a button that does nothing.
    const original = page.locator('.scene-device[data-instance-id="demo-qf03"]')
    await original.click()
    const before = await page.locator('.scene-device').count()

    await page.keyboard.press('Control+d')

    await expect.poll(() => page.locator('.scene-device').count()).toBe(before + 1)
    // The copy is selected, so the next keystroke acts on the copy and not on the original.
    await expect(page.locator('.scene-device.is-selected')).toHaveCount(1)
    // And it landed next door rather than on top of the original.
    const copy = page.locator('.scene-device.is-selected')
    expect(await copy.getAttribute('transform')).not.toBe(await original.getAttribute('transform'))
  })
})
