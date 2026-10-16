import { expect, test } from '@playwright/test'
import { openSidePanels, pickOption, unlockWorkspace } from './helpers'

/**
 * The v5 phase split: pre-v5 «phase: 3» meant either a single-phase line on L3 or a three-phase
 * line, and the data cannot tell. Opening such a project must ask, not guess; an explicit choice
 * — here or in the inspector — is the only thing that clears the ambiguity.
 */

const legacyProject = {
  schemaVersion: 4,
  id: 'phase-legacy',
  name: 'Старая фаза',
  preset: 'test',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  settings: { inputCurrent: 63, phase: 3, reserveModules: 4, rows: 2, enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106, cabinetId: 'panel36-24-embedded', railId: 'rail-12' },
  devices: [{
    instanceId: 'qf-01', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0,
    address: 'QF01', quantity: 1, phase: 1, note: '', marking: 'QF01', mount: 'din',
  }],
  circuits: [{
    id: 'c-old', name: 'Старая линия', loadName: 'Насос', current: 9, power: 0, phase: 3,
    protectionDeviceId: 'qf-01', color: '', wireCrossSection: 2.5, note: '',
  }],
  connections: [],
  busAssemblies: [],
  combs: [],
}

const openLegacy = async (page: import('@playwright/test').Page) => {
  await unlockWorkspace(page)
  await page.addInitScript(({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)), {
    key: 'panel36.projects.v3',
    payload: [legacyProject],
  })
  await page.goto(`/app/projects/${legacyProject.id}/editor`)
}

test('the clarification dialog asks about a legacy «phase: 3» and a choice closes it', async ({ page }) => {
  await openLegacy(page)
  const dialog = page.getByRole('dialog', { name: 'Уточните фазу линии' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.phase-clarify-list li')).toHaveCount(1)
  await expect(dialog).toContainText('Старая линия')

  await dialog.getByRole('button', { name: 'Трёхфазная' }).click()
  await expect(dialog).toBeHidden()

  await openSidePanels(page)
  // A three-phase line loads all three baskets: 9 A on L1, L2 and L3.
  await expect(page.locator('.inspector-panel .phase-bar')).toHaveAttribute('aria-label', 'Нагрузка фаз: 9, 9, 9 ампер')
})

test('closing the dialog without a choice keeps the warning until the inspector choice', async ({ page }) => {
  await openLegacy(page)
  const dialog = page.getByRole('dialog', { name: 'Уточните фазу линии' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await openSidePanels(page)
  const card = page.locator('.circuit-card').first()
  await expect(card.locator('.phase-ambiguous')).toBeVisible()
  // While ambiguous, the line keeps its L3 reading.
  await expect(page.locator('.inspector-panel .phase-bar')).toHaveAttribute('aria-label', 'Нагрузка фаз: 0, 0, 9 ампер')

  await pickOption(card, 'Фазы линии', '1 фаза')
  await expect(card.locator('.phase-ambiguous')).toBeHidden()
  // A single-phase line shows its phase picker again; the L3 reading stays.
  await expect(card.getByLabel('Фаза')).toBeVisible()
  await expect(page.locator('.inspector-panel .phase-bar')).toHaveAttribute('aria-label', 'Нагрузка фаз: 0, 0, 9 ампер')
})
