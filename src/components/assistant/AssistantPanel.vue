<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { assistantContextDisclosure, buildAssistantContext, formatAssistantContext } from '../../domain/assistantContext'
import type { Category } from '../../domain/types'
import { validateProject } from '../../domain/validation'
import { ASSISTANT_SYSTEM_PROMPT, askAssistant, parseAssistantAnswer, probeAssistant, type AssistantAction, type AssistantHealth } from '../../services/aiAssistant'
import { cabinetById, railById } from '../../data/enclosures'
import { useProjectStore } from '../../stores/project'

const emit = defineEmits<{ focusCategory: [Category] }>()

const store = useProjectStore()
const { currentProject, definitions } = storeToRefs(store)

const open = ref(false)
const health = ref<AssistantHealth | null>(null)
const question = ref('')
const busy = ref(false)
const error = ref('')
const log = ref<{ id: number; question: string; text: string; actions: AssistantAction[]; rejected: string[]; applied: { label: string; result: string }[] }[]>([])
let nextId = 0
let inFlight: AbortController | null = null
const cancelled = ref(false)

const context = computed(() => buildAssistantContext(currentProject.value, definitions.value, validateProject(currentProject.value, definitions.value)))
const disclosure = computed(() => assistantContextDisclosure(context.value))
const ready = computed(() => health.value?.ok === true && health.value.configured)

/** 'off' — the proxy is not running, 'nokey' — it runs without a key, 'ready' — it can answer. */
const state = computed<'off' | 'nokey' | 'ready'>(() => {
  if (busy.value) return 'ready'
  if (!health.value?.ok) return 'off'
  return health.value.configured ? 'ready' : 'nokey'
})

const stateTitle = computed(() => {
  if (state.value === 'off') return 'Локальный прокси не отвечает'
  if (state.value === 'nokey') return 'Прокси запущен, но ключ не задан'
  return `Готов: ${health.value?.provider} · ${health.value?.model}`
})

const check = async () => {
  health.value = await probeAssistant()
}

const projectState = () => {
  const settings = currentProject.value.settings
  const cabinet = settings.cabinetId ? cabinetById.get(settings.cabinetId) : undefined
  const rail = settings.railId ? railById.get(settings.railId) : undefined
  return {
    cabinetModules: cabinet?.modules ?? null,
    cabinetRows: cabinet?.rows ?? null,
    railModules: rail?.slots ?? null,
    inputCurrent: settings.inputCurrent,
    reserveModules: settings.reserveModules,
  }
}

const apply = (action: AssistantAction): string => {
  const params = action.params
  if (action.code === 'cabinet.migrate') {
    const plan = store.stageCabinetMigration(String(params.cabinetId))
    return plan.canApply ? 'План перехода показан в диалоге — подтвердите его.' : 'Переход невозможен, план показан в диалоге.'
  }
  if (action.code === 'rail.migrate') {
    store.stageRailMigration(String(params.railId) as 'rail-12' | 'rail-18')
    return 'План смены рейки показан в диалоге — подтвердите его.'
  }
  if (action.code === 'settings.reserve') {
    store.updateSettings({ reserveModules: Number(params.reserveModules) })
    return 'Резерв обновлён.'
  }
  if (action.code === 'settings.inputCurrent') {
    store.updateSettings({ inputCurrent: Number(params.inputCurrent) })
    return 'Вводной ток обновлён.'
  }
  if (action.code === 'catalog.focus') {
    emit('focusCategory', String(params.category) as Category)
    return 'Каталог отфильтрован.'
  }
  if (action.code === 'rows.compact') {
    store.compactAllRows()
    return 'Ряды уплотнены.'
  }
  return 'Действие не поддерживается.'
}

const ask = async () => {
  const text = question.value.trim()
  if (!text || busy.value) return
  if (!ready.value) return check()
  busy.value = true
  error.value = ''
  question.value = ''
  cancelled.value = false
  inFlight = new AbortController()
  try {
    const raw = await askAssistant({ system: ASSISTANT_SYSTEM_PROMPT, context: formatAssistantContext(context.value), question: text, signal: inFlight.signal })
    const answer = parseAssistantAnswer(raw, projectState())
    log.value = [...log.value, { id: (nextId += 1), question: text, text: answer.text, actions: answer.actions, rejected: answer.rejected, applied: [] }]
  } catch (failure) {
    // A user abort reaches us as the same exception as a timeout, so the flag decides which one to report.
    error.value = cancelled.value ? 'Вопрос отменён.' : failure instanceof Error ? failure.message : 'Не удалось получить ответ.'
  } finally {
    busy.value = false
    inFlight = null
  }
}

const cancel = () => {
  cancelled.value = true
  inFlight?.abort()
  question.value = ''
  error.value = 'Вопрос отменён.'
}

const applyAction = (entry: { applied: { label: string; result: string }[] }, action: AssistantAction) => {
  entry.applied = [...entry.applied, { label: action.label, result: apply(action) }]
}

const isApplied = (entry: { applied: { label: string }[] }, action: AssistantAction) => entry.applied.some((item) => item.label === action.label)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    void ask()
  }
}

onMounted(check)
</script>

<template>
  <section class="assistant" aria-labelledby="assistant-title">
    <button type="button" class="assistant-toggle" :aria-expanded="open" aria-controls="assistant-body" @click="open = !open">
      <span id="assistant-title">ИИ-помощник</span>
      <span class="badge" :class="state">{{ state === 'ready' ? 'готов' : state === 'nokey' ? 'без ключа' : 'выключен' }}</span>
    </button>

    <div v-show="open" id="assistant-body" class="assistant-body">
      <p class="microcopy">
        Помощник отвечает по сводке щита: сколько аппаратов, чем занято, какие проверки сработали. Он не видит названий, адресов, примечаний и моделей.
        Расчёты предварительные — решение остаётся за вами.
      </p>

      <p class="state-line" :class="state" role="status">{{ stateTitle }}</p>
      <div v-if="state === 'off'" class="state-help">
        <p>Запустите в отдельном терминале:</p>
        <code>npm run ai</code>
        <button type="button" class="text-button" @click="check">Проверить снова</button>
      </div>
      <div v-else-if="state === 'nokey'" class="state-help">
        <p>Скопируйте <code>tools/ai-proxy.env.example</code> в <code>tools/ai-proxy.env</code>, впишите <code>AI_API_KEY</code> и перезапустите прокси.</p>
        <button type="button" class="text-button" @click="check">Проверить снова</button>
      </div>

      <details class="disclosure">
        <summary>Что уходит провайдеру</summary>
        <ul><li v-for="line in disclosure" :key="line">{{ line }}</li></ul>
        <p class="microcopy">Проект остаётся в браузере: ключ провайдера хранится только в локальном прокси, запросы идут на 127.0.0.1.</p>
      </details>

      <ol class="log" aria-label="История вопросов">
        <li v-for="entry in log" :key="entry.id" class="entry">
          <p class="asked">{{ entry.question }}</p>
          <p class="answer">{{ entry.text }}</p>
          <ul v-if="entry.actions.length" class="actions">
            <li v-for="action in entry.actions" :key="`${entry.id}-${action.code}-${action.label}`">
              <button type="button" :disabled="isApplied(entry, action)" @click="applyAction(entry, action)">
                {{ action.label }}<span v-if="action.reason"> — {{ action.reason }}</span>
              </button>
              <span v-for="done in entry.applied.filter((item) => item.label === action.label)" :key="done.result" class="applied">{{ done.result }}</span>
            </li>
          </ul>
          <p v-if="entry.rejected.length" class="rejected">Отклонено: {{ entry.rejected.join('; ') }}</p>
        </li>
        <li v-if="busy" class="entry pending" role="status">Помощник думает…</li>
      </ol>

      <p v-if="error" class="error-line" role="alert">{{ error }}</p>

      <label class="ask-label" for="assistant-question">Вопрос по сборке щита</label>
      <textarea
        id="assistant-question"
        v-model="question"
        rows="3"
        :disabled="busy"
        placeholder="Например: хватает ли резерва под расширение?"
        @keydown="onKeydown"
      ></textarea>
      <div class="ask-row">
        <span class="microcopy">Ctrl+Enter — отправить</span>
        <button v-if="busy" type="button" class="cancel" @click="cancel">Отменить</button>
        <button v-else type="button" :disabled="ready && !question.trim()" @click="ask">{{ ready ? 'Спросить' : 'Проверить прокси' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.assistant {
  border-top: 1px solid var(--line-soft);
  padding: 10px 14px 14px;
}

.assistant-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: 0;
  padding: 4px 0;
  font: inherit;
  font-weight: 600;
  color: var(--heading);
  cursor: pointer;
}

.badge {
  font:500 var(--text-xs)/1 var(--mono);
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--text-muted);
}

.badge.ready { color: var(--ok); border-color: var(--ok); background: var(--ok-soft); }
.badge.nokey { color: var(--warning); border-color: var(--warning); background: var(--warning-soft); }

.assistant-body { display: grid; gap: 10px; padding-top: 8px; }

.state-line { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
.state-line.off { color: var(--error); }
.state-line.nokey { color: var(--warning); }

.state-help {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
}

.state-help p { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
.state-help code { font:500 var(--text-xs)/1.4 var(--mono); background: var(--canvas); padding: 1px 5px; border-radius: 4px; }
.state-help .text-button { justify-self: start; }

.disclosure { border: 1px solid var(--line-soft); border-radius: 8px; padding: 8px 10px; }
.disclosure summary { cursor: pointer; font-size: var(--text-xs); color: var(--text-muted); }
.disclosure ul { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: var(--text-xs); color: var(--text-muted); }

.log { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-height: 320px; overflow-y: auto; }
.log:empty { display: none; }

.entry { border-left: 2px solid var(--line); padding-left: 10px; display: grid; gap: 6px; }
.entry.pending { color: var(--text-muted); font-size: var(--text-xs); }
.asked { margin: 0; font-size: var(--text-xs); color: var(--text-faint); }
.answer { margin: 0; font-size: var(--text-sm); white-space: pre-wrap; }

.actions { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.actions button {
  width: 100%;
  text-align: left;
  font: inherit;
  font-size: var(--text-xs);
  padding: 7px 9px;
  border: 1px solid var(--accent);
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--heading);
  cursor: pointer;
}
.actions button:disabled { border-color: var(--line); background: none; color: var(--text-faint); cursor: default; }

.rejected { margin: 0; font-size: var(--text-xs); color: var(--warning); }
.applied { display: block; font-size: var(--text-xs); color: var(--ok); }
.error-line { margin: 0; font-size: var(--text-xs); color: var(--error); }

.ask-label { font-size: var(--text-xs); color: var(--text-muted); }
textarea {
  width: 100%;
  font: inherit;
  font-size: var(--text-sm);
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text);
  resize: vertical;
}

.ask-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ask-row button {
  font: inherit;
  font-size: var(--text-xs);
  padding: 7px 12px;
  border: 0;
  border-radius: 7px;
  background: var(--service);
  color: var(--on-service);
  cursor: pointer;
}
.ask-row button:disabled { background: var(--line); cursor: default; }
.ask-row button.cancel { background: none; border: 1px solid var(--line); color: var(--text-muted); }
</style>
