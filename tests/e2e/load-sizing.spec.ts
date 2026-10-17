import { expect, test, type Page } from '@playwright/test'
import { openSidePanels, pickOption, unlockWorkspace } from './helpers'

/**
 * PI-1 «приложение считает» в инспекторе: линия, спланированная мощностью, получает
 * расчётный ток с происхождением (справочник или ручной ввод), а подбор защиты и сечения
 * применяется к цепи одним нажатием. Числа ожиданий пересчитаны руками — см. формулы.
 */

const project = {
  schemaVersion: 5,
  id: 'load-sizing-e2e',
  name: 'Подбор в инспекторе',
  preset: 'test',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  settings: { inputCurrent: 40, phase: 1, reserveModules: 2, rows: 1, enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106, cabinetId: 'panel36-24-embedded', railId: 'rail-12' },
  devices: [
    { instanceId: 'qf-01', productId: 'ekf-mcb-1p-b16', row: 0, slot: 0, address: 'QF01', quantity: 1, phase: 1, note: '', marking: 'QF01', mount: 'din' },
    { instanceId: 'qf-02', productId: 'ekf-mcb-1p-c6', row: 0, slot: 2, address: 'QF02', quantity: 1, phase: 1, note: '', marking: 'QF02', mount: 'din' },
  ],
  circuits: [{
    id: 'c-sockets', name: 'Розетки', loadName: 'Розетки комнаты', current: 0, power: 3500, phase: 1, phaseCount: 1,
    protectionDeviceId: 'qf-02', color: '#c65c3b', wireCrossSection: 1, note: '', kind: 'power', cableLength: 12,
  }],
  connections: [],
  busAssemblies: [],
  combs: [],
  rooms: [],
}

const openProject = async (page: Page) => {
  await unlockWorkspace(page)
  await page.addInitScript(({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)), {
    key: 'panel36.projects.v3',
    payload: [project],
  })
  await page.goto(`/app/projects/${project.id}/editor`)
  await openSidePanels(page)
  return page.locator('.circuit-card').first()
}

test('расчётный ток считается из мощности и объясняет происхождение', async ({ page }) => {
  const card = await openProject(page)

  // 3500 Вт, розетки: 3500·0,8/(230·0,95) ≈ 12,8 А по справочнику, помечено предварительным.
  const math = card.locator('[data-load-math]')
  await expect(math).toContainText('≈ 12,8 А')
  await expect(math).toContainText('3,5 кВт · kс 0,80 · cos φ 0,95 · 230 В · справочник')
  await expect(math).toContainText('предварительно')

  // Вид линии меняет строку справочника: свет — kс 1, cos φ 0,92 → 16,5 А.
  await pickOption(card, 'Вид линии', 'Освещение')
  await expect(math).toContainText('≈ 16,5 А')

  // Ручной ввод перекрывает справочник: cos φ 1 → 3500/(230·0,92) → 15,2 А с пометкой.
  // Числовые поля применяются по change, поэтому после заполнения поле теряет фокус.
  await card.getByLabel('cos φ').fill('1')
  await card.getByLabel('cos φ').press('Tab')
  await expect(math).toContainText('15,2 А')
  await expect(math).toContainText('ручной ввод')
})

test('подбор защиты и сечения применяется к цепи', async ({ page }) => {
  const card = await openProject(page)

  // Расчётные 12,8 А требуют 16 А: на доске это QF01 (B16), а не стоящий на цепи QF02 (6 А).
  const hint = card.locator('[data-load-hint]')
  await expect(hint).toContainText('C16')
  await expect(hint).toContainText('2,5 мм²')

  await hint.getByRole('button', { name: 'Подобрать защиту' }).click()
  await expect(card.getByLabel('Защита')).toContainText('QF01')

  // Сечение 1 мм² не держит номинал 16 А — подбор ставит 2,5 мм² (минимум розеток).
  await expect(card.locator('[data-load-hint]')).toContainText('2,5 мм²')
  await hint.getByRole('button', { name: 'Подобрать сечение' }).click()
  await expect(card.getByLabel('Провод, мм²')).toHaveValue('2.5')
  await expect(page.locator('.toast')).toContainText('мм²')
})
