import { expect, test } from '@playwright/test'
import { gotoProjectEditor, seedWiringProject } from './helpers'

const wireTool = (page: import('@playwright/test').Page) => page.locator('[data-tool="wire"]')
const terminal = (page: import('@playwright/test').Page, key: string) => page.locator(`[data-terminal="${key}"]`)
// The drawn conductor and its transparent hit target carry the same id, so a bare
// `[data-connection-id]` would count every wire twice.
const wires = (page: import('@playwright/test').Page) => page.locator('.wire-hits [data-connection-id]')

test.beforeEach(async ({ page }) => {
  await seedWiringProject(page)
})

test('соединяет две клеммы инструментом «Провод» и отменяет результат', async ({ page }) => {
  await gotoProjectEditor(page, 'wiring-lab')

  await expect(wires(page)).toHaveCount(0)
  await wireTool(page).click()
  await expect(page.locator('[data-terminal]').first()).toBeVisible()

  await terminal(page, 'qf01:2:bottom').click()
  await terminal(page, 'qf02:1:top').click()

  // The conductor exists, and it ends on the clamps the two clicks named — not on the pixels the
  // pointer happened to be over.
  const wire = wires(page).first()
  await expect(wires(page)).toHaveCount(1)
  const drawn = await wire.getAttribute('d')
  expect(drawn).toMatch(/^M /)
  const to = await terminal(page, 'qf02:1:top').evaluate((node) => ({ x: node.getAttribute('cx'), y: node.getAttribute('cy') }))
  expect(drawn).toContain(`L ${to.x} ${to.y}`)

  // The busbar and the buttons stay undoable, or a wiring session is a dead end.
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(wires(page)).toHaveCount(0)
})

test('Escape снимает недописанный провод, а инструмент оставляет включённым', async ({ page }) => {
  await gotoProjectEditor(page, 'wiring-lab')
  await wireTool(page).click()
  await terminal(page, 'qf01:2:bottom').click()

  await page.locator('.editor-2d').press('Escape')
  await expect(wires(page)).toHaveCount(0)
  await expect(wireTool(page)).toHaveAttribute('aria-pressed', 'true')

  // Only the second Escape puts the board back into selection mode.
  await page.locator('.editor-2d').press('Escape')
  await expect(wireTool(page)).toHaveAttribute('aria-pressed', 'false')
})

test('не даёт занять клемму, в которую уже входит провод', async ({ page }) => {
  await gotoProjectEditor(page, 'wiring-lab')
  await wireTool(page).click()
  await terminal(page, 'qf01:2:bottom').click()
  await terminal(page, 'qf02:1:top').click()

  await expect(terminal(page, 'qf02:1:top')).toHaveAttribute('data-terminal-state', 'taken')
  await terminal(page, 'qf02:1:top').click()
  await expect(wires(page)).toHaveCount(1)
})

test('тянет провод от видимой шины N к клемме', async ({ page }) => {
  await gotoProjectEditor(page, 'wiring-lab')
  // The bar is a drawn object whether or not the wire tool is on; only its port waits for the tool.
  await expect(page.locator('.wires [data-bus-id="bus-n-bottom"]')).toBeVisible()
  await expect(page.locator('[data-terminal-bus="bus-n-bottom"]')).toHaveCount(0)

  await wireTool(page).click()
  await expect(page.locator('[data-terminal-bus="bus-n-bottom"]')).toBeVisible()
  await terminal(page, 'qf03:1:top').click()
  await page.locator('[data-terminal-bus="bus-n-bottom"]').click()

  await expect(wires(page)).toHaveCount(1)
  // A neutral is blue on the board, and the badge says N rather than L1.
  await expect(page.locator('.wires .wire-n').first()).toHaveCount(1)
  await expect(page.locator('.wire-label').first()).toHaveText('N')
})

test('гребёнка встаёт над рядом и видна в инспекторе', async ({ page }) => {
  await gotoProjectEditor(page, 'wiring-lab')
  await expect(page.locator('[data-comb-id]')).toHaveCount(0)

  await page.locator('[data-add-comb="0-3"]').click()
  await expect(page.locator('[data-comb-id]')).toHaveCount(1)
  await expect(page.locator('[data-comb-id]')).toHaveAttribute('data-comb-poles', '3')
  // Three teeth for three poles, and not one per device in the row.
  await expect(page.locator('[data-comb-id] .comb-tooth')).toHaveCount(3)

  // It sits above the row it feeds, not across the devices.
  const comb = await page.locator('[data-comb-id] .comb-bar').first().boundingBox()
  const device = await page.locator('.placed-device').first().boundingBox()
  if (!comb || !device) throw new Error('Доска не отрисована')
  expect(comb.y + comb.height).toBeLessThanOrEqual(device.y + 1)

  await expect(page.locator('[data-comb-card]')).toHaveCount(1)
  await expect(page.locator('[data-comb-card] input').first()).toHaveValue('Гребёнка 3P')
})

test('инспектор показывает клеммы выбранного аппарата и снимает провод по кнопке', async ({ page }) => {
  await gotoProjectEditor(page, 'wiring-lab')
  await wireTool(page).click()
  await terminal(page, 'qf01:2:bottom').click()
  await terminal(page, 'qf02:1:top').click()
  await wireTool(page).click()

  await page.locator('[data-tool="select"]').click()
  await page.locator('.placed-device').first().click()

  // Every clamp is listed, and the one the wire enters names the wire rather than hiding it.
  await expect(page.locator('[data-terminal-grid] [data-terminal-row]')).toHaveCount(2)
  await expect(page.locator('[data-wire-row]')).toHaveCount(1)
  await expect(page.locator('[data-terminal-row="qf01:2:bottom"]')).toHaveClass(/busy/)
  await expect(page.locator('[data-terminal-row="qf01:1:top"]')).not.toHaveClass(/busy/)

  // Selecting from the list lights the conductor on the board, so the two views are one object.
  await page.getByRole('button', { name: /Показать провод/ }).click()
  await expect(wires(page).first()).toHaveClass(/selected/)

  // Taking a conductor off goes through the same app-wide confirmation as deleting an appliance.
  await page.getByRole('button', { name: 'Снять провод' }).click()
  const dialog = page.getByRole('dialog', { name: 'Снять провод?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Снять провод', exact: true }).click()
  await expect(wires(page)).toHaveCount(0)
})

test('старый проект без клемм доезжает до v3 с шинами и открывается', async ({ page }) => {
  // A v2 payload is a board whose lines came out of an abstract left-hand column: it names no
  // clamp and knows nothing about bars. Opening it has to produce a usable panel rather than an
  // editor with nothing to draw, so this asserts the migration end to end through storage.
  await page.addInitScript(() => {
    // The file's shared seed plants a v3 board before this test's script runs. The repository
    // reads the current key first and stops there, so the superseded key has to be the only
    // project it can find — otherwise the v2 panel is never read and the deep link finds nothing.
    localStorage.removeItem('panel36.projects.v3')
    localStorage.setItem('panel36.hints.v1', 'dismissed')
    localStorage.setItem('panel36.projects.v2', JSON.stringify([{
      schemaVersion: 2,
      id: 'legacy-lab',
      name: 'Старая колода',
      preset: 'demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: {
        inputCurrent: 63, phase: 1, rows: 2, reserveModules: 4,
        enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106,
        cabinetId: 'panel36-24-embedded', railId: 'rail-12',
      },
      devices: [{
        instanceId: 'qf01', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0,
        address: 'QF01', quantity: 1, phase: 1, note: '', marking: 'QF01', mount: 'din',
      }],
      circuits: [],
      connections: [{
        id: 'c1', circuitId: '', fromBus: 'L', fromDeviceId: '', toDeviceId: 'qf01',
        color: '', thickness: 2, label: 'L1 → QF01',
      }],
    }]))
  })
  await gotoProjectEditor(page, 'legacy-lab')

  // The board opens, and the migration gave it the bars a v3 panel is expected to have.
  await expect(page.locator('.wires [data-bus-kind="N"]')).toBeVisible()
  await expect(page.locator('.wires [data-bus-kind="PE"]')).toBeVisible()
  // The old line still names its circuit, so the user does not lose the work they had.
  await expect(page.locator('.wires .wire-label').first()).toHaveText('L1 → QF01')
})
