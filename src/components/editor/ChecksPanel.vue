<script setup lang="ts">
import { computed } from 'vue'
import { formatAmps } from '../../domain/electrical'
import { storeToRefs } from 'pinia'
import { phaseBalance, validateProject } from '../../domain/validation'
import { useProjectStore } from '../../stores/project'

const emit = defineEmits<{ 'goto-board': [] }>()

const store = useProjectStore()
const { currentProject, definitions } = storeToRefs(store)

const issues = computed(() => validateProject(currentProject.value, definitions.value))
const balance = computed(() => phaseBalance(currentProject.value, definitions.value))
const errorCount = computed(() => issues.value.filter((issue) => issue.level === 'error').length)
const warningCount = computed(() => issues.value.filter((issue) => issue.level === 'warning').length)
const infoCount = computed(() => issues.value.filter((issue) => issue.level === 'info').length)
const headline = computed(() => errorCount.value
  ? `Ошибки: ${errorCount.value}`
  : warningCount.value
    ? `Предупреждения: ${warningCount.value}`
    : 'Проверки выполнены')
const activePhases = computed(() => currentProject.value.settings.phase === 1 ? [0] : [0, 1, 2])

/** Selects the device an issue points at and hands the board focus back to the caller. */
const focusIssueDevice = (deviceId?: string) => {
  if (!deviceId) return
  store.selectedDeviceId = deviceId
  emit('goto-board')
}
</script>

<template>
  <section class="checks-panel" aria-labelledby="checks-title" data-checks-panel>
    <div class="panel-heading">
      <div><span class="eyebrow">Диагностика</span><h3 id="checks-title">Проверки щита</h3></div>
      <span class="mono count" :class="{ 'count-error': errorCount, 'count-warning': !errorCount && warningCount }">{{ issues.length }}</span>
    </div>

    <div class="checks-summary" :class="{ ok: !errorCount && !warningCount }" role="status">
      <strong>{{ headline }}</strong>
      <span v-if="infoCount">Инфо: {{ infoCount }}</span>
      <span v-if="!issues.length">Замечаний нет — конфигурация проходит все правила.</span>
    </div>

    <div class="checks-phase">
      <h4>Баланс фаз</h4>
      <div class="phase-bar" role="img" :aria-label="`Нагрузка фаз: ${balance.totals.map(formatAmps).join(', ')} ампер`"><i v-for="(value, index) in balance.totals" :key="index" :class="`phase-${index}`" :style="{ flex: Math.max(1, value) }"></i></div>
      <dl>
        <div v-for="index in activePhases" :key="index">
          <dt>{{ currentProject.settings.phase === 1 ? 'Нагрузка' : `Фаза L${index + 1}` }}</dt>
          <dd class="mono">{{ formatAmps(balance.totals[index]) }} А</dd>
        </div>
        <!-- Разброс имеет смысл только когда есть что сравнивать: в однофазном щите он
             всегда 0 % и только спорит с собственными числами рядом. -->
        <div v-if="currentProject.settings.phase === 3">
          <dt>Разброс</dt>
          <dd class="mono">{{ balance.spread }} %</dd>
        </div>
      </dl>
    </div>

    <ul v-if="issues.length" class="issue-list checks-issue-list">
      <li v-for="issue in issues" :key="issue.id" :class="`issue-${issue.level}`">
        <span class="issue-symbol">{{ issue.level === 'error' ? '×' : issue.level === 'warning' ? '!' : 'i' }}</span>
        <span><strong>{{ issue.title }}</strong><small>{{ issue.message }}</small></span>
        <button v-if="issue.deviceId" type="button" class="issue-goto" :aria-label="`${issue.title}: показать устройство на схеме`" @click="focusIssueDevice(issue.deviceId)">на схему →</button>
      </li>
    </ul>
  </section>
</template>
