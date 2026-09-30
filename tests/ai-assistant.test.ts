import { afterEach, describe, expect, it, vi } from 'vitest'
import { cabinetById } from '../src/data/enclosures'
import { askAssistant, parseAssistantAnswer, probeAssistant, type AssistantProjectState } from '../src/services/aiAssistant'

const state = (patch: Partial<AssistantProjectState> = {}): AssistantProjectState => ({
  cabinetModules: 24,
  cabinetRows: 4,
  railModules: 12,
  inputCurrent: 40,
  reserveModules: 8,
  ...patch,
})

const block = (actions: unknown) => `Сводка посчитана.\n\n\`\`\`panel36\n${JSON.stringify({ actions })}\n\`\`\`\n`

const jsonResponse = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('разбор ответа помощника', () => {
  it('вынимает предложения и убирает служебный блок из текста', () => {
    const answer = parseAssistantAnswer(block([{ code: 'settings.reserve', reserveModules: 12, reason: 'на расширение' }]), state())
    expect(answer.actions).toHaveLength(1)
    expect(answer.actions[0]).toMatchObject({ code: 'settings.reserve', label: 'Изменить резерв на 12 мод.', reason: 'на расширение', params: { reserveModules: 12 } })
    expect(answer.text).toBe('Сводка посчитана.')
    expect(answer.rejected).toEqual([])
  })

  it('текст без блока остаётся ответом без действий', () => {
    const answer = parseAssistantAnswer('Резерв уже достаточен.', state())
    expect(answer.text).toBe('Резерв уже достаточен.')
    expect(answer.actions).toEqual([])
    expect(answer.rejected).toEqual([])
  })

  it('подпись кнопки собирается на стороне приложения, а не берётся из ответа', () => {
    const answer = parseAssistantAnswer(block([{ code: 'settings.reserve', reserveModules: 20, label: 'Удалить проект', reason: '' }]), state())
    expect(answer.actions[0]?.label).toBe('Изменить резерв на 20 мод.')
    expect(answer.text).not.toContain('Удалить проект')
  })

  it('корпус выбирается из каталога по форме, а не по названию из ответа', () => {
    const answer = parseAssistantAnswer(block([{ code: 'cabinet.migrate', modules: 48, rows: 4, cabinetId: 'panel36-12-embedded' }]), state())
    const action = answer.actions[0]
    expect(action?.code).toBe('cabinet.migrate')
    const resolved = cabinetById.get(String(action?.params.cabinetId))
    expect(resolved).toBeDefined()
    expect(resolved?.modules).toBe(48)
    expect(resolved?.rows).toBe(4)
    // The model named a different cabinet; the app must ignore that and use the shape it asked for.
    expect(String(action?.params.cabinetId)).not.toBe('panel36-12-embedded')
  })

  it('корпуса такой формы в каталоге нет — предложение отклоняется с объяснением', () => {
    const answer = parseAssistantAnswer(block([{ code: 'cabinet.migrate', modules: 36, rows: 4 }]), state())
    expect(answer.actions).toEqual([])
    expect(answer.rejected[0]).toContain('36 модулей × 4 рядов')
  })

  it('отбрасывает неизвестный код, неизвестную категорию, битый JSON и выход за диапазон', () => {
    const unknownCode = parseAssistantAnswer(block([{ code: 'project.delete' }]), state())
    expect(unknownCode.actions).toEqual([])
    expect(unknownCode.rejected[0]).toContain('неизвестный код')

    const unknownCategory = parseAssistantAnswer(block([{ code: 'catalog.focus', category: 'Трансформатор' }]), state())
    expect(unknownCategory.actions).toEqual([])
    expect(unknownCategory.rejected[0]).toContain('категория')

    const outOfRange = parseAssistantAnswer(block([{ code: 'settings.reserve', reserveModules: 5000 }]), state())
    expect(outOfRange.actions).toEqual([])
    expect(outOfRange.rejected[0]).toContain('диапазон')

    const broken = parseAssistantAnswer('```panel36\n{actions: [\n```', state())
    expect(broken.actions).toEqual([])
    expect(broken.rejected[0]).toContain('JSON')
  })

  it('не предлагает то, что уже настроено', () => {
    const answer = parseAssistantAnswer(
      block([
        { code: 'settings.reserve', reserveModules: 8 },
        { code: 'settings.inputCurrent', inputCurrent: 40 },
        { code: 'rail.migrate', modules: 12 },
        { code: 'cabinet.migrate', modules: 24, rows: 4 },
      ]),
      state(),
    )
    expect(answer.actions).toEqual([])
    expect(answer.rejected).toHaveLength(4)
  })

  it('ограничивает число предложений', () => {
    const answer = parseAssistantAnswer(block(Array.from({ length: 9 }, () => ({ code: 'rows.compact' }))), state())
    expect(answer.actions).toHaveLength(6)
  })
})

describe('клиент прокси', () => {
  it('health: прокси недоступен — это не ошибка, а состояние «выключен»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(probeAssistant()).resolves.toEqual({ ok: false, configured: false, provider: '', model: '' })
  })

  it('health: читает готовность и модель', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true, configured: true, provider: 'anthropic', model: 'claude-sonnet-5' })))
    await expect(probeAssistant()).resolves.toEqual({ ok: true, configured: true, provider: 'anthropic', model: 'claude-sonnet-5' })
  })

  it('чат: отправляет ровно переданную сводку, без добавления данных проекта', async () => {
    const calls: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return jsonResponse(200, { text: 'Ответ' })
    }))
    // The proxy takes the summary as the already formatted string `formatAssistantContext` produced,
    // not as an object: an object here reached the proxy and was dropped without a word.
    const summary = { revision: 'panel36.assistant-context.v1', panel: { rows: 4 } }
    const context = JSON.stringify(summary)
    await expect(askAssistant({ system: 'система', context, question: 'вопрос' })).resolves.toBe('Ответ')
    expect(calls[0]?.url).toBe('http://127.0.0.1:8787/chat')
    expect(calls[0]?.body).toEqual({ system: 'система', context, question: 'вопрос' })
    expect(JSON.parse(context)).toEqual(summary)
  })

  it('чат: ключ не задан — сообщение прокси доходит до пользователя', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: 'no_api_key', message: 'Прокси запущен, но ключ не задан.' })))
    await expect(askAssistant({ system: 's', context: '{}', question: 'q' })).rejects.toThrow('ключ не задан')
  })

  it('чат: прокси не запущен — подсказка с командой запуска', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: 'not_found' })))
    await expect(askAssistant({ system: 's', context: '{}', question: 'q' })).rejects.toThrow('npm run ai')
  })

  it('чат: чужой origin — объяснение без утечки деталей', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: 'origin_not_allowed' })))
    await expect(askAssistant({ system: 's', context: '{}', question: 'q' })).rejects.toThrow('127.0.0.1')
  })

  it('чат: оборванное соединение читается как недоступный прокси', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(askAssistant({ system: 's', context: '{}', question: 'q' })).rejects.toThrow('Прокси недоступен')
  })

  it('чат: пустой ответ провайдера не показывается как пустая реплика', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { text: '   ' })))
    await expect(askAssistant({ system: 's', context: '{}', question: 'q' })).rejects.toThrow('пустой ответ')
  })

  it('чат: отмена запроса пользователем не превращается в «прокси недоступен»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    const controller = new AbortController()
    const pending = askAssistant({ system: 's', context: '{}', question: 'q', signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('130 секунд')
  })
})
