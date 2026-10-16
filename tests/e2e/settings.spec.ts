import { expect, test } from '@playwright/test'
import { glb } from './model-fixtures'
import { gotoEditor, openSidePanels, pickOption } from './helpers'

test('settings are reachable from the persistent nav and manage the workspace', async ({ page }) => {
  await gotoEditor(page)
  const nav = page.getByRole('navigation', { name: 'Разделы кабинета' })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Редактор' })).toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: 'Настройки' }).click()

  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Настройки' })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/\/app\/settings$/)

  // The screen is a flowing page, not the editor shell's 44px action-bar row:
  // when the settings content collapses into a sliver, clicks still auto-scroll
  // and pass, so the guard has to be geometric.
  const columnHeight = await page.locator('.settings-page').evaluate((el) => el.getBoundingClientRect().height)
  expect(columnHeight).toBeGreaterThan(300)

  // The embedded CHINT model ships with the app and must not offer deletion.
  const rows = page.locator('.settings-table').first().locator('tbody tr')
  await expect(rows.filter({ hasText: 'CHINT NB1-63 2P' })).toContainText('встроенная')
  await expect(rows.filter({ hasText: 'CHINT NB1-63 2P' }).locator('button')).toHaveCount(0)

  // Theme flips both ways and sticks.
  await page.getByLabel('Тёмная тема').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('Светлая тема').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await nav.getByRole('link', { name: 'Проекты' }).click()
  await expect(page.getByRole('heading', { name: 'Проекты щитов' })).toBeVisible()
})

test('an imported model appears in the settings library and a binding can be dropped', async ({ page }) => {
  test.setTimeout(180_000)
  await gotoEditor(page)
  await openSidePanels(page)

  // Import one model without a stub, then bind it to a seeded catalogue product.
  const input = page.locator('input[type="file"][accept*=".glb"]')
  await input.setInputFiles({ name: 'library-managed.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(glb()) })
  const dialog = page.getByRole('dialog', { name: 'Параметры импорта' })
  await dialog.getByLabel('Название').fill('Библиотечная модель')
  await dialog.getByLabel('Создать товар-заготовку в каталоге').uncheck()
  await dialog.getByRole('button', { name: 'Добавить в библиотеку' }).click()
  await expect(dialog).toBeHidden()

  await page.locator('.placed-device').first().dispatchEvent('click')
  await pickOption(page.locator('.inspector-panel'), 'CAD-модель', 'Библиотечная модель')
  await expect(page.locator('.inspector-panel .model-preview')).toBeVisible()

  // Settings list the asset with its binding, and the binding can be removed from there.
  await page.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('link', { name: 'Настройки' }).click()
  const library = page.locator('.settings-block').filter({ hasText: 'Библиотека CAD-моделей' })
  await expect(library.locator('tbody tr').filter({ hasText: 'Библиотечная модель' })).toHaveCount(1)
  const bindings = page.locator('.settings-block').filter({ hasText: 'Привязки моделей' })
  await expect(bindings.locator('tbody')).toContainText('Библиотечная модель')
  await bindings.getByRole('button', { name: /Снять привязку/ }).click()
  await expect(bindings.locator('tbody tr')).toHaveCount(0)
})
