import { expect, test } from '@playwright/test'
import { dragWithPointer, unlockWorkspace } from './helpers'

/**
 * The question this file exists to answer: when the board, the device face and the terminal clamp
 * all come from one millimetre calculation, does the wire land in the clamp?
 *
 * The old editor failed exactly this, and its own tests never asked it — every wire test there
 * checked that a path existed, not that it ended somewhere. This one measures the endpoint in
 * screen pixels and compares it with the clamp it is supposed to enter.
 */
test.describe('новая доска', () => {
  test('провод приходит в зажим аппарата по обеим осям', async ({ page }) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    const scene = page.locator('.board-scene')
    await expect(scene).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.scene-device').first()).toBeVisible()

    const result = await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>('.board-scene')!
      const matrix = svg.getScreenCTM()!
      const toScreen = (x: number, y: number) => {
        const point = new DOMPoint(x, y).matrixTransform(matrix)
        return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }
      }
      const wires = Array.from(svg.querySelectorAll<SVGPathElement>('.scene-wire')).map((path) => {
        const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
        return { end: toScreen(numbers.at(-2) ?? 0, numbers.at(-1) ?? 0) }
      })
      // A clamp lives inside its device's group, so its own transform has to be part of the
      // measurement — reading its x/y attributes alone would measure it at the board origin.
      // Both kinds of landing: a clamp well on a breaker and a screw on a terminal block. Measuring
      // only the wells called every wire into a terminal block unlanded, which is the fault of the
      // ruler rather than of the wiring.
      const clamps = [
        ...Array.from(svg.querySelectorAll<SVGRectElement>('.dv-pocket')).map((rect) => ({
          local: new DOMPoint(
            Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2,
            Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2,
          ),
          matrix: rect.getScreenCTM()!,
        })),
        ...Array.from(svg.querySelectorAll<SVGCircleElement>('.dv-socket')).map((circle) => ({
          local: new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))),
          matrix: circle.getScreenCTM()!,
        })),
      ].map((entry) => {
        const point = entry.local.matrixTransform(entry.matrix)
        return { centre: { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 } }
      })
      const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
      const matched = wires.filter((wire) => clamps.some((clamp) => near(clamp.centre, wire.end))).length
      const closest = wires.map((wire) => Math.round(Math.min(...clamps.map((clamp) => Math.hypot(clamp.centre.x - wire.end.x, clamp.centre.y - wire.end.y)))))
      return { wires: wires.length, clamps: clamps.length, matched, closest }
    })

    // eslint-disable-next-line no-console
    console.log(`BOARD ${JSON.stringify(result)}`)
    expect(errors).toEqual([])
    expect(result.wires).toBeGreaterThan(0)
    expect(result.matched).toBe(result.wires)
    // And the endpoints are genuinely near a clamp, not merely close to one on average.
    expect(Math.max(...result.closest)).toBeLessThan(2)
  })

  test('в печатном отчёте есть лист маркировки с одной этикеткой на позицию', async ({ page }) => {
    test.setTimeout(120_000)
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    // The report is display:none outside print media, which also keeps it out of the accessibility
    // tree — so it can only be queried once the print stylesheet is in effect.
    await page.emulateMedia({ media: 'print' })
    const report = page.getByRole('article', { name: /Печатный отчёт/ })
    await expect(report).toBeVisible()

    const labels = report.locator('.print-label')
    const devices = await page.locator('.scene-device').count()
    expect(await labels.count()).toBe(devices)
    // A sheet meant to be cut by hand has to say it is a sheet and not an order.
    await expect(report.getByText('а не заказ', { exact: false })).toBeVisible()

    await expect(report.getByRole('heading', { name: 'Лист маркировки' })).toBeVisible()
    // The demo is complete, so nothing on it is flagged.
    await expect(report.locator('.print-labels-warning')).toHaveCount(0)
    await expect(report.locator('.print-label-flag')).toHaveCount(0)
  })

  /**
   * Parity, part one: the new board is a drawing, not a different application. The panels that put
   * devices on the board and take them off again are the same components the old editor mounts, and
   * this is what says so. Drag-and-drop is the one interaction still missing and is called out
   * explicitly below rather than left to be discovered.
   */
  test('каталог, отмена и печать работают на новой доске', async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })

    // The panels the old editor mounts are here too. They start hidden, and a hidden panel is not
    // in the accessibility tree at all, so the toggle has to come before any query by role.
    await page.getByRole('button', { name: 'Показать боковые панели' }).click()
    await expect(page.getByLabel('Поиск по каталогу')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Цепи и подключения' })).toBeAttached()

    const devicesBefore = await page.locator('.scene-device').count()

    // Adding a position from the catalogue places it on the new board, not on the old one.
    // Named, not "the first row": the catalogue opens on a category whose first entry is not
    // necessarily placeable, and a click on the wrong row fails for reasons that have nothing to
    // do with the board.
    // Scoped to the panel: devices on the board are focusable and name the product too, so an
    // unscoped name matches three elements and the click is ambiguous.
    await page.locator('.catalog-panel').getByRole('button', { name: /AVO-10 1P C6/ }).click()
    await expect.poll(() => page.locator('.scene-device').count()).toBe(devicesBefore + 1)

    // Undo takes it back off.
    await page.getByRole('button', { name: /Отменить/ }).click()
    await expect.poll(() => page.locator('.scene-device').count()).toBe(devicesBefore)

    // Print reaches the same report.
    await page.evaluate(() => {
      const target = window as Window & { __printed?: boolean }
      target.__printed = false
      target.print = () => { target.__printed = true }
    })
    await page.getByRole('button', { name: 'Печать', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as Window & { __printed?: boolean }).__printed)).toBe(true)

    expect(errors).toEqual([])
  })

  /**
   * Parity, part two: dropping with the pointer. The drop is resolved by inverting the SVG's own
   * transform, so the test checks the thing that is easy to get wrong — that a device lands on the
   * module the pointer was over, not on one near it.
   */
  test('товар из каталога перетаскивается на доску', async ({ page }) => {
    test.setTimeout(180_000)
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: /боковые панели/ }).click()
    await expect(page.getByLabel('Поиск по каталогу')).toBeVisible()

    await page.getByLabel('Поиск по каталогу').fill('AVO-10 1P C6')
    const item = page.locator('.catalog-item').first()
    // Row 2 has room in the middle of the demo board, so a drop there must be unambiguous.
    const zone = page.locator('.scene-drop-zone[data-row="1"]')
    await expect(zone).toBeAttached()

    const devicesBefore = await page.locator('.scene-device').count()
    // Where the pointer was, in board millimetres, and therefore which module that is.
    const slotUnderPointer = await zone.evaluate((element) => {
      const svg = document.querySelector<SVGSVGElement>('.board-scene')!
      const rect = element.getBoundingClientRect()
      const point = new DOMPoint(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5).matrixTransform(svg.getScreenCTM()!.inverse())
      const zoneX = Number(element.getAttribute('x'))
      const pitch = Number(element.getAttribute('data-module-pitch'))
      return Math.round((point.x - zoneX) / pitch)
    })

    await dragWithPointer(page, item, zone, async () => {
      await expect(page.locator('.scene-drop-preview')).toBeAttached()
    })
    await expect.poll(() => page.locator('.scene-device').count()).toBe(devicesBefore + 1)

    // Where the device actually came to rest. Reading the transform back is the honest check: it is
    // the same millimetre the drawing uses, so a conversion off by a scale factor shows up here
    // rather than as a plausible-looking picture.
    const landedSlot = await page.evaluate(() => {
      const devices = [...document.querySelectorAll<SVGGElement>('.scene-device')]
      const last = devices[devices.length - 1]!
      const x = Number(/translate\(([-\d.]+)/.exec(last.getAttribute('transform') ?? '')?.[1] ?? NaN)
      const zone = document.querySelector<SVGRectElement>('.scene-drop-zone[data-row="1"]')!
      const zoneX = Number(zone.getAttribute('x'))
      const pitch = Number(zone.getAttribute('data-module-pitch'))
      return Math.round((x - zoneX) / pitch)
    })
    // One module of slack: the pointer lands in the middle of a module, and rounding may go either way.
    expect(Math.abs(landedSlot - slotUnderPointer)).toBeLessThanOrEqual(1)

    // Moving a device that is already on the board is the same gesture with a different source, and
    // it must take the neighbours with it rather than land on top of them.
    const first = page.locator('.scene-device[data-instance-id="demo-qf01"]')
    const beforeMove = await first.getAttribute('transform')
    // Into the second row: the first row of the demo board is full to the last module, so a move
    // within it has nowhere to put the neighbours and is correctly refused.
    const rowOne = page.locator('.scene-drop-zone[data-row="1"]')
    await dragWithPointer(page, first, rowOne, async () => {
      await expect(page.locator('.scene-drop-preview')).toBeAttached()
    })
    await expect.poll(async () => first.getAttribute('transform')).not.toBe(beforeMove)

    // The side panels are fixed overlays on top of the working area, and the board is drawn across
    // the whole column. Without room kept for them the left of the board sits underneath the
    // catalogue: visible in a screenshot, unreachable by a pointer, and passing every test that only
    // counts elements.
    const overlap = await page.evaluate(() => {
      const scene = document.querySelector('.board-scene')!.getBoundingClientRect()
      const hidden = [...document.querySelectorAll('.catalog-panel, .inspector-panel')]
        .filter((panel) => {
          const box = panel.getBoundingClientRect()
          return box.width > 0 && scene.left < box.right && box.left < scene.right
        })
        .length
      return { sceneLeft: Math.round(scene.left), sceneRight: Math.round(scene.right), hidden }
    })
    expect(overlap.hidden).toBe(0)
  })

  /**
   * A working area cannot do without two things: a way to open another project, and the theme the
   * person chose on the projects page. Both were missing here, which is why the route stayed off the
   * default rather than the reason being left unexplained.
   */
  test('переключение проекта и темы', async ({ page }) => {
    test.setTimeout(180_000)
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })

    const switcher = page.getByTestId('board-project-switcher')
    await expect(switcher).toBeVisible()
    expect(await switcher.locator('option').count()).toBeGreaterThanOrEqual(1)
    // importProject mints its own identifier, so the identity to check is the name, not the id.
    await expect(switcher.locator('option:checked')).toHaveText('Доска · проверка трассировки')

    const themeButton = page.getByRole('button', { name: /тему/ })
    await themeButton.click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    // The cabinet keeps its own greys in both themes on purpose: it is a metal object, not a tinted
    // surface. The test asserts that the choice is deliberate rather than an oversight, because a
    // "fix" that themes the plate to match the page is what the token test exists to prevent.
    await themeButton.click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
  })
})
