import { expect, test } from '@playwright/test'

const demoUser = 'Демо-пользователь'

test.describe('separate read-only demo project', () => {
  test('opens without a session or workspace redirect', async ({ page }) => {
    await page.goto('/demo/project')

    await expect(page).toHaveURL('/demo/project')
    await expect(page.getByRole('heading', { name: 'Квартира · распределительный щит' })).toBeVisible()
    await expect(page.getByText(demoUser, { exact: true })).toBeVisible()
    await expect(page.getByText('Только просмотр', { exact: true })).toBeVisible()
    await expect(page.getByRole('tabpanel', { name: '2D-схема демо-проекта' })).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveCount(0)
    await expect(page.locator('.catalog-panel')).toHaveCount(0)
    await expect(page.locator('.project-menu')).toHaveCount(0)
    await expect(page.locator('input[type="file"]')).toHaveCount(0)

    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('panel36.demo-session.v1'))).toBeNull()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('panel36.projects.v2'))).toBeNull()
    await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some((database) => database.name === 'panel36-models'))).toBe(false)
  })

  test('supports view-only selection, zoom and informational tabs', async ({ page }) => {
    await page.goto('/demo/project')

    await expect(page.locator('.demo-project-row')).toHaveCount(2)
    await expect(page.locator('.demo-project-slot')).toHaveCount(24)
    await expect(page.locator('.demo-project-device')).toHaveCount(10)

    const selectedBefore = await page.locator('.demo-project-device.selected').getAttribute('aria-label')
    await page.locator('.demo-project-device').nth(2).click()
    await expect(page.locator('.demo-project-device.selected')).toHaveAttribute('aria-label', /QFI02/)
    expect(await page.locator('.demo-project-device.selected').getAttribute('aria-label')).not.toBe(selectedBefore)

    const zoomLabel = page.locator('.zoom-controls span')
    await page.getByRole('button', { name: 'Увеличить схему' }).click()
    await expect(zoomLabel).toHaveText('110%')
    await page.getByRole('button', { name: 'Сбросить масштаб' }).click()
    await expect(zoomLabel).toHaveText('100%')

    await page.getByRole('tab', { name: 'BOM', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'BOM проекта' })).toBeVisible()
    // Brands come from the working catalogue now; the demo names positions it can actually resolve.
    await expect(page.getByText(/EKF|IEK/).first()).toBeVisible()
    await expect(page.getByText('«уточняется»', { exact: true }).first()).toBeVisible()

    await page.getByRole('tab', { name: 'Проверки', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Состояние раскладки' })).toBeVisible()
    await expect(page.getByText('Ошибок не найдено', { exact: true })).toBeVisible()
    await expect(page.getByText('9', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Предварительный расчёт', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Цепи', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Цепи и фазовый баланс' })).toBeVisible()
    await expect(page.locator('#demo-panel-circuits').getByText('Розетки гостиной', { exact: true })).toBeVisible()
    await expect(page.getByText('38 А', { exact: true })).toBeVisible()
  })

  test('does not expose project or editor mutation controls', async ({ page }) => {
    await page.goto('/demo/project')

    for (const text of ['Добавить устройство', 'Импорт', 'Сохранить', 'Очистить локальные данные', 'Открыть полный редактор']) {
      await expect(page.getByText(text, { exact: false })).toHaveCount(0)
    }
    await expect(page.getByRole('link', { name: /рабочая область/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /переместить/i })).toHaveCount(0)
  })
})
