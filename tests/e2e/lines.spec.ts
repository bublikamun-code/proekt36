import { expect, test } from '@playwright/test'
import { closeSidePanels, gotoProjectEditor } from './helpers'

/**
 * The planner tab end to end. A line is planned as a row and must land on the board in the same
 * breath — the apparatus, the phase conductor, the badge and the cable schedule are all views of
 * one action, and a test that checks the row alone proves a table, not a panel designer.
 */

const seedLinesProject = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('panel36.hints.v1', 'dismissed')
    localStorage.setItem('panel36.projects.v3', JSON.stringify([{
      schemaVersion: 4,
      id: 'lines-lab',
      name: 'Стенд линий',
      preset: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: {
        inputCurrent: 63, phase: 1, rows: 2, reserveModules: 4,
        enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106,
        cabinetId: 'panel36-24-embedded', railId: 'rail-12',
      },
      devices: [],
      circuits: [],
      connections: [],
      busAssemblies: [
        { id: 'bus-n-bottom', kind: 'N', placement: 'bottom', label: 'N' },
        { id: 'bus-pe-bottom', kind: 'PE', placement: 'bottom', label: 'PE' },
      ],
      combs: [],
      rooms: [],
    }]))
  })
}

test.beforeEach(async ({ page }) => {
  await seedLinesProject(page)
})

/** The planner works with the side panels closed: with a narrow viewport the catalogue overlays
 *  the panel's action buttons, and the toggle lives on the 2D board, not on this tab. */
const gotoLinesTab = async (page: import('@playwright/test').Page) => {
  await gotoProjectEditor(page, 'lines-lab')
  await closeSidePanels(page)
  await page.getByRole('tab', { name: 'Линии' }).click()
  await expect(page.locator('[data-lines-panel]')).toBeVisible()
}

const openLineDialog = async (page: import('@playwright/test').Page) => {
  await page.locator('[data-lines-panel] button', { hasText: '+ Линия' }).click()
  await page.getByRole('dialog').waitFor({ state: 'visible' })
}

test('вкладка «Линии» открывается из редактора и показывает пустой план', async ({ page }) => {
  await gotoLinesTab(page)
  await expect(page.locator('.lines-summary')).toContainText('0 линий')
})

test('линия из плана встаёт на доску аппаратом и проводом с биркой', async ({ page }) => {
  await gotoLinesTab(page)

  await openLineDialog(page)
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill('Розетки 1')
  await dialog.getByRole('button', { name: 'Добавить линию' }).click()
  await expect(page.locator('[data-line-row]')).toHaveCount(1)
  await expect(page.locator('[data-line-row] .lines-name')).toHaveValue('Розетки 1')
  await expect(page.locator('.lines-summary')).toContainText('1 линий')

  // The board gained the apparatus the plan named, and its conductor is badged with the line.
  await page.getByRole('tab', { name: 'Схема 2D' }).click()
  await expect(page.locator('.placed-device')).toHaveCount(1)
  await expect(page.locator('.wire-label').first()).toHaveText('Розетки 1')
})

test('«Соединить» дорисовывает нейтраль дифавтомата от шины N', async ({ page }) => {
  await gotoLinesTab(page)

  await openLineDialog(page)
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill('Свет коридора')
  // Защита — дифавтомат 1P+N: у него есть нейтральная клемма.
  await page.getByLabel('Аппарат защиты линии').click()
  await page.getByRole('option', { name: /DI-10 1P C16/ }).first().click()
  await dialog.getByRole('button', { name: 'Добавить линию' }).click()
  await expect(page.locator('[data-line-row]')).toHaveCount(1)

  await page.locator('[data-line-row] button', { hasText: 'Соединить' }).click()
  await page.getByRole('tab', { name: 'Схема 2D' }).click()
  // casing+core дают два элемента одного провода — как и в разводочном тесте, смотрим первый.
  await expect(page.locator('.wires .wire-n').first()).toBeVisible()
  // Оба провода линии — фазный и нейтраль — подписаны её именем, как на монтажном листе.
  await expect(page.locator('.wire-label').filter({ hasText: 'Свет коридора' })).toHaveCount(2)
})

test('кабельный журнал считает потери и показывает превышение', async ({ page }) => {
  await gotoLinesTab(page)

  await openLineDialog(page)
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill('Далёкие розетки')
  await dialog.getByRole('button', { name: 'Добавить линию' }).click()
  await expect(page.locator('[data-line-row]')).toHaveCount(1)

  // 55 м при 20 А и 1,5 мм² — выше 4 %; длину вводим в строке плана.
  const lengthInput = page.locator('[data-line-row] input[aria-label="Длина кабеля линии"]')
  await lengthInput.fill('55')
  await lengthInput.blur()
  const currentInput = page.locator('[data-line-row] input[aria-label="Ток линии"]')
  await currentInput.fill('20')
  await currentInput.blur()

  await page.locator('.lines-view-switch button', { hasText: 'Журнал' }).click()
  const row = page.locator('.lines-schedule tbody tr').first()
  await expect(row).toContainText('Далёкие розетки')
  await expect(row).toContainText('выше 4 %')
  await expect(row.locator('td').nth(6)).toContainText('%')
})

test('помещание группирует строки, удаление комнаты не удаляет линии', async ({ page }) => {
  await gotoLinesTab(page)

  await page.locator('[data-lines-panel] button', { hasText: '+ Помещение' }).click()
  const roomDialog = page.getByRole('dialog')
  await roomDialog.locator('input').first().fill('Гостиная')
  await roomDialog.getByRole('button', { name: 'Добавить помещение' }).click()
  await expect(page.locator('.lines-group-head h4', { hasText: 'Гостиная' })).toBeVisible()

  await openLineDialog(page)
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill('Розетки 2')
  await page.getByLabel('Помещение линии').click()
  await page.getByRole('option', { name: 'Гостиная (этаж 1)' }).click()
  await dialog.getByRole('button', { name: 'Добавить линию' }).click()
  await expect(page.locator('.lines-group', { hasText: 'Гостиная' }).locator('[data-line-row]')).toHaveCount(1)

  await page.locator('.lines-room-remove').first().click()
  await expect(page.locator('.lines-group-head h4', { hasText: 'Гостиная' })).toHaveCount(0)
  // Линия пережила комнату и вернулась в «Без помещения».
  await expect(page.locator('.lines-group.ungrouped [data-line-row]')).toHaveCount(1)
})

test('undo снимает линию вместе с аппаратом на доске', async ({ page }) => {
  await gotoLinesTab(page)

  await openLineDialog(page)
  const dialog = page.getByRole('dialog')
  await dialog.locator('input').first().fill('Розетки 3')
  await dialog.getByRole('button', { name: 'Добавить линию' }).click()
  await expect(page.locator('[data-line-row]')).toHaveCount(1)

  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-line-row]')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Схема 2D' }).click()
  await expect(page.locator('.placed-device')).toHaveCount(0)
})
