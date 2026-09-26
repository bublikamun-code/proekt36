import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

const project = {
  schemaVersion: 2,
  id: 'select-project',
  name: 'Списки',
  preset: 'test',
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  settings: { inputCurrent: 63, phase: 1, reserveModules: 4, rows: 2, enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106, cabinetId: 'panel36-24-embedded', railId: 'rail-12' },
  devices: [{
    instanceId: 'qf-01', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0,
    address: 'QF01', quantity: 1, phase: 1, note: '', marking: 'QF01', mount: 'din',
  }],
  circuits: [],
  connections: [],
}

const openEditor = async (page: import('@playwright/test').Page) => {
  await unlockWorkspace(page)
  await page.addInitScript(({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)), {
    key: 'panel36.projects.v1',
    payload: [project],
  })
  await page.goto('/app/editor')
  await page.getByRole('button', { name: 'Показать боковые панели' }).click()
  await expect(page.locator('.placed-device').first()).toBeVisible()
}

test('a styled listbox opens, is styled by the app, and picks a value by mouse', async ({ page }) => {
  await openEditor(page)
  const trigger = page.getByRole('button', { name: 'Корпус' })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.click()
  const listbox = page.getByRole('listbox').first()
  await expect(listbox).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  // The popup is app chrome, not the native OS menu.
  const chrome = await listbox.evaluate((node) => {
    const style = getComputedStyle(node)
    return { position: style.position, border: style.borderTopStyle, background: style.backgroundColor, optionCount: node.querySelectorAll('[role="option"]').length }
  })
  expect(chrome.position).toBe('absolute')
  expect(chrome.optionCount).toBeGreaterThan(3)

  const target = listbox.getByRole('option', { name: /U48C/ })
  await target.click()
  await expect(listbox).toBeHidden()
  // Choosing a housing stages a migration, which the editor confirms first.
  const migration = page.getByRole('dialog', { name: 'Подтвердите изменение корпуса' })
  await expect(migration).toBeVisible()
  await migration.getByRole('button', { name: /Применить|Подтвердить/ }).first().click()
  await expect(migration).toBeHidden()
  await expect(trigger).toContainText('U48C')
})

test('a styled listbox is fully keyboard operable', async ({ page }) => {
  await openEditor(page)
  // The phase field has no side effects, so keyboard focus stays with the control.
  const trigger = page.getByRole('button', { name: 'Фаза' })

  await trigger.focus()
  await trigger.press('ArrowDown')
  const listbox = page.getByRole('listbox').first()
  await expect(listbox).toBeVisible()
  // Focus moves into the listbox, so the active option is announced from there.
  await expect(listbox).toBeFocused()
  await expect(listbox).toHaveAttribute('aria-activedescendant', /-option-\d+$/)

  await listbox.press('Escape')
  await expect(listbox).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.press('Enter')
  await expect(listbox).toBeVisible()
  await listbox.press('End')
  await listbox.press('ArrowUp')
  await listbox.press('Enter')
  await expect(listbox).toBeHidden()
  await expect(trigger).toBeFocused()
  const value = (await trigger.textContent())?.trim()
  expect(['1 фаза', '3 фазы']).toContain(value)
})

test('a styled listbox closes on an outside click without changing the value', async ({ page }) => {
  await openEditor(page)
  const trigger = page.getByRole('button', { name: 'Рейка' })
  const before = (await trigger.textContent())?.trim()

  await trigger.click()
  await expect(page.getByRole('listbox').first()).toBeVisible()
  // A click outside the popup but still inside the inspector, so the board does not collapse the panels.
  await page.locator('.inspector-panel .panel-heading').click()

  await expect(page.getByRole('listbox')).toHaveCount(0)
  expect((await trigger.textContent())?.trim()).toBe(before)
})

test('the listbox opens upward when there is no room below', async ({ page }) => {
  await openEditor(page)
  const trigger = page.getByRole('button', { name: 'Корпус' })
  // The inspector is anchored to the bottom of the editor, so its fields sit low.
  await trigger.click()
  const placement = await page.getByRole('listbox').first().evaluate((node) => {
    const list = node.getBoundingClientRect()
    const button = (node.previousElementSibling as HTMLElement).getBoundingClientRect()
    return list.bottom <= button.top + 2 ? 'above' : 'below'
  })
  expect(['above', 'below']).toContain(placement)
  const fits = await page.getByRole('listbox').first().evaluate((node) => {
    const list = node.getBoundingClientRect()
    return list.top >= -1 && list.bottom <= window.innerHeight + 1 && list.left >= -1 && list.right <= window.innerWidth + 1
  })
  expect(fits).toBe(true)
})
