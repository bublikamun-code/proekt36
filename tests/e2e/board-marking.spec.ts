import { expect, test } from '@playwright/test'
import { demoProject } from '../../src/data/demoProject'
import { unlockWorkspace } from './helpers'

const longMarking = 'Розетки кухни, холодильник и посудомоечная машина'

test.beforeEach(async ({ page }) => {
  await unlockWorkspace(page)
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('marking-seeded')) return
    localStorage.setItem('panel36.projects.v2', JSON.stringify([project]))
    sessionStorage.setItem('marking-seeded', 'true')
  }, {
    ...demoProject, id: 'marking-lab', circuits: [], connections: [],
    devices: [
      { instanceId: 'custom', address: 'QF01', marking: longMarking, slot: 0 },
      { instanceId: 'auto', address: 'QF02', marking: 'QF02', slot: 3 },
    ].map((item) => ({ ...item, row: 0, mount: 'din' as const, productId: 'ekf-mcb-1p-c6', quantity: 1, phase: 1 as const, note: '' })),
  })
  await page.goto('/app/board')
  await expect(page.locator('.scene-device[data-instance-id="custom"]')).toBeVisible()
})

test('board and print keep custom marking separate from the identifying address', async ({ page }) => {
  const device = page.locator('.scene-device[data-instance-id="custom"]')
  await expect(device.locator('.scene-device-address')).toHaveText('QF01')
  await expect(device.locator('.scene-device-marking')).toHaveAttribute('aria-label', longMarking)
  await expect(device.locator('.scene-device-labels title')).toContainText(longMarking)
  await expect(device.locator('.scene-device-marking tspan')).toHaveCount(3)
  await expect(device.locator('.scene-device-marking')).toContainText('…')
  await page.emulateMedia({ media: 'print' })
  const label = page.locator('.print-label').first()
  await expect(label.locator('.print-label-text')).toHaveText(longMarking)
  await expect(label.locator('.print-label-address')).toHaveText('QF01')
  await expect(page.locator('.print-labels-warning')).toContainText('Длинные подписи')
  await expect(page.locator('.print-label-flag')).toHaveCount(0)
})

test('address edits update auto labels, preserve custom marking and survive reload', async ({ page }) => {
  for (const [id, address] of [['auto', 'QF20'], ['custom', 'QF10']]) {
    await page.locator('.board-tools [data-tool="address"]').click()
    await page.locator(`.scene-device[data-instance-id="${id}"]`).click()
    const field = page.getByLabel(/^Адрес:/)
    await field.fill(address!)
    await field.press('Enter')
  }
  await expect(page.locator('.storage-banner')).toContainText('Все изменения сохранены')
  await page.reload()
  await expect(page.locator('.scene-device[data-instance-id="auto"] .scene-device-address')).toHaveText('QF20')
  await page.emulateMedia({ media: 'print' })
  const labels = page.locator('.print-label')
  await expect(labels.nth(0).locator('.print-label-address')).toHaveText('QF10')
  await expect(labels.nth(0).locator('.print-label-text')).toHaveText(longMarking)
  await expect(labels.nth(1).locator('.print-label-text')).toHaveText('QF20')
})

test('address draft survives a workspace resize before it is committed', async ({ page }) => {
  await page.locator('.board-tools [data-tool="address"]').click()
  await page.locator('.scene-device[data-instance-id="custom"]').click()
  const field = page.getByLabel(/^Адрес:/)
  await field.fill('QF10')
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(field).toHaveValue('QF10')
  await field.press('Enter')
  await expect(page.locator('.scene-device[data-instance-id="custom"] .scene-device-address')).toHaveText('QF10')
})
