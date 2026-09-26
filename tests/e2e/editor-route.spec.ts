import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

const projects = [
  { id: 'route-project-a', name: 'Маршрут A', preset: 'demo', settings: { inputCurrent: 63, phase: 1, rows: 2, reserveModules: 8, enclosureWidth: 310, enclosureHeight: 350, enclosureDepth: 105 }, devices: [], circuits: [], connections: [] },
  { id: 'route-project-b', name: 'Маршрут B', preset: 'demo', settings: { inputCurrent: 63, phase: 1, rows: 2, reserveModules: 8, enclosureWidth: 310, enclosureHeight: 350, enclosureDepth: 105 }, devices: [], circuits: [], connections: [] },
]

test.describe('editor project route', () => {
  test('resolves a missing project and follows explicit project routes', async ({ page }) => {
    await page.addInitScript((items) => {
      localStorage.setItem('panel36.projects.v1', JSON.stringify(items))
    }, projects)
    await unlockWorkspace(page)

    await page.goto('/app/projects/does-not-exist/editor')
    await expect(page).toHaveURL(/\/app\/projects$/)

    await page.goto('/app/editor')
    await expect(page).toHaveURL(/\/app\/projects\/route-project-a\/editor$/)
    await expect(page.getByRole('button', { name: /Текущий проект/ })).toContainText('Маршрут A')

    await page.getByRole('button', { name: /Текущий проект/ }).click()
    await page.getByRole('button', { name: /Открыть проект Маршрут B/ }).click()
    await expect(page).toHaveURL(/\/app\/projects\/route-project-b\/editor$/)
    await expect(page.getByRole('button', { name: /Текущий проект/ })).toContainText('Маршрут B')
  })
})
