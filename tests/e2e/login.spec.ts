import { expect, test } from '@playwright/test'

/**
 * The login form is the one path into the workspace that no other spec walks.
 *
 * `unlockWorkspace` in the helpers writes the demo session into sessionStorage directly, so every
 * other test starts already inside. That is right for what those tests are about and wrong as the
 * only coverage: the form, its validation and whatever runs after the first project is created were
 * never exercised, and a page can be entered and still show nothing. The bug this file was written
 * for was exactly that — `crypto.randomUUID` is undefined outside a secure context, so entering
 * through the form on any plain address produced an empty page.
 */
test.describe('вход в рабочую область', () => {
  test('форма входа открывает рабочую область, а не пустую страницу', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('/app/projects')
    await expect(page.getByRole('heading', { name: 'Войти в Панель 36' })).toBeVisible()

    await page.getByLabel('Email').fill('user@example.com')
    await page.getByLabel('Пароль').fill('panel36')
    await page.getByRole('button', { name: 'Войти в демо' }).click()

    await expect(page).toHaveURL(/\/app\/projects$/)
    await expect(page.getByRole('heading', { name: 'Проекты щитов' })).toBeVisible()
    // A session that was accepted but a page that renders nothing is the failure this guards.
    await expect(page.locator('main')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toBe('')
    expect(errors, `страница упала: ${errors.join(' | ')}`).toEqual([])
  })

  test('короткий пароль не пускает и объясняет почему', async ({ page }) => {
    await page.goto('/app/projects')
    await page.getByLabel('Email').fill('user@example.com')
    await page.getByLabel('Пароль').fill('12345')
    await page.getByRole('button', { name: 'Войти в демо' }).click()
    // The browser's own `minlength` blocks the submit, so the form must still be in front of us.
    await expect(page.getByLabel('Пароль')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('вход без перехода сохраняет адрес, с которого пришли', async ({ page }) => {
    await page.goto('/app/editor')
    await expect(page.getByRole('heading', { name: 'Войти в Панель 36' })).toBeVisible()
    await page.getByLabel('Email').fill('user@example.com')
    await page.getByLabel('Пароль').fill('panel36')
    await page.getByRole('button', { name: 'Войти в демо' }).click()
    await expect(page).toHaveURL(/\/app\/editor/)
    await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  })
})