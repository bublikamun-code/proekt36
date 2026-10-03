import { expect, test, type Page } from '@playwright/test'
import { CATALOG_REVISION } from '../../src/data/catalog'
import { APPLICATION_REVISION } from '../../src/domain/projectSchema'
import { gotoEditor, pickOption, pickOptionByKeyboard, unlockWorkspace } from './helpers'

const project = (id: string, name: string, preset: string, cabinetId: string, railId: 'rail-12' | 'rail-18', updatedAt: string) => ({
  schemaVersion: 2,
  id,
  name,
  preset,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
  settings: {
    inputCurrent: 40,
    phase: 1,
    enclosureWidth: cabinetId === 'enmas-nx8-12-embedded' ? 310 : 462,
    enclosureHeight: cabinetId === 'enmas-nx8-12-embedded' ? 200 : 348,
    enclosureDepth: 105,
    rows: 1,
    reserveModules: 2,
    cabinetId,
    railId,
  },
  devices: [],
  circuits: [],
  connections: [],
})

const seedProjects = async (page: Page) => {
  await page.addInitScript(({ first, second }) => {
    localStorage.setItem('panel36.projects.v2', JSON.stringify([first, second]))
    localStorage.setItem('panel36.currentProjectId.v1', first.id)
  }, {
    first: project('project-alpha', 'Alpha щит', 'apartment', 'enmas-nx8-12-embedded', 'rail-12', '2026-09-24T10:00:00.000Z'),
    second: project('project-beta', 'Beta мастерская', 'workshop', 'panel36-18-r18-embedded', 'rail-18', '2026-08-01T10:00:00.000Z'),
  })
  await unlockWorkspace(page)
}

test('dashboard searches, filters, sorts and clears project metadata', async ({ page }) => {
  await seedProjects(page)
  await page.goto('/app/projects')

  await expect(page.locator('.home-project-card')).toHaveCount(2)
  await page.getByLabel('Поиск проекта').fill('Beta')
  await expect(page.getByRole('heading', { name: 'Beta мастерская' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Alpha щит' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click()
  await pickOption(page, 'Пресет', 'Квартира')
  await expect(page.getByRole('heading', { name: 'Alpha щит' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Beta мастерская' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click()
  await pickOption(page, 'Корпус', 'U18C')
  await expect(page.getByRole('heading', { name: 'Beta мастерская' })).toBeVisible()
  await pickOption(page, /^Рейка/, 'DIN-рейка 12 модулей')
  await expect(page.getByRole('heading', { name: 'Проекты не найдены' })).toBeVisible()

  await page.getByRole('button', { name: 'Сбросить фильтры' }).last().click()
  await pickOption(page, 'Дата изменения', '30 дней')
  await expect(page.getByRole('heading', { name: 'Alpha щит' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Beta мастерская' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click()
  await pickOptionByKeyboard(page, 'Сортировка', 'По названию')
  await expect(page.locator('.home-project-card h2')).toHaveText(['Alpha щит', 'Beta мастерская'])
  await expect(page.getByText('Показано 2 из 2')).toBeVisible()
})

test('dashboard rename and destructive dialogs restore focus and announce results', async ({ page }) => {
  await seedProjects(page)
  await page.goto('/app/projects')

  const renameButton = page.getByRole('button', { name: 'Переименовать проект Beta мастерская' })
  await renameButton.click()
  const renameDialog = page.getByRole('dialog', { name: 'Переименовать проект' })
  await expect(renameDialog).toBeVisible()
  await renameDialog.getByLabel('Новое имя панели').fill('Beta переименован')
  await renameDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(renameDialog).toBeHidden()
  const renamedButton = page.getByRole('button', { name: 'Переименовать проект Beta переименован' })
  await expect(renamedButton).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Beta переименован' })).toBeVisible()

  const deleteButton = page.getByRole('button', { name: 'Удалить проект Beta переименован' })
  await deleteButton.click()
  const deleteDialog = page.getByRole('dialog', { name: 'Удалить проект?' })
  await expect(deleteDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(deleteDialog).toBeHidden()
  await expect(deleteButton).toBeFocused()

  await deleteButton.click()
  await deleteDialog.getByRole('button', { name: 'Удалить безвозвратно' }).click()
  await expect(deleteDialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Beta переименован' })).toHaveCount(0)
  await expect(page.getByText('Проект «Beta переименован» удалён.')).toBeAttached()
})

test('workspace backup restores projects only after explicit confirmation', async ({ page }) => {
  await seedProjects(page)
  await page.goto('/app/projects')

  const restoredProject = project('restored-project', 'Восстановленная панель', 'apartment', 'enmas-nx8-12-embedded', 'rail-12', '2026-09-24T12:00:00.000Z')
  const backup = {
    schema: 'panel36.backup.v1',
    application: { name: 'Panel36', revision: APPLICATION_REVISION },
    exportedAt: '2026-09-24T12:00:00.000Z',
    catalogRevision: CATALOG_REVISION,
    cad: { binaryIncluded: false, modelManifest: { modelIds: [] } },
    currentProjectId: restoredProject.id,
    projects: [restoredProject],
  }

  await page.getByLabel('Файл резервной копии').setInputFiles({
    name: 'panel36-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const dialog = page.getByRole('dialog', { name: 'Восстановить резервную копию?' })
  await expect(dialog).toContainText('1 проект')
  await dialog.getByRole('button', { name: 'Заменить и восстановить' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Восстановленная панель' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Alpha щит' })).toHaveCount(0)
  await expect(page.getByText('Резервная копия восстановлена: 1 проект.')).toBeAttached()
})

test('editor BOM exposes unknown pricing and shared print report without tab dependency', async ({ page }) => {
  await gotoEditor(page)
  await page.evaluate(() => {
    const target = window as Window & { __panel36Printed?: boolean }
    target.__panel36Printed = false
    target.print = () => { target.__panel36Printed = true }
  })

  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  // The one working-catalogue position with no confirmed price. The test needs a line that reads
  // «уточняется», and inventing a price to get one would defeat the thing it checks.
  await page.getByRole('button', { name: /DV-T1 1P\+N 25kA/ }).click()
  const bom = page.getByRole('region', { name: 'Сводная ведомость' })
  await expect(bom).toContainText('«уточняется»')
  await expect(bom).toContainText('Коммерческая сумма не рассчитана')
  // No position in the short working catalogue carries a source URL, so the report must not claim
  // one. The wording that would have been a lie is the assertion.
  expect(await bom.getByText('Источник указан').count()).toBe(0)

  await page.getByRole('button', { name: 'Печать', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __panel36Printed?: boolean }).__panel36Printed)).toBe(true)
  await page.emulateMedia({ media: 'print' })
  const report = page.getByRole('article', { name: 'Печатный отчёт: Освещение квартиры' })
  await expect(report).toBeVisible()
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(report).toContainText('Освещение квартиры')
  await expect(report).toContainText('Сводка 2D-компоновки')
  await expect(report).toContainText('«уточняется»')
  expect(await report.getByText('Источник указан').count()).toBe(0)
  await expect(report).toContainText('Коммерческая сумма не рассчитана')
  await expect(report).toContainText('Диагностика и проверки')
  await expect(report).toContainText('Редакции:')
})

test('keyboard placement controls and demo tabs are operable', async ({ page }) => {
  await unlockWorkspace(page)
  await page.goto('/app/editor')
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await page.locator('.placed-device').first().click()
  const controls = page.getByRole('form', { name: 'Перемещение по клавиатуре' })
  await pickOption(controls, 'Ряд', '3')
  await pickOption(controls, 'Модуль', '4')
  await controls.getByRole('button', { name: 'Переместить с клавиатуры' }).click()
  await expect(page.getByText('Позиция', { exact: false }).locator('.mono')).toHaveText('3.4')

  await page.goto('/demo/project')
  const bomTab = page.getByRole('tab', { name: '2D схема' })
  await bomTab.focus()
  await bomTab.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'BOM' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'BOM' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'BOM' }).press('End')
  await expect(page.getByRole('tab', { name: 'Цепи' })).toBeFocused()
})

test('demo print uses the same report regardless of the active tab', async ({ page }) => {
  await page.goto('/demo/project')
  await page.getByRole('tab', { name: 'Цепи' }).click()
  await page.evaluate(() => {
    const target = window as Window & { __panel36DemoPrinted?: boolean }
    target.__panel36DemoPrinted = false
    target.print = () => { target.__panel36DemoPrinted = true }
  })
  await page.getByRole('button', { name: 'Печать' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __panel36DemoPrinted?: boolean }).__panel36DemoPrinted)).toBe(true)

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('article', { name: 'Печатный отчёт: Демо-проект · Квартира' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Разделы демо-проекта' })).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Цепи' })).toBeHidden()
})
