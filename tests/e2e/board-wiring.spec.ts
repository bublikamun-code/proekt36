import { expect, test, type Page } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * The wiring itself: where a wire comes from, what it ends at, and what can be done with it.
 *
 * The wire tool could already join two clamps, but that was the whole of it. A panel whose wires
 * come from the bus — which is where every wire in a real panel comes from — could not be drawn at
 * all: the store had no way to record a feed and the board had nothing to click for one. A wire
 * could not be picked either, so the only way to remove one was to delete a device it happened to
 * touch.
 */
const openBoard = async (page: Page) => {
  await unlockWorkspace(page)
  await page.goto('/app/board?fixture=demo')
  await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.scene-device').first()).toBeAttached()
}

/**
 * Clicks a wire where it starts, which is the one point of its path that belongs to no other wire.
 *
 * `locator.click()` aims at the middle of the bounding box, and for a path shaped like a bracket that
 * point is usually not on the line at all — it is in the empty corner beside it, often on a
 * neighbour. A person clicks the line; this clicks the line too, and checks that the browser
 * actually delivered the click to the wire being tested rather than to whatever overlaps it.
 */
const clickWire = async (page: Page, wireId: string) => {
  const point = await page.evaluate((id) => {
    const path = document.querySelector<SVGPathElement>(`.scene-wire-hit[data-wire-id="${id}"]`)
    if (!path) return null
    const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    const matrix = path.ownerSVGElement!.getScreenCTM()!
    const start = new DOMPoint(numbers[0]!, numbers[1]!).matrixTransform(matrix)
    return { x: start.x, y: start.y }
  }, wireId)
  if (!point) throw new Error(`Провод ${wireId} не нарисован`)
  await page.mouse.click(point.x, point.y)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-wire-id') ?? '', point)
  expect(hit).toBe(wireId)
}

const firstWireId = async (page: Page) => page.locator('.scene-wire-hit').first().getAttribute('data-wire-id')

test.describe('провода доски', () => {
  test.setTimeout(180_000)

  test('шины нарисованы над рядами, и каждый провод выходит из своей', async ({ page }) => {
    await openBoard(page)

    const rails = await page.evaluate(() => [...document.querySelectorAll('.scene-bus')].map((group) => {
      const rect = group.querySelector('rect')!
      return {
        label: group.querySelector('text')?.textContent ?? '',
        x: Number(rect.getAttribute('x')),
        width: Number(rect.getAttribute('width')),
        bottom: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')),
      }
    }))
    expect(rails.map((rail) => rail.label)).toEqual(['L', 'N', 'PE'])

    // The rails sit in the margin above the first row, which no device can reach: a rail drawn over
    // the devices would be a wire crossing the very clamps it feeds.
    const firstRow = await page.evaluate(() => Number(document.querySelector('.scene-drop-zone')!.getAttribute('y')))
    for (const rail of rails) expect(rail.bottom).toBeLessThanOrEqual(firstRow)

    // And each feed leaves the rail of its own bus, at a point on that rail — not out of the left
    // margin, which is where every one of these wires used to begin.
    const wires = await page.evaluate(() => [...document.querySelectorAll('.scene-wire')].map((path) => {
      const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      return {
        bus: [...(path.classList)].find((name) => name.startsWith('scene-wire-'))?.replace('scene-wire-', '') ?? '',
        start: { x: numbers[0]!, y: numbers[1]! },
      }
    }))
    const fed = wires.filter((wire) => rails.some((rail) => Math.abs(wire.start.y - rail.bottom) < 0.01))
    expect(fed.length).toBeGreaterThan(1)
    for (const wire of fed) {
      const rail = rails.find((candidate) => Math.abs(wire.start.y - candidate.bottom) < 0.01)!
      expect(wire.start.x).toBeGreaterThanOrEqual(rail.x)
      expect(wire.start.x).toBeLessThanOrEqual(rail.x + rail.width)
      expect(['l', 'n', 'pe']).toContain(wire.bus)
    }
  })

  test('инструмент «Провести» соединяет зажим с шиной щита', async ({ page }) => {
    await openBoard(page)
    await page.locator('.board-tools [data-tool="wire"]').click()

    // QFI03 stands on the board with nothing wired to it, so a wire appearing here can only be the
    // one this test draws.
    const terminal = page.locator('.scene-terminal[data-terminal="demo-qfi03:L:top:0"]')
    await expect(terminal).toBeAttached()
    const before = await page.locator('.scene-wire').count()

    // The bus is a target of the same kind as a clamp: a rail is where a wire is held too.
    const bus = page.locator('.scene-bus-target[data-bus="L"]')
    await expect(bus).toBeAttached()
    await expect(page.locator('.scene-terminal').first()).toBeVisible()

    const railBottom = await page.evaluate(() => {
      const rect = document.querySelector<SVGRectElement>('.scene-bus rect')!
      return Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))
    })

    await terminal.click()
    await bus.click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before + 1)

    // The wire leaves the L rail and arrives in the clamp that was clicked.
    // Which wire is the new one is asked of the drawing, not assumed from its position in the list:
    // wires are grouped by the rail they come from and spread along it, so the newest one is not
    // the last in the document.
    const drawn = await page.evaluate((expectedRailY) => {
      // Both the path and the device group are in board millimetres, so the comparison is made in
      // those: a clamp's own x/y are local to its device, and mixing them with the path's numbers
      // compares two different millimetres and finds nothing.
      const group = document.querySelector<SVGGElement>('.scene-device[data-instance-id="demo-qfi03"]')!
      const place = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(group.getAttribute('transform') ?? '')
      const dx = Number(place?.[1] ?? 0)
      const dy = Number(place?.[2] ?? 0)
      const clamps = [
        ...[...group.querySelectorAll<SVGRectElement>('.dv-pocket')].map((rect) => ({
          x: dx + Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2,
          y: dy + Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2,
        })),
        ...[...group.querySelectorAll<SVGCircleElement>('.dv-socket')].map((circle) => ({
          x: dx + Number(circle.getAttribute('cx')),
          y: dy + Number(circle.getAttribute('cy')),
        })),
      ]
      const wires = [...document.querySelectorAll<SVGPathElement>('.scene-wire')].map((path) => {
        const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
        const end = { x: numbers.at(-2)!, y: numbers.at(-1)! }
        return { startsOnRail: Math.abs(numbers[1]! - expectedRailY) < 0.01, landed: Math.min(...clamps.map((clamp) => Math.hypot(clamp.x - end.x, clamp.y - end.y))) }
      })
      return wires.find((wire) => wire.landed < 0.5) ?? null
    }, railBottom)

    expect(drawn).not.toBeNull()
    expect(drawn!.startsOnRail).toBe(true)
    expect(drawn!.landed).toBeLessThan(2)

    // A feed from the bus is not a line of a circuit, so no check may ask for the circuit back.
    await expect(page.locator('.scene-device[data-instance-id="demo-qfi03"].has-issue')).toHaveCount(0)
    await page.getByRole('button', { name: /Отменить/ }).click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(before)
  })

  test('провод выбирается, читается, правится и удаляется', async ({ page }) => {
    await openBoard(page)
    const wireId = await firstWireId(page)
    expect(wireId).toBeTruthy()

    await clickWire(page, wireId!)
    const inspector = page.getByTestId('board-wire-inspector')
    await expect(inspector).toBeVisible()
    await expect(inspector.locator('.board-wire-route')).toContainText('→')
    await expect(page.locator(`.scene-wire-hit[data-wire-id="${wireId}"]`)).toHaveClass(/is-selected/)

    // A conductor cannot be reassigned to a bus its physical clamp does not carry.
    await inspector.getByLabel('Шина провода').click()
    await page.getByRole('option', { name: /^PE/ }).click()
    await expect(page.getByRole('alert')).toContainText('нет подключения PE')
    await expect(page.locator(`.scene-wire[data-wire-id="${wireId}"]`)).toHaveClass(/scene-wire-l/)
    await inspector.getByLabel('Толщина линии, мм').fill('3')
    await inspector.getByLabel('Толщина линии, мм').press('Tab')
    await expect(page.locator(`.scene-wire[data-wire-id="${wireId}"]`)).toHaveAttribute('stroke-width', '3')
    await page.getByRole('button', { name: /Отменить/ }).click()

    // Delete removes the wire and nothing else; undo brings it back.
    const devicesBefore = await page.locator('.scene-device').count()
    const wiresBefore = await page.locator('.scene-wire').count()
    await clickWire(page, wireId!)
    await page.keyboard.press('Delete')
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(wiresBefore - 1)
    await expect(page.locator('.scene-device')).toHaveCount(devicesBefore)
    await page.getByRole('button', { name: /Отменить/ }).click()
    await expect.poll(() => page.locator('.scene-wire').count()).toBe(wiresBefore)
  })

  test('клик по пустому месту снимает выделение', async ({ page }) => {
    await openBoard(page)
    const wireId = await firstWireId(page)
    await clickWire(page, wireId!)
    await expect(page.getByTestId('board-wire-inspector')).toBeVisible()

    // Below the last row is bare plate: the one place a click cannot mean a device or a wire.
    const bare = await page.evaluate(() => {
      const plate = document.querySelector('.scene-plate')!.getBoundingClientRect()
      return { x: plate.x + plate.width * 0.5, y: plate.y + plate.height * 0.985 }
    })
    await page.mouse.click(bare.x, bare.y)
    await expect(page.getByTestId('board-wire-inspector')).toHaveCount(0)
  })

  test('доска помещается в окно целиком', async ({ page }) => {
    await openBoard(page)
    const fit = await page.evaluate(() => {
      const scene = document.querySelector('.board-scene')!.getBoundingClientRect()
      return { bottom: Math.round(scene.bottom), height: Math.round(window.innerHeight), top: Math.round(scene.top) }
    })
    // Fitting by width alone left the lower rows below the fold, on a workspace whose whole point
    // is the whole panel.
    expect(fit.top).toBeGreaterThan(0)
    expect(fit.bottom).toBeLessThanOrEqual(fit.height)
  })
})