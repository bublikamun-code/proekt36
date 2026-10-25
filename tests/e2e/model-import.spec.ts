import { expect, test, type Page } from '@playwright/test'
import { categoryLabels } from '../../src/data/catalog'
import type { Category } from '../../src/domain/types'
import { glb, standaloneGltf, zipModel } from './model-fixtures'
import { dragWithPointer, gotoEditor, openSidePanels, pickOption } from './helpers'

type ImportCase = {
  name: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
  category: Category
  ratedCurrent: number
  price: number
  weight: number
}

const importCases: ImportCase[] = [
  { name: 'Импорт GLB', fileName: 'panel-device.glb', mimeType: 'model/gltf-binary', bytes: glb(), category: 'MCB', ratedCurrent: 32, price: 1250, weight: 0.75 },
  { name: 'Импорт glTF', fileName: 'panel-device.gltf', mimeType: 'model/gltf+json', bytes: standaloneGltf(), category: 'relay', ratedCurrent: 10, price: 740, weight: 0.22 },
  { name: 'Импорт ZIP', fileName: 'panel-device.zip', mimeType: 'application/zip', bytes: zipModel(), category: 'PSU', ratedCurrent: 5, price: 1890, weight: 0.48 },
]

const importModel = async (page: Page, item: ImportCase) => {
  const input = page.locator('input[type="file"][accept*=".glb"]')
  await input.setInputFiles({
    name: item.fileName,
    mimeType: item.mimeType,
    buffer: Buffer.from(item.bytes),
  })

  const dialog = page.getByRole('dialog', { name: 'Параметры импорта' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Название').fill(item.name)
  await dialog.getByLabel('Бренд').fill('Panel36 Test')
  await dialog.getByLabel('Артикул').fill(`P36-${item.name.replaceAll(' ', '-')}`)
  await pickOption(dialog, 'Категория', categoryLabels[item.category])
  await dialog.getByLabel('Модулей').fill('2')
  await dialog.getByLabel('Ток, А').fill(String(item.ratedCurrent))
  await dialog.getByLabel('Цена, ₽').fill(String(item.price))
  await dialog.getByLabel('Вес, кг').fill(String(item.weight))
  await dialog.getByRole('button', { name: 'Добавить в библиотеку' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.model-row').filter({ hasText: item.name })).toBeVisible()
}

const countIndexedDbAssets = (page: Page) => page.evaluate(() => new Promise<number>((resolve, reject) => {
  const request = indexedDB.open('panel36-models', 1)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const database = request.result
    if (!database.objectStoreNames.contains('assets')) {
      database.close()
      resolve(0)
      return
    }
    const count = database.transaction('assets', 'readonly').objectStore('assets').count()
    count.onerror = () => reject(count.error)
    count.onsuccess = () => {
      database.close()
      resolve(count.result)
    }
  }
}))

test('GLB, standalone glTF and ZIP participate in the local device library', async ({ page }) => {
  // This one test imports three models through the real file flow, clears the
  // asset store, reloads and then wires a circuit — it needs more than the
  // default budget, and more than a bare 180 s once the suite runs in parallel.
  test.setTimeout(300_000)
  await gotoEditor(page)
  await openSidePanels(page)
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible()

  for (const item of importCases) await importModel(page, item)
  expect(await countIndexedDbAssets(page)).toBe(3)
  await expect(page.locator('.model-thumb[data-model-preview^="asset:"]')).toHaveCount(3)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  // With the binaries gone the raster preview cannot be produced, so every imported device
  // falls back to its procedural face instead of an error placeholder — the products and
  // their placements survive the loss.
  await expect(page.locator('.model-thumb[data-model-preview^="asset:"]')).toHaveCount(0)
  for (const item of importCases) {
    const card = page.locator('.catalog-item').filter({ hasText: item.name })
    await expect(card.locator('svg.device-visual')).toHaveCount(1)
    await expect(card.locator('.model-thumb')).toHaveCount(0)
  }

  // The reload closes the side panels again, and a catalogue item that is not on
  // screen cannot be grabbed with a pointer.
  await openSidePanels(page)
  await expect(page.getByRole('heading', { name: 'Каталог' })).toBeVisible()

  // The seed's first row is full, so every imported device is dragged into row two
  // (seeded with six 1-module devices, six slots free) at explicit slots.
  for (const [index, item] of importCases.entries()) {
    const source = page.locator('.catalog-item').filter({ hasText: item.name })
    const dropTarget = page.locator('.din-row').nth(1).locator('.slot-cell').nth(6 + index * 2)
    await dragWithPointer(page, source, dropTarget)
    await expect(page.locator(`.placed-device[aria-label*="${item.name}"]`)).toHaveCount(1)
  }
  await expect(page.locator('.placed-device[aria-label*="Импорт"]')).toHaveCount(3)

  for (const item of importCases) {
    await expect(page.locator('.bom-panel')).toContainText(item.name)
  }

  await page.locator('.placed-device[aria-label*="Импорт GLB"]').dispatchEvent('click')
  await page.getByRole('button', { name: '＋ Цепь' }).click()
  // The seed board ships demo lines of its own; the one just created is the last card.
  const circuitCard = page.locator('.circuit-card').last()
  await circuitCard.getByLabel('Ток, А').fill('40')
  await circuitCard.getByLabel('Ток, А').press('Tab')
  // The checks tab renders the same rules in its own list, so the assertion stays scoped
  // to the inspector copy.
  await expect(page.locator('.inspector-panel .issue-list')).toContainText('Ток цепи выше номинала защиты')

  const connectionCard = circuitCard.locator('.connection-card').first()
  const connectionId = await connectionCard.getAttribute('data-connection-id')
  expect(connectionId).toBeTruthy()
  // The board draws a conductor twice — a casing and a core — and the demo board now ships wired,
  // so a count of every path in `.wires` says nothing about the connection this test just added.
  // The core is the half that carries the connection id.
  const firstWire = page.locator(`.wires .wire-core[data-connection-id="${connectionId}"]`)
  await expect(firstWire).toHaveCount(1)
  await expect(firstWire).toHaveClass(/wire-l/)

  await pickOption(connectionCard, 'Шина', 'PE · земля')
  await connectionCard.getByLabel('Толщина').fill('4')
  await connectionCard.getByLabel('Толщина').press('Tab')
  await connectionCard.getByLabel('Цвет').evaluate((input) => {
    const colorInput = input as HTMLInputElement
    colorInput.value = '#2c7155'
    colorInput.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await connectionCard.getByLabel('Подпись').fill('PE к QF01')
  await connectionCard.getByLabel('Подпись').press('Tab')

  // The class still names the bus, so the theme keeps owning the palette; the colour the user
  // typed arrives as an inline stroke on top of it, and the thickness arrives as a stroke width.
  await expect(firstWire).toHaveClass(/wire-pe/)
  await expect(firstWire.locator('title')).toHaveText('PE к QF01')
  await expect(firstWire).toHaveCSS('stroke', 'rgb(44, 113, 85)')
  // 4 mm of conductor at the drawing's 0.4 px/mm — a 2 mm run is the 0.8 px the stylesheet uses.
  await expect(firstWire).toHaveCSS('stroke-width', '1.6px')

  await circuitCard.getByRole('button', { name: '＋ Подключение' }).click()
  await expect(circuitCard.locator('.connection-card')).toHaveCount(2)
  const secondId = await circuitCard.locator('.connection-card').nth(1).getAttribute('data-connection-id')
  await expect(page.locator(`.wires .wire-core[data-connection-id="${secondId}"]`)).toHaveCount(1)

  // The circuit the test created is numbered after the seed's demo lines, so the button is
  // matched by what it does, not by the number the seed happened to leave free.
  await circuitCard.getByRole('button', { name: /Удалить подключение 2/ }).click()
  const connectionDialog = page.getByRole('dialog', { name: 'Удалить подключение?' })
  await expect(connectionDialog).toBeVisible()
  await connectionDialog.getByRole('button', { name: 'Удалить подключение' }).click()
  await expect(circuitCard.locator('.connection-card')).toHaveCount(1)
  await expect(page.locator(`.wires .wire-core[data-connection-id="${secondId}"]`)).toHaveCount(0)

  await page.getByRole('button', { name: 'Удалить модель Импорт GLB' }).click()
  const removeDialog = page.getByRole('dialog', { name: 'Удалить модель?' })
  await expect(removeDialog).toBeVisible()
  await removeDialog.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.toast-error')).toContainText('Модель используется в 1 позициях')
})

test('print mode and local data cleanup are available in the 2D release', async ({ page }) => {
  await gotoEditor(page)
  await page.evaluate(() => {
    const target = window as Window & { __panel36Printed?: boolean }
    target.__panel36Printed = false
    target.print = () => { target.__panel36Printed = true }
  })

  await page.getByRole('button', { name: 'Печать' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __panel36Printed?: boolean }).__panel36Printed)).toBe(true)
  await expect(page.locator('.print-report')).toBeHidden()

  await page.getByRole('button', { name: /Текущий проект/ }).click()
  await page.getByRole('button', { name: 'Очистить локальные данные' }).click()
  const clearDialog = page.getByRole('dialog', { name: 'Очистить локальные данные?' })
  await expect(clearDialog).toBeVisible()
  await clearDialog.getByRole('button', { name: 'Очистить всё' }).click()
  await expect(clearDialog).toBeHidden()
  await expect(page.locator('.project-menu')).toBeHidden()
  await expect(page.locator('.model-row')).toHaveCount(0)
  await expect.poll(() => countIndexedDbAssets(page)).toBe(0)
  await expect(page.locator('.placed-device')).toHaveCount(10)
})

test('reads the legacy localStorage project format', async ({ page }) => {
  const legacyProject = {
    name: 'Мигрированный щит',
    preset: 'house',
    settings: { inputCurrent: 63, phase: 3, rows: 8, reserveModules: 4, enclosureWidth: 600, enclosureHeight: 600, enclosureDepth: 100 },
    devices: [],
    circuits: [],
    connections: [],
  }

  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify([project]))
  }, { key: 'panel36.projects.v1', project: legacyProject })
  await gotoEditor(page)

  await expect(page.getByRole('button', { name: /Текущий проект/ })).toContainText('Мигрированный щит')
  await page.getByRole('button', { name: /Текущий проект/ }).click()
  await expect(page.locator('.project-menu')).toContainText('3 ф.')
})
