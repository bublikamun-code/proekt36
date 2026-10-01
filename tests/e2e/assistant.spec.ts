import { expect, test, type Locator } from '@playwright/test'
import { ASSISTANT_CONTEXT_REVISION } from '../../src/domain/assistantContext'
import { unlockWorkspace } from './helpers'

const project = {
  schemaVersion: 2,
  id: 'assistant-project',
  name: 'Квартира-стенд',
  preset: 'apartment',
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  settings: { inputCurrent: 40, phase: 1, reserveModules: 4, rows: 2, enclosureWidth: 283, enclosureHeight: 357, enclosureDepth: 106, cabinetId: 'panel36-24-embedded', railId: 'rail-12' },
  devices: [
    { instanceId: 'qf-01', productId: 'ekf-mcb-1p-c6', row: 0, slot: 0, address: 'QF01', quantity: 1, phase: 1, note: 'Секретная нагрузка', marking: 'QF01', mount: 'din' },
    { instanceId: 'qf-02', productId: 'iek-mcb-1p-c10', row: 0, slot: 2, address: 'QF02', quantity: 1, phase: 1, note: '', marking: '', mount: 'din' },
  ],
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
  const assistant = page.locator('.assistant')
  await assistant.getByRole('button', { name: 'ИИ-помощник' }).click()
  return assistant
}

/**
 * The panel probes the proxy once when it mounts and gives that single probe a 2.5 s budget,
 * so on a loaded machine a slow answer reads as "не отвечает" and stays there until the user
 * asks again. Retrying is what a user does too, and it is the only thing separating a slow
 * probe from a dead one, so the test retries instead of failing on a slow machine.
 */
const waitForProxyState = async (assistant: Locator, state: string | RegExp) => {
  await expect(async () => {
    if (await assistant.locator('.state-line.off').count()) {
      await assistant.getByRole('button', { name: 'Проверить снова' }).click()
    }
    await expect(assistant.locator('.state-line')).toHaveText(state)
  }).toPass({ timeout: 20_000 })
}

test.describe('ИИ-помощник', () => {
  test('прокси не запущен — панель объясняет, что делать, и не шлёт вопрос', async ({ page }) => {
    await page.route('http://127.0.0.1:8787/**', (route) => route.abort())
    const assistant = await openEditor(page)

    await expect(assistant.locator('.state-line')).toHaveText('Локальный прокси не отвечает')
    await expect(assistant.getByText('npm run ai')).toBeVisible()
    await expect(assistant.getByRole('button', { name: 'Проверить прокси' })).toBeEnabled()

    await assistant.getByLabel('Вопрос по сборке щита').fill('Хватает ли резерва?')
    await assistant.getByRole('button', { name: 'Проверить прокси' }).click()
    await expect(assistant.locator('.entry.asked')).toHaveCount(0)
  })

  test('прокси без ключа — подсказка про env-файл', async ({ page }) => {
    await page.route('http://127.0.0.1:8787/health', (route) => route.fulfill({ json: { ok: true, configured: false, provider: 'anthropic', model: 'claude-sonnet-5' } }))
    const assistant = await openEditor(page)

    await waitForProxyState(assistant, 'Прокси запущен, но ключ не задан')
    await expect(assistant.getByText('AI_API_KEY')).toBeVisible()
  })

  test('ответ принимается, в провод уходит только сводка, предложение применяется и отменяется', async ({ page }) => {
    const bodies: string[] = []
    await page.route('http://127.0.0.1:8787/health', (route) => route.fulfill({ json: { ok: true, configured: true, provider: 'anthropic', model: 'claude-sonnet-5' } }))
    await page.route('http://127.0.0.1:8787/chat', (route) => {
      bodies.push(route.request().postData() ?? '')
      return route.fulfill({
        json: {
          text: 'Резерв стоит увеличить.\n\n```panel36\n{"actions":[{"code":"settings.reserve","reserveModules":16,"reason":"под будущие цепи"},{"code":"project.delete","reason":"выдуманное"}]}\n```',
        },
      })
    })

    const assistant = await openEditor(page)
    await waitForProxyState(assistant, /anthropic/)

    // The wire payload is the privacy promise, so it is checked here and not only in unit tests.
    expect(bodies).toHaveLength(0)
    await assistant.getByLabel('Вопрос по сборке щита').fill('Хватает ли резерва под расширение?')
    await assistant.getByRole('button', { name: 'Спросить' }).click()
    await expect(assistant.locator('.answer')).toHaveText('Резерв стоит увеличить.')
    expect(bodies).toHaveLength(1)
    for (const secret of ['Квартира-стенд', 'assistant-project', 'QF01', 'Секретная нагрузка', 'ekf-mcb-1p-c6', 'AVO-10']) {
      expect(bodies[0]).not.toContain(secret)
    }
    expect(bodies[0]).toContain(ASSISTANT_CONTEXT_REVISION)
    // The proxy forwards `context` only when it is a string and used to drop an object in
    // silence, so the model answered without ever seeing the panel. Assert the type rather
    // than the bytes: a nested object still contains the revision and would pass a substring
    // check, which is why the bug survived this test.
    const sent = JSON.parse(bodies[0]) as { context?: unknown }
    expect(typeof sent.context, 'сводка должна уходить строкой, иначе прокси её отбросит').toBe('string')
    expect(JSON.parse(sent.context as string)).toMatchObject({ revision: ASSISTANT_CONTEXT_REVISION })

    await expect(assistant.getByText(/Отклонено:.*неизвестный код/)).toBeVisible()

    const proposal = assistant.getByRole('button', { name: /Изменить резерв на 16 мод/ })
    await proposal.click()
    await expect(assistant.getByText('Резерв обновлён.')).toBeVisible()
    await expect(proposal).toBeDisabled()
    await expect(page.getByLabel('Резерв, мод.')).toHaveValue('16')

    await page.getByRole('button', { name: 'Отменить' }).click()
    await expect(page.getByLabel('Резерв, мод.')).toHaveValue('4')
  })

  test('долгий запрос можно отменить и не ждать таймаут', async ({ page }) => {
    await page.route('http://127.0.0.1:8787/health', (route) => route.fulfill({ json: { ok: true, configured: true, provider: 'anthropic', model: 'claude-sonnet-5' } }))
    let release = (): void => {}
    await page.route('http://127.0.0.1:8787/chat', async (route) => {
      await new Promise<void>((resolve) => { release = resolve })
      await route.fulfill({ json: { text: 'Поздний ответ' } })
    })

    const assistant = await openEditor(page)
    await waitForProxyState(assistant, /anthropic/)
    await assistant.getByLabel('Вопрос по сборке щита').fill('Считай медленно')
    await assistant.getByRole('button', { name: 'Спросить' }).click()
    await expect(assistant.getByText('Помощник думает…')).toBeVisible()

    await assistant.getByRole('button', { name: 'Отменить' }).click()
    await expect(assistant.getByText('Вопрос отменён.')).toBeVisible()
    await expect(assistant.locator('.entry.asked')).toHaveCount(0)
    release()
  })

  test('показано, что именно уходит провайдеру', async ({ page }) => {
    await page.route('http://127.0.0.1:8787/**', (route) => route.abort())
    const assistant = await openEditor(page)
    await assistant.getByText('Что уходит провайдеру').click()
    await expect(assistant.locator('.disclosure li').first()).toBeVisible()
    await expect(assistant.getByText(/Проект остаётся в браузере/)).toBeVisible()
  })
})
