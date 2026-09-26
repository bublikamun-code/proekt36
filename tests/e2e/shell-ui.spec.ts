import { expect, test } from '@playwright/test'
import { gotoEditor } from './helpers'

test.describe('shell UI', () => {
  test('editor exposes only the 2D board', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await gotoEditor(page)

    await expect(page.getByRole('button', { name: '3D вид' })).toHaveCount(0)
    await expect(page.locator('.viewer-3d')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Показать схему щита' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  })

  test('dark theme keeps headings and primary actions readable', async ({ page }) => {
    await gotoEditor(page)
    await page.getByRole('button', { name: 'Включить тёмную тему' }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Показать боковые панели' }).click()
    await expect(page.getByRole('heading', { name: 'Каталог' })).toHaveCSS('color', 'rgb(238, 245, 239)')
    await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
  })

  test('undo shortcut is not intercepted by catalog input', async ({ page }) => {
    await gotoEditor(page)
    await page.getByRole('button', { name: 'Показать боковые панели' }).click()
    const search = page.getByRole('searchbox', { name: 'Поиск по каталогу' })

    const prevented = await search.evaluate((input) => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
      input.dispatchEvent(event)
      return event.defaultPrevented
    })

    expect(prevented).toBe(false)
  })

  test('project actions are real keyboard-focusable buttons', async ({ page }) => {
    await gotoEditor(page)
    await page.getByRole('button', { name: /Текущий проект/ }).click()

    const rename = page.getByRole('button', { name: /Переименовать проект/ }).first()
    const duplicate = page.getByRole('button', { name: /Дублировать проект/ }).first()
    const remove = page.getByRole('button', { name: /Удалить проект/ }).first()

    await expect(rename).toBeVisible()
    await expect(duplicate).toBeVisible()
    await expect(remove).toBeVisible()
    await rename.focus()
    await expect(rename).toBeFocused()
  })

  test('shell remains usable at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await gotoEditor(page)
    await expect(page.getByRole('region', { name: 'Схема электрощита' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Показать боковые панели' })).toBeVisible()
  })

  test('project menu is styled, keyboard-driven and closes on an outside press', async ({ page }) => {
    await gotoEditor(page)
    const trigger = page.getByRole('button', { name: /Текущий проект/ })
    await trigger.click()

    const menu = page.getByRole('group', { name: 'Проекты' })
    await expect(menu).toBeVisible()
    // The menu is drawn by the product rather than by the operating system.
    await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(menu).toHaveCSS('box-shadow', /rgba\(/)
    expect((await menu.boundingBox())?.width ?? 0).toBeGreaterThan(200)

    // The trigger advertises a dialog, so the panel is a plain group of buttons,
    // not a `menu` widget that would also require menuitem keyboard semantics.
    const items = menu.locator('.project-select')
    await expect(menu.locator('[aria-current="page"]')).toBeFocused()
    await items.first().press('End')
    await expect(items.last()).toBeFocused()
    await items.last().press('Home')
    await expect(items.first()).toBeFocused()

    await page.getByRole('region', { name: 'Схема электрощита' }).click({ position: { x: 8, y: 8 } })
    await expect(menu).toBeHidden()

    await trigger.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('deleting a device asks for confirmation in the product dialog', async ({ page }) => {
    await gotoEditor(page)
    await page.getByRole('button', { name: 'Показать боковые панели' }).click()
    const devices = page.locator('.placed-device')
    const before = await devices.count()
    expect(before).toBeGreaterThan(0)
    await devices.first().click()

    await page.getByRole('button', { name: 'Удалить устройство' }).click()
    const dialog = page.getByRole('dialog', { name: 'Удалить устройство?' })
    await expect(dialog).toBeVisible()
    // A destructive question opens on the safe answer.
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused()

    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()
    await expect(devices).toHaveCount(before)

    await page.getByRole('button', { name: 'Удалить устройство' }).click()
    await page.getByRole('dialog', { name: 'Удалить устройство?' }).getByRole('button', { name: 'Удалить устройство' }).click()
    await expect(devices).toHaveCount(before - 1)
  })

  test('a dialog opened from the project menu returns focus to the trigger', async ({ page }) => {
    await gotoEditor(page)
    const trigger = page.getByRole('button', { name: /Текущий проект/ })
    await trigger.click()
    await page.getByRole('button', { name: /^Переименовать проект/ }).first().click()

    const dialog = page.getByRole('dialog', { name: 'Переименовать проект', exact: true })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // The menu item is gone with the panel, so focus has to land back on the control
    // that is still on screen rather than on <body>.
    await expect(trigger).toBeFocused()
  })
})
