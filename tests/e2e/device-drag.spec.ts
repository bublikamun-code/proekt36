import { expect, test } from '@playwright/test'
import { dragWithPointer, gotoEditor, seedProject } from './helpers'

const oneModuleRow = [
  { id: 'a', row: 0, slot: 0 },
  { id: 'b', row: 0, slot: 1 },
  { id: 'c', row: 0, slot: 2 },
]

const leftOf = async (page: import('@playwright/test').Page, id: string) => {
  const box = await page.locator(`.placed-device[data-instance-id="${id}"]`).boundingBox()
  if (!box) throw new Error(`Device ${id} is not on the board`)
  return box.x
}

test('dropping a device onto a neighbour pushes that neighbour aside', async ({ page }) => {
  await seedProject(page, oneModuleRow)
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const before = { a: await leftOf(page, 'a'), b: await leftOf(page, 'b'), c: await leftOf(page, 'c') }
  const target = page.locator('.din-row').first().locator('.slot-cell').first()

  await dragWithPointer(page, page.locator('.placed-device[data-instance-id="c"]'), target, async () => {
    // The preview must describe the outcome, not just mark a rectangle: the two
    // devices the drop displaces are shown at the positions they will land on.
    await expect(page.locator('.drop-preview')).toContainText('модуль 1')
    await expect(page.locator('.placed-device.shifting')).toHaveCount(2)
    await expect(page.locator('.slot-cell.shifted')).not.toHaveCount(0)
  })

  expect(await leftOf(page, 'c')).toBeCloseTo(before.a, -1)
  expect(await leftOf(page, 'a')).toBeCloseTo(before.b, -1)
  expect(await leftOf(page, 'b')).toBeCloseTo(before.c, -1)
  await expect(page.locator('.din-row').first().locator('.placed-device')).toHaveCount(3)
})

test('a row with no room for the neighbours explains itself and changes nothing', async ({ page }) => {
  const full = Array.from({ length: 12 }, (_, index) => ({ id: `f${index}`, row: 0, slot: index }))
  await seedProject(page, [...full, { id: 'spare', row: 1, slot: 0 }])
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const target = page.locator('.din-row').first().locator('.slot-cell').first()
  await dragWithPointer(page, page.locator('.placed-device[data-instance-id="spare"]'), target, async () => {
    await expect(page.locator('.drop-preview.blocked')).toContainText('Для сдвига соседей не хватает места в ряду')
  })

  await expect(page.locator('.din-row').first().locator('.placed-device')).toHaveCount(12)
  await expect(page.locator('.din-row').nth(1).locator('.placed-device[data-instance-id="spare"]')).toBeVisible()
})

test('Escape cancels a drag instead of dropping it', async ({ page }) => {
  await seedProject(page, oneModuleRow)
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const before = { a: await leftOf(page, 'a'), b: await leftOf(page, 'b'), c: await leftOf(page, 'c') }
  const target = page.locator('.din-row').first().locator('.slot-cell').first()
  const source = page.locator('.placed-device[data-instance-id="c"]')
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('Drag endpoints are unavailable')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + 10, sourceBox.y + sourceBox.height / 2, { steps: 3 })
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await expect(page.locator('.drop-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()

  await expect(page.locator('.drop-preview')).toHaveCount(0)
  expect(await leftOf(page, 'a')).toBeCloseTo(before.a, -1)
  expect(await leftOf(page, 'b')).toBeCloseTo(before.b, -1)
  expect(await leftOf(page, 'c')).toBeCloseTo(before.c, -1)
})

test('arrow keys move the focused device and one undo returns the whole gesture', async ({ page }) => {
  await seedProject(page, oneModuleRow)
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const before = { a: await leftOf(page, 'a'), c: await leftOf(page, 'c') }
  // The two steps have to land inside the store's coalesce window to read as one
  // gesture. Two round-trips through the driver can drift past it on a loaded
  // machine, so the keydowns are dispatched back to back in the page instead.
  await page.evaluate(() => {
    const device = document.querySelector<HTMLElement>('.placed-device[data-instance-id="c"]')
    if (!device) throw new Error('Device c is not on the board')
    device.focus()
    for (let step = 0; step < 2; step += 1) {
      device.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    }
  })

  // Two steps read as one gesture, so a single undo has to restore all three.
  // The shell has its own global announcer, so scope this one to the board.
  await expect(page.locator('.editor-2d .sr-only[aria-live]')).toContainText('QF01: ряд 1, модуль 1')
  expect(await leftOf(page, 'c')).toBeCloseTo(before.a, -1)

  await page.keyboard.press('Control+z')
  expect(await leftOf(page, 'a')).toBeCloseTo(before.a, -1)
  expect(await leftOf(page, 'c')).toBeCloseTo(before.c, -1)
})

test('a catalogue item is dragged onto the board with a pointer', async ({ page }) => {
  await seedProject(page, [{ id: 'a', row: 0, slot: 0 }])
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const item = page.locator('.catalog-item').first()
  const target = page.locator('.din-row').first().locator('.slot-cell').nth(4)
  await dragWithPointer(page, item, target, async () => {
    await expect(page.locator('.drop-preview')).toContainText('модуль 5')
    await expect(page.locator('.placed-device.is-preview')).toHaveCount(1)
  })

  await expect(page.locator('.din-row').first().locator('.placed-device')).toHaveCount(2)
  // The released click must not also fire the catalogue item's own add handler.
  await expect(page.locator('.din-row').nth(1).locator('.placed-device')).toHaveCount(0)
})
