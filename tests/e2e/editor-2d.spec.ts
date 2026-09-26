import { expect, test } from '@playwright/test'
import { dragWithPointer, gotoEditor } from './helpers'

test('focused 2D mode hides side panels and fits the cabinet', async ({ page }) => {
  await gotoEditor(page)

  await expect(page.getByRole('button', { name: '3D вид' })).toHaveCount(0)
  await expect(page.locator('.viewer-3d')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveClass(/canvas-focus/)
  await expect(page.locator('.catalog-panel')).toBeHidden()
  await expect(page.locator('.inspector-panel')).toBeHidden()
  await expect(page.locator('.bom-panel')).toBeHidden()

  const scrollBox = await page.locator('.canvas-scroll').boundingBox()
  const cabinetBox = await page.locator('.cabinet').boundingBox()

  if (!scrollBox || !cabinetBox) throw new Error('Canvas geometry is unavailable')

  expect(cabinetBox.x).toBeGreaterThanOrEqual(scrollBox.x - 1)
  expect(cabinetBox.y).toBeGreaterThanOrEqual(scrollBox.y - 1)
  expect(cabinetBox.x + cabinetBox.width).toBeLessThanOrEqual(
    scrollBox.x + scrollBox.width + 1,
  )
  expect(cabinetBox.y + cabinetBox.height).toBeLessThanOrEqual(
    scrollBox.y + scrollBox.height + 1,
  )

  const viewportBeforePanels = await page.locator('.canvas-scroll').boundingBox()
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  const viewportAfterPanels = await page.locator('.canvas-scroll').boundingBox()
  if (!viewportBeforePanels || !viewportAfterPanels) throw new Error('Viewport geometry is unavailable')

  expect(Math.abs(viewportAfterPanels.x - viewportBeforePanels.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(viewportAfterPanels.width - viewportBeforePanels.width)).toBeLessThanOrEqual(1)
  await expect(page.locator('.app-shell')).toHaveClass(/canvas-focus/)
  await expect(page.locator('.app-shell')).toHaveClass(/panels-open/)
  await expect(page.locator('.catalog-panel')).toBeVisible()
  await expect(page.locator('.inspector-panel')).toBeVisible()
  await expect(page.locator('.bom-panel')).toBeVisible()
})

test('DIN drag shows a stable insertion preview before committing the move', async ({ page }) => {
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const source = page.locator('.placed-device').first()
  const instanceId = await source.getAttribute('data-instance-id')
  if (!instanceId) throw new Error('Placed device has no instance id')

  const target = page.locator('.din-row').nth(1).locator('.slot-cell').nth(10)
  await dragWithPointer(page, source, target, async () => {
    await expect(page.locator('.drop-preview')).toBeVisible()
    await expect(page.locator('.drop-preview')).toContainText('модуль')
  })

  await expect(page.locator(`.din-row`).nth(1).locator(`.placed-device[data-instance-id="${instanceId}"]`)).toBeVisible()
})

test('2D DIN slots and the position pad use one-based labels', async ({ page }) => {
  await gotoEditor(page)
  await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()

  const firstRow = page.locator('.din-row').first()
  const slots = firstRow.locator('.slot-cell')
  await expect(slots).toHaveCount(29)
  await expect(slots.first()).toHaveAttribute('aria-label', 'Ряд 1, модуль 1. Свободен. Добавить устройство')
  await expect(slots.last()).toHaveAttribute('aria-label', 'Ряд 1, модуль 29. Свободен. Добавить устройство')

  await page.locator('.placed-device').first().click()
  const positionPad = page.getByLabel('Позиционирование устройства')
  const padSlots = positionPad.locator('.pad-slot')
  await expect(padSlots.first()).toHaveAttribute('aria-label', 'Переместить в ряд 1, модуль 1')
  await expect(padSlots.nth(28)).toHaveAttribute('aria-label', 'Переместить в ряд 1, модуль 29')
})

test('City9 2P sample renders the bundled CAD preview in the 2D editor', async ({ page }) => {
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  const search = page.getByLabel('Поиск по каталогу')
  await search.fill('City9 MCB 2P')
  const item = page.locator('.catalog-item').filter({ hasText: 'City9 MCB 2P C16' })
  await expect(item).toHaveCount(1)
  await expect(item.locator('.cad-badge')).toHaveText('CAD')
  await expect(item.locator('[data-model-preview="/models/city9-mcb-2p.glb"]')).toHaveCount(1)
  await item.click()

  const placed = page.locator('.placed-device').filter({ hasText: 'CITY9-MCB' })
  await expect(placed).toHaveCount(1)
  await expect(placed.locator('[data-model-preview="/models/city9-mcb-2p.glb"]')).toHaveAttribute('data-model-preview', '/models/city9-mcb-2p.glb')
})

test('a project referencing a product outside the catalogue still renders', async ({ page }) => {
  // The JSON import path validates referential integrity between devices, circuits
  // and connections, but not catalogue membership, so an unknown productId can reach
  // the editor. The board must degrade to a labelled placeholder, not unmount.
  await page.addInitScript(() => {
    localStorage.setItem('panel36.projects.v2', JSON.stringify([{
      schemaVersion: 2,
      id: 'orphan-product', name: 'Ссылка на отсутствующий товар', preset: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      settings: { inputCurrent: 63, phase: 1, rows: 2, reserveModules: 8, enclosureWidth: 310, enclosureHeight: 350, enclosureDepth: 105, cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' },
      devices: [{ instanceId: 'orphan-1', productId: 'no-such-product', row: 0, slot: 0, address: 'Q1', quantity: 1, phase: 1, note: '', marking: 'Q1', mount: 'din' }],
      circuits: [], connections: [],
    }]))
  })
  await gotoEditor(page)

  await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  const orphan = page.locator('.placed-device.missing-product')
  await expect(orphan).toHaveCount(1)
  await expect(orphan).toContainText('нет в каталоге')
  await expect(orphan).toHaveAttribute('aria-label', /товар отсутствует в каталоге/)
  await expect(page.locator('.app-shell')).toBeVisible()
})

test('the print report module total matches the per-row table', async ({ page }) => {
  await gotoEditor(page)
  // The report is display:none outside print media, so it is outside the
  // accessibility tree and cannot be addressed by role.
  const report = page.locator('.print-report')
  const summary = await report.locator('.print-summary').textContent()
  const total = Number(/Занято(\d+) мод\./.exec(summary ?? '')?.[1] ?? '-1')
  expect(total).toBeGreaterThanOrEqual(0)

  const cells = await report.locator('.print-rack-summary tbody tr td:nth-child(2)').allTextContents()
  const rowsTotal = cells.reduce((sum, cell) => sum + Number(/\d+/.exec(cell ?? '')?.[0] ?? 0), 0)
  expect(total).toBe(rowsTotal)
})

test('deleting a device from the editor toolbar asks first', async ({ page }) => {
  await gotoEditor(page)

  const devices = page.locator('.placed-device')
  // The board paints asynchronously, so count() on its own can read an empty page on a slow machine.
  await expect(devices.first()).toBeVisible()
  const before = await devices.count()
  expect(before).toBeGreaterThan(0)

  await devices.first().click()
  const remove = page.getByRole('button', { name: 'Удалить', exact: true })
  await expect(remove).toBeEnabled()
  await remove.click()

  // Deleting an appliance takes its connections with it, so it goes through the same
  // app-wide confirmation the inspector uses rather than firing straight from the click.
  const dialog = page.getByRole('dialog', { name: 'Удалить устройство?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog).toBeHidden()
  await expect(devices).toHaveCount(before)

  await remove.click()
  await dialog.getByRole('button', { name: 'Удалить устройство' }).click()
  await expect(dialog).toBeHidden()
  await expect(devices).toHaveCount(before - 1)
})
