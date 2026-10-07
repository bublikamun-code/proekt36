import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'
import { demoProject } from '../../src/data/demoProject'

test.beforeEach(async ({ page }) => {
  await unlockWorkspace(page)
  // Seed once before app startup; reload must read the application's saved changes.
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('specification-fixture-seeded')) return
    localStorage.setItem('panel36.projects.v2', JSON.stringify([project]))
    sessionStorage.setItem('specification-fixture-seeded', 'true')
  }, {
    ...demoProject, id: 'specification-lab', name: 'Стенд спецификации', connections: [], circuits: [],
    devices: [{ id: 'qf01', row: 0, slot: 0 }, { id: 'qf02', row: 1, slot: 3 }].map((item) => ({
      instanceId: item.id, productId: 'ekf-mcb-1p-c6', row: item.row, slot: item.slot,
      address: item.id.toUpperCase(), quantity: 1, phase: 1 as const, note: '', mount: 'din' as const,
    })),
  })
  await page.goto('/app/board')
  await expect(page.locator('.board-scene')).toBeVisible()
  await expect(page.locator('.scene-device[data-instance-id="qf01"]')).toBeVisible()
})

const specification = (page: import('@playwright/test').Page) => page.getByRole('link', { name: 'Спецификация', exact: true })
const assembly = (page: import('@playwright/test').Page) => page.getByRole('link', { name: 'Сборка щита', exact: true })

test('shared quantities, exact placement navigation, reload and CSV stay in sync', async ({ page }) => {
  await page.getByRole('button', { name: 'Показать боковые панели', exact: true }).click()
  await page.locator('.scene-device[data-instance-id="qf01"]').click()
  await page.getByLabel('Количество', { exact: true }).fill('4')
  await page.getByLabel('Количество', { exact: true }).press('Tab')
  await specification(page).click()
  await expect(specification(page)).toHaveAttribute('aria-current', 'page')
  await expect(assembly(page)).not.toHaveAttribute('aria-current', 'page')
  const row = page.locator('.bom-panel tr[data-product-id="ekf-mcb-1p-c6"]')
  await expect(row).toHaveClass(/is-highlighted/)
  await expect(row.locator('td').nth(2)).toHaveText('5')
  await expect(row.locator('.bom-placements > span')).toHaveText('2 шт.')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click()
  const download = await downloadPromise
  const csv = await readFile((await download.path())!, 'utf8')
  expect(download.suggestedFilename()).toMatch(/-BOM\.csv$/)
  expect(csv).toContain(';"5";')
  await expect(page.locator('.storage-banner')).toContainText('Все изменения сохранены')
  await page.reload()
  await expect(page.locator('.bom-panel')).toBeVisible()
  await expect(row.locator('td').nth(2)).toHaveText('5')
  await page.getByRole('button', { name: 'Показать QF02 на щите, ряд 2, место 4', exact: true }).click()
  const device = page.locator('.scene-device[data-instance-id="qf02"]')
  await expect(device).toHaveClass(/is-selected/)
  await expect(device).toBeFocused()
  await expect(device).toBeInViewport()
  await expect(assembly(page)).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page.locator('.bom-panel')).toBeVisible()
})

test('hidden board shortcuts cannot delete or duplicate selected equipment', async ({ page }) => {
  await page.locator('.scene-device[data-instance-id="qf01"]').click()
  await specification(page).click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+d')
  await page.keyboard.press('3')
  await assembly(page).click()
  await expect(page.locator('.scene-device')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Выбрать', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Дублировать', exact: true }).click()
  await specification(page).click()
  await expect(page.locator('.bom-placements > span')).toHaveText('3 шт.')
  await page.getByRole('button', { name: /Отменить/ }).click()
  await expect(page.locator('.bom-placements > span')).toHaveText('2 шт.')
})

test('switching mode cancels unfinished wires; print works from specification', async ({ page }) => {
  await page.getByRole('button', { name: 'Провести', exact: true }).click()
  await page.locator('[data-terminal="qf01:L:bottom:0"]').click()
  await expect(page.locator('.scene-terminal.is-start')).toHaveCount(1)
  await specification(page).click()
  await assembly(page).click()
  await page.getByRole('button', { name: 'Провести', exact: true }).click()
  await expect(page.locator('.scene-terminal.is-start')).toHaveCount(0)
  await specification(page).click()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-report')).toBeVisible()
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(page.locator('.bom-panel')).toBeHidden()
})

for (const width of [390, 900]) {
  test(`specification and device navigation remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: 'Показать боковые панели', exact: true }).click()
    await specification(page).click()
    await expect(page.getByRole('heading', { name: 'Сводная ведомость' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Экспорт CSV', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Показать QF02 на щите, ряд 2, место 4', exact: true }).click()
    await expect(page.locator('.scene-device[data-instance-id="qf02"]')).toBeInViewport()
    await page.getByRole('button', { name: 'Показать боковые панели', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible()
  })
}
