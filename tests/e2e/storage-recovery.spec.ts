import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

const PROJECTS_KEY = 'panel36.projects.v2'

test('a damaged record in the current storage key is reported, not silently emptied', async ({ page }) => {
  await unlockWorkspace(page)
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify([{ schemaVersion: 1, id: 'damaged', name: 'Не потерять', devices: [] }]))
  }, PROJECTS_KEY)
  await page.goto('/app/editor')

  const alert = page.locator('.editor-storage-alert')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('повреждённые локальные данные')
  // The preserved raw text is the user's only way back, so it has to be reachable.
  await expect(alert.getByRole('button', { name: 'Скачать снимок' })).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Откатиться к снимку' })).toHaveCount(0)
  await expect(alert.getByRole('button', { name: 'Скрыть' })).toBeVisible()

  // The bytes are still in the key; nothing overwrote them.
  const raw = await page.evaluate((key) => localStorage.getItem(key), PROJECTS_KEY)
  expect(JSON.parse(raw ?? '[]')[0].name).toBe('Не потерять')
})

test('a healthy workspace shows no storage alert', async ({ page }) => {
  await unlockWorkspace(page)
  await page.goto('/app/editor')

  await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  await expect(page.locator('.editor-storage-alert')).toHaveCount(0)
})
