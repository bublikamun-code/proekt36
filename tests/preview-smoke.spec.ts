import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './e2e/helpers'

const project = {
  id: 'preview-project',
  name: 'Preview щит',
  preset: 'apartment',
  settings: {
    inputCurrent: 40,
    phase: 1,
    rows: 2,
    reserveModules: 8,
    enclosureWidth: 310,
    enclosureHeight: 200,
    enclosureDepth: 105,
    cabinetId: 'enmas-nx8-12-embedded',
    railId: 'rail-12',
  },
  devices: [],
  circuits: [],
  connections: [],
}

test.describe('production preview deep links', () => {
  test('public marketing and demo routes survive a direct preview request', async ({ page }) => {
    await page.goto('/features')
    await expect(page.getByRole('heading', { name: 'Всё, что нужно, чтобы увидеть щит.' })).toBeVisible()

    await page.goto('/demo/project')
    await expect(page.getByRole('heading', { name: 'Квартира · распределительный щит' })).toBeVisible()
  })

  test('workspace and canonical editor routes survive a direct preview request', async ({ page }) => {
    await page.addInitScript((item) => {
      localStorage.setItem('panel36.projects.v1', JSON.stringify([item]))
      localStorage.setItem('panel36.currentProjectId.v1', item.id)
    }, project)
    await unlockWorkspace(page)

    await page.goto('/app/projects')
    await expect(page.getByRole('heading', { name: 'Проекты щитов' })).toBeVisible()

    await page.goto('/app/projects/preview-project/editor')
    await expect(page).toHaveURL(/\/app\/projects\/preview-project\/editor$/)
    await expect(page.getByRole('button', { name: /Текущий проект/ })).toContainText('Preview щит')
  })

  // The editor positions the 2D board with inline style attributes, so a stricter policy here
  // would blank the board rather than fail loudly. The suite above is what proves the policy
  // is compatible; this test is what proves it is still there.
  test('the production build ships a content security policy that survives a request', async ({ page }) => {
    await page.goto('/')
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')

    expect(policy, 'CSP отсутствует в собранном index.html').toBeTruthy()
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("object-src 'none'")
    // The local AI proxy has to stay reachable, or the assistant silently stops working.
    expect(policy).toContain('http://127.0.0.1:8787')
  })
})
