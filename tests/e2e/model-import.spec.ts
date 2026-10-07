import { expect, test, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { categoryLabels } from '../../src/data/catalog'
import type { Category } from '../../src/domain/types'
import { dragWithPointer, gotoEditor, openSidePanels, pickOption } from './helpers'

const positions = new Float32Array([
  -0.6, -0.5, 0,
  0.6, -0.5, 0,
  0, 0.6, 0,
])
const textureCoordinates = new Float32Array([
  0, 0,
  1, 0,
  0.5, 1,
])

const geometry = () => {
  const result = new Uint8Array(positions.byteLength + textureCoordinates.byteLength)
  result.set(new Uint8Array(positions.buffer), 0)
  result.set(new Uint8Array(textureCoordinates.buffer), positions.byteLength)
  return result
}

const dataUri = (bytes: Uint8Array, type: string) =>
  `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

const pixelPng = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

const gltf = (bufferUri: string, imageUri: string) => ({
  asset: { version: '2.0', generator: 'Panel36 import test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
  materials: [{
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0.2,
      roughnessFactor: 0.65,
    },
    doubleSided: true,
  }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987 }],
  images: [{ uri: imageUri }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.6, -0.5, 0], max: [0.6, 0.6, 0] },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
    { buffer: 0, byteOffset: positions.byteLength, byteLength: textureCoordinates.byteLength, target: 34962 },
  ],
  buffers: [{ uri: bufferUri, byteLength: geometry().byteLength }],
})

const pad = (bytes: Uint8Array, fill: number) => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
  padded.set(bytes)
  padded.fill(fill, bytes.length)
  return padded
}

const glb = () => {
  const binary = pad(geometry(), 0)
  const json = pad(new TextEncoder().encode(JSON.stringify(gltf(
    dataUri(geometry(), 'application/octet-stream'),
    dataUri(pixelPng, 'image/png'),
  ))), 0x20)
  const total = 12 + 8 + json.length + 8 + binary.length
  const result = new Uint8Array(total)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, json.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  result.set(json, 20)
  view.setUint32(20 + json.length, binary.length, true)
  view.setUint32(24 + json.length, 0x004e4942, true)
  result.set(binary, 28 + json.length)
  return result
}

const standaloneGltf = () => new TextEncoder().encode(JSON.stringify(gltf(
  dataUri(geometry(), 'application/octet-stream'),
  dataUri(pixelPng, 'image/png'),
)))

const zipModel = () => zipSync({
  'assets/device.gltf': strToU8(JSON.stringify(gltf('geometry/device.bin', 'textures/pixel.png'))),
  'assets/geometry/device.bin': geometry(),
  'assets/textures/pixel.png': pixelPng,
})

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
  await dialog.getByLabel('Рядов').fill('1')
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

  for (const item of importCases) await importModel(page, item)
  expect(await countIndexedDbAssets(page)).toBe(3)
  await expect(page.locator('.model-preview.state-ready[data-model-preview^="asset:"]')).toHaveCount(3)

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
  await expect(page.locator('.model-preview.state-error[data-model-preview^="asset:"]')).toHaveCount(3)
  await expect(page.locator('.model-preview.state-error').first()).toContainText('Локальный CAD-файл не найден')

  // The reload closes the side panels again, and a catalogue item that is not on
  // screen cannot be grabbed with a pointer.
  await openSidePanels(page)

  const glbSource = page.locator('.catalog-item').filter({ hasText: 'Импорт GLB' })
  const dropTarget = page.locator('.din-row').nth(1).locator('.slot-cell').nth(10)
  await dragWithPointer(page, glbSource, dropTarget)
  await expect(page.locator('.placed-device[aria-label*="Импорт GLB"]')).toHaveCount(1)

  for (const item of importCases.slice(1)) {
    await page.locator('.catalog-item').filter({ hasText: item.name }).click()
    await expect(page.locator(`.placed-device[aria-label*="${item.name}"]`)).toHaveCount(1)
  }
  await expect(page.locator('.placed-device[aria-label*="Импорт"]')).toHaveCount(3)

  for (const item of importCases) {
    await expect(page.locator('.bom-panel')).toContainText(item.name)
  }

  await page.locator('.placed-device[aria-label*="Импорт GLB"]').dispatchEvent('click')
  await page.getByRole('button', { name: '＋ Цепь' }).click()
  const circuitCard = page.locator('.circuit-card')
  await circuitCard.getByLabel('Ток, А').fill('40')
  await circuitCard.getByLabel('Ток, А').press('Tab')
  await expect(page.locator('.issue-list')).toContainText('Ток цепи выше номинала защиты')

  const connectionCard = circuitCard.locator('.connection-card').first()
  const connectionId = await connectionCard.getAttribute('data-connection-id')
  expect(connectionId).toBeTruthy()
  const firstWire = page.locator('.wires path').first()
  await expect(page.locator('.wires path')).toHaveCount(1)
  await expect(firstWire).toHaveAttribute('data-connection-id', connectionId!)
  await expect(firstWire).toHaveClass(/wire-l/)

  await pickOption(connectionCard, 'Шина', 'PE · земля')
  await expect(page.getByRole('alert')).toContainText('нет подключения PE')
  await expect(firstWire).toHaveClass(/wire-l/)
  await connectionCard.getByLabel('Толщина').fill('4')
  await connectionCard.getByLabel('Толщина').press('Tab')
  await connectionCard.getByLabel('Цвет').evaluate((input) => {
    const colorInput = input as HTMLInputElement
    colorInput.value = '#2c7155'
    colorInput.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await connectionCard.getByLabel('Подпись').fill('L к QF01')
  await connectionCard.getByLabel('Подпись').press('Tab')

  await expect(firstWire).toHaveClass(/wire-l/)
  await expect(firstWire).toHaveAttribute('stroke', '#2c7155')
  await expect(firstWire).toHaveAttribute('style', /stroke-width: 4px/)
  await expect(firstWire.locator('title')).toHaveText('L к QF01')

  await circuitCard.getByRole('button', { name: '＋ Подключение' }).click()
  await expect(circuitCard.locator('.connection-card')).toHaveCount(2)
  await expect(page.locator('.wires path')).toHaveCount(2)

  await circuitCard.getByRole('button', { name: 'Удалить подключение 2 цепи Цепь 1' }).click()
  const connectionDialog = page.getByRole('dialog', { name: 'Удалить подключение?' })
  await expect(connectionDialog).toBeVisible()
  await connectionDialog.getByRole('button', { name: 'Удалить подключение' }).click()
  await expect(circuitCard.locator('.connection-card')).toHaveCount(1)
  await expect(page.locator('.wires path')).toHaveCount(1)

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
  await expect(page.locator('.placed-device')).toHaveCount(9)
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
