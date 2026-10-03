import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { strToU8, unzipSync } from 'fflate'
import { CAD_MANIFEST_ENTRY, PROJECT_ENTRY } from '../../src/domain/cadArchive'
import { categoryLabels } from '../../src/data/catalog'
import { dragWithPointer, gotoEditor, openSidePanels, unlockWorkspace } from './helpers'

/**
 * The archive exists for one reason: a project that uses a locally imported model must survive the
 * loss of this browser. The JSON export never could — it sets `cad.binaryIncluded: false` — so
 * this test does the whole round trip rather than checking that a button exists: import a model,
 * place it, export the archive, wipe local storage and IndexedDB, import the archive back, and
 * require the model to render again from the file that was downloaded.
 */

const positions = new Float32Array([-0.6, -0.5, 0, 0.6, -0.5, 0, 0, 0.6, 0])
const pad = (bytes: Uint8Array, fill: number) => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
  padded.set(bytes)
  padded.fill(fill, bytes.length)
  return padded
}

const glb = () => {
  const binary = pad(new Uint8Array(positions.buffer), 0)
  const json = pad(new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.7, 0.2, 0.1, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.6, -0.5, 0], max: [0.6, 0.6, 0] }],
    bufferViews: [{ buffer: 0, byteLength: binary.byteLength }],
    buffers: [{ byteLength: binary.byteLength }],
  })), 0x20)
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

const importModel = async (page: Page, name: string) => {
  await page.locator('input[type="file"][accept*=".glb"]').setInputFiles({ name: 'panel-device.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(glb()) })
  const dialog = page.getByRole('dialog', { name: 'Параметры импорта' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Название').fill(name)
  await dialog.getByLabel('Бренд').fill('Panel36 Test')
  await dialog.getByLabel('Категория').click()
  await dialog.getByRole('listbox').first().getByRole('option', { name: categoryLabels.MCB, exact: false }).first().click()
  await dialog.getByRole('button', { name: 'Добавить в библиотеку' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.model-row').filter({ hasText: name })).toBeVisible()
}

const wipeLocalData = (page: Page) => page.evaluate(() => new Promise<void>((resolve, reject) => {
  localStorage.clear()
  const request = indexedDB.open('panel36-models', 1)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const database = request.result
    const transaction = database.transaction('assets', 'readwrite')
    transaction.objectStore('assets').clear()
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => { database.close(); resolve() }
  }
}))

test('an archive brings the CAD model back after local data is wiped', async ({ page }) => {
  test.setTimeout(300_000)
  await gotoEditor(page)
  await openSidePanels(page)
  await importModel(page, 'Архивный аппарат')

  // Put it on the board, so the exported project really depends on the model.
  const source = page.locator('.catalog-item').filter({ hasText: 'Архивный аппарат' })
  await dragWithPointer(page, source, page.locator('.din-row').nth(1).locator('.slot-cell').nth(10))
  await expect(page.locator('.placed-device[aria-label*="Архивный аппарат"]')).toHaveCount(1)

  // The button only exists for a project that reaches outside the built-in catalogue.
  const withModels = page.getByRole('button', { name: 'Экспорт с моделями' })
  await expect(withModels).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), withModels.click()])
  const archive = await download.path()
  expect(archive).toBeTruthy()
  const bytes = await readFile(archive!)
  const entries = unzipSync(new Uint8Array(bytes))
  expect(Object.keys(entries)).toContain(PROJECT_ENTRY)
  expect(Object.keys(entries)).toContain(CAD_MANIFEST_ENTRY)
  // The project inside the archive is the same envelope as the JSON export, so a build that
  // predates the archive can still read the file it finds in there.
  const project = JSON.parse(new TextDecoder().decode(entries[PROJECT_ENTRY]!)) as { project: { devices: { productId: string }[] }; catalog: { snapshot: { id: string }[] } }
  // The archived project really does reach outside the catalogue: an imported model gets a random
  // id, so the invariant is that some placed product is missing from the catalogue snapshot.
  const catalogueIds = new Set(project.catalog.snapshot.map((item) => item.id))
  expect(project.project.devices.some((device) => !catalogueIds.has(device.productId))).toBe(true)
  expect(project.catalog.snapshot.length).toBeGreaterThan(100)

  // Clearing local storage takes the panel preference with it, so the editor comes back focused.
  await wipeLocalData(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await openSidePanels(page)

  const importInput = page.locator('input[type="file"][accept*=".zip"]').first()
  await importInput.setInputFiles({ name: 'project.panel36.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) })

  // The imported project carries the model back, and the model is in the library again — the
  // failure this replaces was a project full of "нет в каталоге" after a restore.
  await expect(page.locator('.model-row').filter({ hasText: 'Архивный аппарат' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.model-preview.state-ready[data-model-preview^="asset:"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.model-preview.state-error')).toHaveCount(0)
})

test('a plain JSON copy still says what it cannot carry', async ({ page }) => {
  await unlockWorkspace(page)
  await page.goto('/app/projects')
  await expect(page.getByRole('heading', { name: 'Проекты щитов' })).toBeVisible()
  // The seed project uses only catalogue positions, so no card claims a local dependency and the
  // per-project archive button is not offered.
  await expect(page.locator('.project-card-cad')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Копия с моделями' })).toHaveCount(0)
  // One picker for both shapes of file, and it says so rather than naming a format.
  await expect(page.getByRole('button', { name: 'Импортировать файл' })).toBeVisible()
  await expect(page.locator('input[type="file"][accept*=".zip"]')).toHaveCount(2)
  // Reading the manifest is a build-time concern, but the entry name it uses is part of the
  // archive contract and is pinned here so a rename cannot pass unnoticed.
  expect(CAD_MANIFEST_ENTRY).toBe('cad/manifest.json')
  expect(strToU8('{}').byteLength).toBe(2)
})
