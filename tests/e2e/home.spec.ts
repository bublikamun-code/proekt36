import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

const rawProject = {
  name: 'Импорт из workspace',
  preset: 'apartment',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: { phase: 1, inputCurrent: 40, enclosureWidth: 310, enclosureHeight: 350, enclosureDepth: 105, rows: 2, reserveModules: 8, cabinetId: 'enmas-nx8-24-embedded', railId: 'rail-12' },
  devices: [],
  circuits: [],
  connections: [],
}

test.describe('public site and workspace shell', () => {
  test('root is a public landing page without project data', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Соберите панель/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Возможности' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Тарифы' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeHidden()
    await expect(page.locator('.app-shell')).toHaveCount(0)
    await expect(page.locator('.home-project-card')).toHaveCount(0)
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
  })

  test('features, pricing and legal pages load directly', async ({ page }) => {
    for (const path of ['/features', '/pricing', '/privacy', '/terms']) {
      await page.goto(path)
      await expect(page).toHaveURL(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
    // The footer carries the real build version. The pattern stays version-agnostic so a
    // release bump does not break the suite; `tests/app-version.test.ts` ties the number to package.json.
    await expect(page.getByText(/Предварительная версия \d+\.\d+\.\d+ · серверная синхронизация/).first()).toBeVisible()
  })

  test('demo overview links to the separate read-only project without opening a workspace', async ({ page }) => {
    await page.goto('/demo')
    await expect(page).toHaveURL('/demo')
    await expect(page.getByRole('heading', { name: /Посмотрите, как/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: '2D схема' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'BOM / состав' })).toBeVisible()

    await page.getByRole('tab', { name: 'BOM / состав' }).click()
    await expect(page.getByRole('tab', { name: 'BOM / состав' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Итого', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Открыть DEMO-проект' }).click()
    await expect(page).toHaveURL('/demo/project')
    await expect(page.getByRole('heading', { name: 'Квартира · распределительный щит' })).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveCount(0)
  })

  test('workspace requires a local session and preserves the requested route', async ({ page }) => {
    await page.goto('/app/projects')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByRole('heading', { name: 'Войти в Панель 36' })).toBeVisible()
  })

  test('local guest entry opens the project dashboard', async ({ page }) => {
    await page.goto('/login?redirect=/app/projects')
    await page.getByRole('button', { name: 'Продолжить локально' }).click()
    await expect(page).toHaveURL('/app/projects')
    await expect(page.getByRole('heading', { name: 'Проекты щитов' })).toBeVisible()
  })

  // A project opens on the board, not on the editor it replaced. The route still names the project,
  // so a link to somebody's panel opens that panel rather than whichever was last open.
  test('dashboard creates a preset project and opens its canonical board route', async ({ page }) => {
    await unlockWorkspace(page)
    await page.goto('/app/projects')
    await page.getByRole('button', { name: '＋ Создать панель' }).click()
    await page.getByLabel('Название проекта').fill('Новая квартира')
    await page.getByRole('button', { name: /Квартира/ }).click()
    await page.getByRole('button', { name: 'Создать проект' }).click()
    await expect(page).toHaveURL(/\/app\/projects\/[^/]+\/board$/)
    // The board picks a project with a select rather than the editor's menu, and says the same thing
    // in it: which project is on the table.
    await expect(page.getByRole('combobox', { name: 'Текущий проект' })).toHaveValue(/.+/)
    await expect(page.getByRole('combobox', { name: 'Текущий проект' })).toContainText('Новая квартира')
    await expect(page.locator('.scene-device')).not.toHaveCount(0)
  })

  test('dashboard imports a raw project and routes to the board', async ({ page }) => {
    await unlockWorkspace(page)
    await page.goto('/app/projects')
    await page.getByLabel('Файл проекта: JSON или архив').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rawProject)) })
    await expect(page).toHaveURL(/\/app\/projects\/[^/]+\/board$/)
    await expect(page.getByRole('combobox', { name: 'Текущий проект' })).toContainText('Импорт из workspace')
  })

  test('public metadata is indexable while auth is not', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Панель 36/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow')
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)

    // A canonical link on a private page advertises that page as the real address of itself,
    // which is the opposite of what noindex asks for. The element has to go, not just change.
    await page.goto('/login')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  })

  test('desktop public header stays visible while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/features')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect.poll(() => page.locator('.public-header').evaluate((element) => element.getBoundingClientRect().top)).toBe(0)
  })

  test('mobile public navigation remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Открыть меню' })
    await toggle.click()
    await expect(page.locator('#public-mobile-menu').getByRole('link', { name: 'Возможности' })).toBeVisible()
    await expect(page.locator('#public-mobile-menu').getByRole('link', { name: 'Тарифы' })).toBeVisible()
    await expect(page.locator('#public-mobile-menu').getByRole('link', { name: 'Открыть конфигуратор' })).toBeVisible()

    // The open state is announced on the control itself.
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toHaveAttribute('aria-expanded', 'true')

    await page.locator('.public-footer').click({ position: { x: 8, y: 8 } })
    await expect(page.locator('#public-mobile-menu')).toHaveCount(0)

    await page.getByRole('button', { name: 'Открыть меню' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('#public-mobile-menu')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeFocused()
  })
})
