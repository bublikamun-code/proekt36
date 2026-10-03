import { expect, test } from '@playwright/test'
import { unlockWorkspace } from './helpers'

/**
 * The board's header.
 *
 * It is outside the visual baseline, which captures only the working area, so nothing here was
 * covered: a control that ended up underneath another one, or a theme that came back plain after a
 * reload, would have passed every test in the suite. A control a person cannot see or reach is a
 * control that does not exist, whatever the markup says.
 */
test.describe('шапка доски', () => {
  test.setTimeout(180_000)

  const openBoard = async (page: import('@playwright/test').Page) => {
    await unlockWorkspace(page)
    await page.goto('/app/board?fixture=demo')
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
  }

  test('тема переключается и переживает перезагрузку', async ({ page }) => {
    await openBoard(page)
    const before = await page.evaluate(() => document.documentElement.dataset.theme ?? '')
    const toggle = page.getByRole('button', { name: /Включить (тёмную|светлую) тему/ })
    await expect(toggle).toBeVisible()
    await toggle.click()

    const after = await page.evaluate(() => document.documentElement.dataset.theme ?? '')
    expect(after).not.toBe(before)

    await page.reload()
    await expect(page.locator('.board-scene')).toBeVisible({ timeout: 60_000 })
    // A theme that resets on reload looks like a panel that ignored you.
    expect(await page.evaluate(() => document.documentElement.dataset.theme ?? '')).toBe(after)
  })

  test('ни одна кнопка шапки не лежит под другой', async ({ page }) => {
    await openBoard(page)
    const clashes = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('.app-header button, .app-header select, .app-header label, .app-header input')]
        .filter((el) => el.offsetParent !== null || el.getClientRects().length)
      const names = controls.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName)
      const found: string[] = []
      for (let i = 0; i < controls.length; i += 1) {
        const a = controls[i].getBoundingClientRect()
        if (!a.width || !a.height) continue
        for (let j = i + 1; j < controls.length; j += 1) {
          const b = controls[j].getBoundingClientRect()
          if (!b.width || !b.height) continue
          const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
          // A label wrapping its own field is supposed to overlap it. What matters is one control
          // covering another control, which leaves the covered one unreachable.
          const nested = controls[i].contains(controls[j]) || controls[j].contains(controls[i])
          if (overlap && !nested) found.push(`${names[i]} ←→ ${names[j]}`)
        }
      }
      return found
    })
    expect(clashes).toEqual([])
    // Without this guard the check passes on an empty selection, which is how a header can have no
    // overlap coverage at all while looking covered.
    const controls = await page.locator('.app-header button, .app-header select, .app-header label, .app-header input').count()
    expect(controls).toBeGreaterThan(5)
  })

  test('все действия шапки доступны по названию', async ({ page }) => {
    await openBoard(page)
    // A person looking for «Провести» finds it by reading, not by reading the source.
    for (const name of ['Выбрать', 'Адрес', 'Провести', 'Удалить', 'Дублировать', 'Отменить', 'Экспорт', 'Печать']) {
      await expect(page.locator('.app-header').getByRole('button', { name: new RegExp(name) }).first()).toBeAttached()
    }
  })
})
