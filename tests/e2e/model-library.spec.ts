import { expect, test, type Page } from '@playwright/test'
import { glb } from './model-fixtures'
import { dragWithPointer, gotoEditor, pickOption } from './helpers'

const importFirstFile = async (page: Page, options: { createProduct: boolean; name?: string }) => {
  const input = page.locator('input[type="file"][accept*=".glb"]')
  await input.setInputFiles({
    name: 'revive-device.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(glb()),
  })
  const dialog = page.getByRole('dialog', { name: 'Параметры импорта' })
  await expect(dialog).toBeVisible()
  if (options.name) await dialog.getByLabel('Название').fill(options.name)
  if (!options.createProduct) await dialog.getByLabel('Создать товар-заготовку в каталоге').uncheck()
  await dialog.getByRole('button', { name: /Добавить в библиотеку|Обновить модель/ }).click()
  await expect(dialog).toBeHidden()
}

const clearIndexedDbAssets = (page: Page) => page.evaluate(() => new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('panel36-models', 1)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const database = request.result
    const transaction = database.transaction('assets', 'readwrite')
    transaction.objectStore('assets').clear()
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
  }
}))

test('re-importing the same file refreshes the asset in place and revives placements', async ({ page }) => {
  test.setTimeout(180_000)
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible()

  await importFirstFile(page, { createProduct: true, name: 'Возрождаемый аппарат' })
  await expect(page.locator('.model-row').filter({ hasText: 'Возрождаемый аппарат' })).toHaveCount(1)

  // Place the imported product, then wipe the binaries the way a browser eviction would.
  // The seed's first rail is full, so the placement is a drag into the free half of row two.
  const source = page.locator('.catalog-item').filter({ hasText: 'Возрождаемый аппарат' })
  await dragWithPointer(page, source, page.locator('.din-row').nth(1).locator('.slot-cell').nth(6))
  await expect(page.locator('.placed-device[aria-label*="Возрождаемый аппарат"]')).toHaveCount(1)
  await clearIndexedDbAssets(page)
  await page.reload({ waitUntil: 'domcontentloaded' })

  // The reconcile marks the asset missing instead of leaving a dead preview, and the
  // placement survives on the procedural face.
  await expect(page.locator('.model-row.is-missing').filter({ hasText: 'Возрождаемый аппарат' })).toBeVisible()
  await expect(page.locator('.placed-device[aria-label*="Возрождаемый аппарат"] svg.device-visual')).toHaveCount(1)

  const reopenPanels = page.getByRole('button', { name: 'Показать боковые панели' })
  if (await reopenPanels.isVisible()) await reopenPanels.click()
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible()

  // The same file returns: the dialog offers an in-place refresh instead of a duplicate.
  const input = page.locator('input[type="file"][accept*=".glb"]')
  await input.setInputFiles({
    name: 'revive-device.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(glb()),
  })
  const dialog = page.getByRole('dialog', { name: 'Параметры импорта' })
  await expect(dialog).toContainText('будет обновлена на месте')
  await dialog.getByRole('button', { name: 'Обновить модель' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.locator('.model-row').filter({ hasText: 'Возрождаемый аппарат' })).not.toHaveClass(/is-missing/)
  await expect(page.locator('.model-row')).toHaveCount(1)
  await expect(page.locator('.placed-device .model-thumb[data-model-preview^="asset:"]')).toHaveCount(1)
  await expect(page.locator('.placed-device[aria-label*="Возрождаемый аппарат"]')).toHaveCount(1)
})

test('an asset can live without a product and then bind to a catalogue entry', async ({ page }) => {
  test.setTimeout(180_000)
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible()

  await importFirstFile(page, { createProduct: false, name: 'Полка без товара' })
  await expect(page.locator('.model-row').filter({ hasText: 'Полка без товара' })).toHaveCount(1)

  // No stub was created, so the model is not searchable in the catalogue.
  const search = page.getByLabel('Поиск по каталогу')
  await search.fill('Полка без товара')
  await expect(page.locator('.catalog-item')).toHaveCount(0)
  // A concrete product, because the seed board already carries AVO devices: the drag
  // lands in row two and the freshly placed instance is the one that gets selected.
  await search.fill('AVO-10 4P B32')
  const item = page.locator('.catalog-item').filter({ hasText: 'AVO-10 4P B32' }).first()
  await dragWithPointer(page, item, page.locator('.din-row').nth(1).locator('.slot-cell').nth(6))
  await page.locator('.din-row').nth(1).locator('.placed-device').last().dispatchEvent('click')

  // The inspector offers the library model on a built-in product, and the badge follows.
  await pickOption(page.locator('.inspector-panel'), 'CAD-модель', 'Полка без товара')
  await expect(page.locator('.inspector-panel .model-preview')).toBeVisible()
  await expect(page.locator('.catalog-item').filter({ hasText: 'AVO-10 4P B32' }).locator('.cad-badge')).toHaveCount(1)
})

test('a device whose product left the catalogue can be re-bound to a real product', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('panel36.projects.v2', JSON.stringify([{
      schemaVersion: 2,
      id: 'orphan-rebind', name: 'Замена товара', preset: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      settings: { inputCurrent: 63, phase: 1, rows: 2, reserveModules: 8, enclosureWidth: 310, enclosureHeight: 350, enclosureDepth: 105, cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' },
      devices: [{ instanceId: 'orphan-1', productId: 'no-such-product', row: 0, slot: 0, address: 'Q1', quantity: 1, phase: 1, note: '', marking: 'Q1', mount: 'din' }],
      circuits: [], connections: [],
    }]))
  })
  await gotoEditor(page)
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()

  const orphan = page.locator('.placed-device.missing-product')
  await expect(orphan).toHaveCount(1)
  await orphan.dispatchEvent('click')
  await expect(page.locator('.missing-product-card')).toBeVisible()

  await pickOption(page.locator('.inspector-panel'), 'Заменить товар', /AVO-10/)
  await expect(page.locator('.placed-device.missing-product')).toHaveCount(0)
  await expect(page.locator('.placed-device svg.device-visual')).toHaveCount(1)
})
