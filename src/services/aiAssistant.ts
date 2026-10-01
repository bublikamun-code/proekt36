import { categoryLabels } from '../data/catalog'
import { cabinetDefinitions, railDefinitions } from '../data/enclosures'
import type { Category, RailDefinition } from '../domain/types'

/**
 * The whole outbound path of the assistant in one file. Nothing here formats a panel:
 * the payload comes from `buildAssistantContext`, and this module only moves it between the
 * browser and the local proxy, then reduces the answer back to something the app can act on.
 */

/**
 * The proxy, the browser client and the production CSP all read VITE_AI_PROXY_PORT. It carries a
 * `VITE_` prefix on purpose: that is what the build exposes to the client, and using it here keeps
 * the three from drifting apart. It stays unset in almost every setup, in which case the default
 * below is what every part uses.
 */
const PROXY_BASE = `http://127.0.0.1:${import.meta.env.VITE_AI_PROXY_PORT || 8787}`
const HEALTH_TIMEOUT_MS = 2500
const CHAT_TIMEOUT_MS = 130_000

export interface AssistantHealth {
  ok: boolean
  configured: boolean
  provider: string
  model: string
}

export type AssistantActionCode = 'cabinet.migrate' | 'rail.migrate' | 'settings.reserve' | 'settings.inputCurrent' | 'catalog.focus' | 'rows.compact'

export interface AssistantAction {
  code: AssistantActionCode
  /** Built here, never taken from the model, so a model cannot invent UI wording. */
  label: string
  reason: string
  params: Record<string, string | number | boolean>
}

export interface AssistantAnswer {
  text: string
  actions: AssistantAction[]
  /** Proposals that failed validation. Surfaced so the panel can say "часть отклонена". */
  rejected: string[]
}

export interface AssistantProjectState {
  cabinetModules: number | null
  cabinetRows: number | null
  railModules: number | null
  inputCurrent: number
  reserveModules: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const asInteger = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, 240) : '')

/** A verified catalogue entry wins over a profile one, so the model cannot steer us to a guess. */
const resolveCabinet = (modules: number, rows: number): string | null => {
  const matches = cabinetDefinitions.filter((cabinet) => cabinet.modules === modules && cabinet.rows === rows)
  if (!matches.length) return null
  return (matches.find((cabinet) => cabinet.verificationStatus === 'verified') ?? matches[0]).id
}

const resolveRail = (modules: number): RailDefinition['id'] | null => (railDefinitions.find((rail) => rail.slots === modules)?.id ?? null)

const buildAction = (raw: unknown, state: AssistantProjectState): AssistantAction | string => {
  if (!isRecord(raw)) return 'предложение не является объектом'
  const code = raw.code
  const reason = asText(raw.reason)

  if (code === 'cabinet.migrate') {
    const modules = asInteger(raw.modules)
    const rows = asInteger(raw.rows)
    if (!modules || !rows) return 'cabinet.migrate без modules/rows'
    if (modules === state.cabinetModules && rows === state.cabinetRows) return `корпус ${modules}×${rows} уже выбран`
    const cabinetId = resolveCabinet(modules, rows)
    if (!cabinetId) return `в каталоге нет корпуса ${modules} модулей × ${rows} рядов`
    const cabinet = cabinetDefinitions.find((item) => item.id === cabinetId)
    if (!cabinet) return 'корпус не найден после разрешения'
    return {
      code,
      label: `Перейти на корпус ${modules}×${rows}`,
      reason,
      params: { cabinetId, modules, rows, verified: cabinet.verificationStatus === 'verified' },
    }
  }

  if (code === 'rail.migrate') {
    const modules = asInteger(raw.modules)
    if (!modules) return 'rail.migrate без modules'
    if (modules === state.railModules) return `рейка на ${modules} модулей уже выбрана`
    const railId = resolveRail(modules)
    if (!railId) return `рейки на ${modules} модулей нет`
    return { code, label: `Перейти на рейку ${modules} модулей`, reason, params: { railId, modules } }
  }

  if (code === 'settings.reserve') {
    const reserveModules = asInteger(raw.reserveModules)
    if (reserveModules === null || reserveModules < 0 || reserveModules > 200) return 'reserve вне диапазона 0–200'
    if (reserveModules === state.reserveModules) return `резерв ${reserveModules} мод. уже установлен`
    return { code, label: `Изменить резерв на ${reserveModules} мод.`, reason, params: { reserveModules } }
  }

  if (code === 'settings.inputCurrent') {
    const inputCurrent = asInteger(raw.inputCurrent)
    if (inputCurrent === null || inputCurrent < 1 || inputCurrent > 1000) return 'вводной ток вне диапазона 1–1000 А'
    if (inputCurrent === state.inputCurrent) return `вводной ток ${inputCurrent} А уже установлен`
    return { code, label: `Установить вводной ток ${inputCurrent} А`, reason, params: { inputCurrent } }
  }

  if (code === 'catalog.focus') {
    const category = raw.category
    if (typeof category !== 'string' || !(category in categoryLabels)) return 'неизвестная категория каталога'
    return { code, label: `Показать в каталоге: ${categoryLabels[category as Category]}`, reason, params: { category } }
  }

  if (code === 'rows.compact') return { code, label: 'Уплотнить все ряды', reason, params: {} }

  return `неизвестный код действия: ${String(code).slice(0, 40)}`
}

const MAX_ACTIONS = 6
const FENCE = /```panel36\s*([\s\S]*?)```/g

export const parseAssistantAnswer = (raw: string, state: AssistantProjectState): AssistantAnswer => {
  const actions: AssistantAction[] = []
  const rejected: string[] = []
  // Every block is read, not just the last one. A model that splits its plan into two fences used
  // to have the first one dropped in silence: the user saw a suggestion they could not apply, and
  // no message said anything was lost.
  const blocks = [...raw.matchAll(FENCE)].map((match) => match[1] ?? '').filter((block) => block.trim())
  const text = raw.replace(FENCE, '').trim()

  for (const [index, block] of blocks.entries()) {
    const position = blocks.length > 1 ? ` в блоке ${index + 1}` : ''
    try {
      const parsed: unknown = JSON.parse(block)
      const list = isRecord(parsed) && Array.isArray(parsed.actions) ? parsed.actions : []
      if (!list.length) rejected.push(`в блоке действий${position} нет ни одного предложения`)
      // The cap is on what the user is offered, counted across all blocks, so two fences cannot
      // double it.
      for (const item of list) {
        if (actions.length >= MAX_ACTIONS) break
        const result = buildAction(item, state)
        if (typeof result === 'string') rejected.push(result)
        else actions.push(result)
      }
    } catch {
      rejected.push(`блок действий${position} не разобран как JSON`)
    }
  }

  return { text, actions, rejected }
}

export const ASSISTANT_SYSTEM_PROMPT = [
  'Ты помощник по сборке распределительного щита в прототипе «Панель 36».',
  'Отвечай по-русски, кратко и по делу: сначала прямой ответ, потом основания.',
  '',
  'Ты получаешь СВОДКУ щита, а не проект. В сводке нет названий аппаратов, адресов, маркировок,',
  'примечаний, названий цепей и моделей CAD — и ты не должна их выдумывать. Опирайся только на',
  'переданные числа и общие правила. Если данных не хватает, скажи это прямо и спроси, что уточнить.',
  '',
  'Расчёты предварительные. Не выдавай их за проектное решение и не обещай, что схема соответствует нормам.',
  '',
  'Если нужно изменить настройки щита, добавь в конце ответа ровно один блок:',
  '```panel36',
  '{"actions":[{"code":"...","reason":"кратко по-русски"}]}',
  '```',
  'Допустимые коды и единственные допустимые поля:',
  '- cabinet.migrate: modules (сколько модулей), rows (сколько рядов) — конкретный корпус выберет приложение.',
  '- rail.migrate: modules (12 или 18).',
  '- settings.reserve: reserveModules (целое 0–200).',
  '- settings.inputCurrent: inputCurrent (целое 1–1000).',
  '- catalog.focus: category — одна из: MCB, RCCB, RCBO, SPD, relay, terminals, busbar, meter, PSU.',
  '- rows.compact: без полей.',
  'Не более трёх предложений за раз. Любое другое поле или код — приложение отбросит.',
].join('\n')

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && typeof payload.message === 'string' && payload.message) return payload.message
  } catch {
    /* the proxy always answers JSON, but a crash mid-write should not mask the status */
  }
  return `Прокси ответил ${response.status}`
}

export const probeAssistant = async (): Promise<AssistantHealth> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch(`${PROXY_BASE}/health`, { signal: controller.signal })
    if (!response.ok) return { ok: false, configured: false, provider: '', model: '' }
    const payload: unknown = await response.json()
    if (!isRecord(payload)) return { ok: false, configured: false, provider: '', model: '' }
    return {
      ok: payload.ok === true,
      configured: payload.configured === true,
      provider: typeof payload.provider === 'string' ? payload.provider : '',
      model: typeof payload.model === 'string' ? payload.model : '',
    }
  } catch {
    return { ok: false, configured: false, provider: '', model: '' }
  } finally {
    clearTimeout(timer)
  }
}

// `context` is a string, not the raw aggregate object: the proxy only forwards a string, and an
// object used to be dropped in silence, so the model answered as if it had never seen the panel.
export const askAssistant = async (input: { system: string; context: string; question: string; signal?: AbortSignal }): Promise<string> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(`${PROXY_BASE}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: input.system, context: input.context, question: input.question }),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 404) throw new Error('Прокси не найден. Запустите в отдельном терминале `npm run ai` и попробуйте снова.')
      if (response.status === 403) throw new Error('Прокси отклонил источник запроса. Откройте приложение на 127.0.0.1 или localhost.')
      throw new Error(await readErrorMessage(response))
    }
    const payload: unknown = await response.json()
    if (!isRecord(payload) || typeof payload.text !== 'string' || !payload.text.trim()) throw new Error('Провайдер вернул пустой ответ.')
    return payload.text
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Провайдер не ответил за 130 секунд. Повторите вопрос или упростите его.')
    }
    if (error instanceof TypeError) throw new Error('Прокси недоступен. Запустите в отдельном терминале `npm run ai` и попробуйте снова.')
    throw error
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}
