import { expect, test, type Page } from '@playwright/test'
import { unlockWorkspace } from './helpers'

test.beforeEach(async ({ page }) => {
  await unlockWorkspace(page)
  await page.goto('/app/board?fixture=demo')
  await expect(page.locator('.board-scene')).toBeVisible()
})

const geometry = (page: Page) => page.locator('.board-scene').evaluate((node) => {
  const svg = node as SVGSVGElement
  const matrix = svg.getScreenCTM()!
  const rail = svg.querySelector<SVGRectElement>('.scene-drop-zone[data-row="1"]')!
  const device = svg.querySelector<SVGGElement>('[data-instance-id="demo-qf01"]')!
  const body = device.getBoundingClientRect()
  const railY = Number(rail.getAttribute('y')) + Number(rail.getAttribute('height')) / 2
  const pitch = Number(rail.getAttribute('data-module-pitch'))
  const railX = Number(rail.getAttribute('x'))
  const point = new DOMPoint(railX, railY).matrixTransform(matrix)
  return { pitch: pitch * matrix.a, railX: point.x, railY: point.y, sourceX: body.x, sourceY: body.y, width: body.width, height: body.height }
})

test('wide apparatus keeps its grab point; wires follow, undo restores both', async ({ page }) => {
  const device = page.locator('.scene-device[data-instance-id="demo-qf01"]')
  const before = await device.getAttribute('transform')
  const paths = await page.locator('.scene-wire').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))
  const g = await geometry(page)
  // Grab near the far edge, where using the pointer as the apparatus origin is most disruptive.
  const grab = g.width * 0.85
  await page.mouse.move(g.sourceX + grab, g.sourceY + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.railX + 6 * g.pitch + grab, g.railY, { steps: 12 })
  await expect(page.locator('.scene-drop-preview')).toBeVisible()
  await page.mouse.up()
  await expect(device).not.toHaveAttribute('transform', before!)
  const slot = await device.evaluate((node) => {
    const x = (node as SVGGElement).transform.baseVal.consolidate()!.matrix.e
    const rail = node.ownerDocument.querySelector('.scene-drop-zone[data-row="1"]')!
    return Math.round((x - Number(rail.getAttribute('x'))) / Number(rail.getAttribute('data-module-pitch')))
  })
  expect(slot).toBe(6)
  await expect(page.locator('.scene-wire')).toHaveCount(paths.length)
  const after = await page.locator('.scene-wire').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))
  expect(after).not.toEqual(paths)
  await page.getByRole('button', { name: /Отменить/ }).click()
  await expect(device).toHaveAttribute('transform', before!)
  expect(await page.locator('.scene-wire').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')))).toEqual(paths)
})

test('release outside the cabinet cancels the drop even after a valid preview', async ({ page }) => {
  const device = page.locator('.scene-device[data-instance-id="demo-qf01"]')
  const before = await device.getAttribute('transform')
  const g = await geometry(page)
  await page.mouse.move(g.sourceX + 5, g.sourceY + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.railX + 6 * g.pitch, g.railY, { steps: 8 })
  await expect(page.locator('.scene-drop-preview')).toBeVisible()
  // Do not wait for an animation frame before release: commit must read the final pointer.
  await page.mouse.move(5, g.railY)
  await page.mouse.up()
  await expect(device).toHaveAttribute('transform', before!)
  await expect(page.locator('.scene-drop-preview')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Отменить/ })).toBeDisabled()
})

test('escape cancels moving an apparatus without changing its wires', async ({ page }) => {
  const device = page.locator('.scene-device[data-instance-id="demo-qf01"]')
  const before = await device.getAttribute('transform')
  const g = await geometry(page)
  await page.mouse.move(g.sourceX + 5, g.sourceY + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.railX + 6 * g.pitch, g.railY, { steps: 8 })
  await expect(page.locator('.scene-drop-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(device).toHaveAttribute('transform', before!)
  await expect(page.locator('.scene-drop-preview')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Отменить/ })).toBeDisabled()
})

for (const gesture of ['tool', 'middle', 'space'] as const) {
  test(`pan with ${gesture} moves the view without moving an apparatus`, async ({ page }) => {
    await page.getByLabel('Масштаб', { exact: true }).fill('2.5')
    const canvas = page.locator('.board-scene-canvas')
    const devices = await page.locator('.scene-device').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('transform')))
    await canvas.evaluate((el) => { el.scrollLeft = 150; el.scrollTop = 150 })
    const before = await canvas.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))
    if (gesture === 'tool') await page.getByRole('button', { name: 'Переместить вид', exact: true }).click()
    if (gesture === 'space') { await canvas.focus(); await page.keyboard.down('Space') }
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: gesture === 'middle' ? 'middle' : 'left' })
    await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 - 80, { steps: 8 })
    await page.mouse.up({ button: gesture === 'middle' ? 'middle' : 'left' })
    if (gesture === 'space') await page.keyboard.up('Space')
    expect(await canvas.evaluate((el) => el.scrollTop)).toBeCloseTo(before.y + 80, 0)
    expect(await page.locator('.scene-device').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('transform')))).toEqual(devices)
    await expect(page.getByRole('button', { name: /Отменить/ })).toBeDisabled()
    await page.getByRole('button', { name: 'Вписать', exact: true }).click()
    await expect(page.getByLabel('Масштаб', { exact: true })).toHaveValue('1')
    expect(await canvas.evaluate((el) => el.scrollTop)).toBe(0)
    await expect(page.locator('.board-scene')).toBeInViewport({ ratio: 0.99 })
  })
}

test('Ctrl-wheel zoom keeps the board coordinate under the pointer', async ({ page }) => {
  await page.getByLabel('Масштаб', { exact: true }).fill('2')
  const canvas = page.locator('.board-scene-canvas')
  await canvas.evaluate((el) => { el.scrollLeft = 150; el.scrollTop = 150 })
  const box = (await canvas.boundingBox())!
  const cursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const point = await page.locator('.board-scene').evaluate((node, at) => {
    const p = new DOMPoint(at.x, at.y).matrixTransform((node as SVGSVGElement).getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }, cursor)
  await page.mouse.move(cursor.x, cursor.y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect(page.getByLabel('Масштаб', { exact: true })).toHaveValue('2.1')
  const after = await page.locator('.board-scene').evaluate((node, p) => {
    const at = new DOMPoint(p.x, p.y).matrixTransform((node as SVGSVGElement).getScreenCTM()!)
    return { x: at.x, y: at.y }
  }, point)
  expect(Math.abs(after.x - cursor.x)).toBeLessThan(2)
  expect(Math.abs(after.y - cursor.y)).toBeLessThan(2)
})


test('Space on a wire terminal activates the contact without starting viewport pan', async ({ page }) => {
  await page.getByRole('button', { name: 'Провести', exact: true }).click()
  await page.locator('[data-terminal="demo-qf01:L:top:0"]').focus()
  await page.keyboard.down('Space')
  await expect(page.locator('.scene-terminal.is-start')).toHaveCount(1)
  await expect(page.locator('.board-scene-canvas')).not.toHaveClass(/can-pan/)
  await page.keyboard.up('Space')
  await page.keyboard.press('Escape')
  await expect(page.locator('.scene-terminal.is-start')).toHaveCount(0)
})
