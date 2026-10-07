<script setup lang="ts">
import { computed } from 'vue'
import { getFootprintModules, getFreeSlots, getRowCapacity, getRowUsage, isDinDevice, resolveLayout } from '../../domain/layout'
import { buildBom } from '../../domain/pricing'
import { CATALOG_REVISION, PROJECT_SCHEMA_VERSION, VALIDATION_REVISION } from '../../domain/projectSchema'
import { validateProject } from '../../domain/validation'
import SingleLineDiagram from './SingleLineDiagram.vue'
import { claimsASource, verificationLabel as verificationLabelFor } from '../../domain/provenance'
import { buildLabelSheet, labelSheetWarning, labelTextFor } from '../../domain/labelSheet'
import type { Connection, DeviceDefinition, PanelProject, VerificationStatus } from '../../domain/types'

const props = defineProps<{
  project: PanelProject
  definitions: Map<string, DeviceDefinition>
  title?: string
  generatedAt?: string
}>()

const printedAt = computed(() => props.generatedAt || new Date().toISOString())
const layout = computed(() => resolveLayout(props.project))
const lines = computed(() => buildBom(props.project.devices, props.definitions))
/** Address lookup for the connection list, so a large report does not rescan the board per wire. */
const addressByInstanceId = computed(() => new Map(props.project.devices.map((device) => [device.instanceId, device.address])))

/**
 * Where a wire comes from, in the words the report uses elsewhere.
 *
 * Every run from a fork was printed as "FORK-шина" whatever fed it, and a feed from the panel bus
 * was printed as a bare bus letter with no source at all. On a sheet somebody builds from, "откуда
 * этот провод" is the first question asked of it.
 */
const wireSource = (connection: Connection): string => {
  if (connection.kind === 'bus') return `шина ${connection.fromBus}`
  if (connection.kind === 'busbar') {
    return connection.fromDeviceId
      ? addressByInstanceId.value.get(connection.fromDeviceId) || 'FORK-шина'
      : 'FORK-шина'
  }
  return `шина ${connection.fromBus}`
}

/** The terminal a wire enters, when the panel does not decide it by itself. */
const wireTerminal = (connection: Connection) => (connection.terminal === undefined ? '' : `зажим ${connection.terminal + 1}`)
const issues = computed(() => validateProject(props.project, props.definitions))
const labelSheet = computed(() => buildLabelSheet(props.project, props.definitions))
const labelsById = computed(() => new Map(labelSheet.value.labels.map((label) => [label.instanceId, label])))
const markingFor = (device: PanelProject['devices'][number]) => labelsById.value.get(device.instanceId)?.text ?? labelTextFor(device, undefined)
const labelWarning = computed(() => labelSheetWarning(labelSheet.value))
// The summary must count modules exactly the way the per-row table does, so a
// missing product or a fractional import width cannot make the two disagree.
const modules = computed(() => props.project.devices.filter(isDinDevice).reduce((sum, device) => sum + getFootprintModules(device, props.definitions), 0))
const capacity = computed(() => getRowCapacity(props.project) * props.project.settings.rows)
const rows = computed(() => Array.from({ length: props.project.settings.rows }, (_, index) => index))
const productFor = (productId: string) => props.definitions.get(productId)
const verificationLabel = (status: VerificationStatus | undefined) => verificationLabelFor(status, { sentence: true })
</script>

<template>
  <article class="print-report" data-print-report :aria-label="`Печатный отчёт: ${title || project.name}`">
    <header class="print-report-head">
      <div>
        <span class="eyebrow">Панель 36 · предварительный отчёт</span>
        <h1>{{ title || project.name }}</h1>
        <p>{{ project.name }} · ID {{ project.id.slice(0, 8).toUpperCase() }} · пресет {{ project.preset }}</p>
        <p>Создан {{ new Date(project.createdAt).toLocaleString('ru-RU') }} · обновлён {{ new Date(project.updatedAt).toLocaleString('ru-RU') }}</p>
      </div>
      <time :datetime="printedAt">Напечатано {{ new Date(printedAt).toLocaleString('ru-RU') }}</time>
    </header>

    <section class="print-summary" aria-label="Идентификация и компоновка">
      <div><span>Корпус</span><strong>{{ layout.cabinet?.name || 'legacy-параметры' }}</strong></div>
      <div><span>Рейка</span><strong>{{ layout.rail?.name || '17,5 мм legacy' }}</strong></div>
      <div><span>Сеть</span><strong>{{ project.settings.phase === 1 ? '1 фаза' : '3 фазы' }} · {{ project.settings.inputCurrent }} А</strong></div>
      <div><span>Габарит</span><strong>{{ project.settings.enclosureWidth }} × {{ project.settings.enclosureHeight }} × {{ project.settings.enclosureDepth }} мм</strong></div>
      <div><span>Занято</span><strong>{{ modules }} мод.</strong></div>
      <div><span>Свободно</span><strong>{{ getFreeSlots(project, definitions) }} мод.</strong></div>
      <div><span>Ёмкость</span><strong>{{ capacity }} мод.</strong></div>
      <div><span>Модульный шаг</span><strong>{{ layout.modulePitchMm }} мм</strong></div>
    </section>

    <section class="print-single-line" aria-label="Однолинейная схема">
      <h2>Однолинейная схема</h2>
      <SingleLineDiagram :project="project" :definitions="definitions" />
    </section>

    <section class="print-rack-summary">
      <h2>Сводка 2D-компоновки</h2>
      <table>
        <thead><tr><th>Ряд</th><th>Занято</th><th>Ёмкость</th><th>Свободно</th><th>Состав</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row">
            <td>{{ row + 1 }}</td>
            <td>{{ getRowUsage(row, project, definitions).used }} мод.</td>
            <td>{{ getRowCapacity(project) }} мод.</td>
            <td>{{ getRowCapacity(project) - getRowUsage(row, project, definitions).used }} мод.</td>
            <td>{{ project.devices.filter((device) => device.row === row).map((device) => `${device.address || "без адреса"}${markingFor(device) !== device.address ? ` — ${markingFor(device)}` : ""}`).join(', ') || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="print-marking">
      <h2>Нижняя маркировка</h2>
      <table>
        <thead><tr><th>Поз.</th><th>Изделие</th><th>Серия / артикул</th><th>Адрес</th><th>Маркировка</th><th>Проверка / источник</th></tr></thead>
        <tbody>
          <tr v-for="device in project.devices.filter(isDinDevice)" :key="device.instanceId">
            <td>{{ device.row + 1 }}.{{ device.slot + 1 }}</td>
            <td>{{ productFor(device.productId)?.name || 'Неизвестное изделие' }}</td>
            <td>{{ productFor(device.productId)?.series || productFor(device.productId)?.sku || '—' }}</td>
            <td>{{ device.address || '—' }}</td>
            <td>{{ markingFor(device) || '—' }}</td>
            <td>{{ verificationLabel(productFor(device.productId)?.verificationStatus) }}<template v-if="claimsASource(productFor(device.productId)?.verificationStatus) && productFor(device.productId)?.sourceUrl"> · источник указан в каталоге</template></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="print-labels" aria-label="Лист маркировки">
      <h2>Лист маркировки</h2>
      <p class="print-labels-note">
        По одной этикетке на позицию, в порядке монтажа. Это лист для печати и вырезки, а не заказ:
        поставщик, цена и сроки здесь не указаны.
      </p>
      <p v-if="labelWarning" class="print-labels-warning">{{ labelWarning }}</p>
      <p v-if="!labelSheet.labels.length">На доске нет аппаратов — маркировать нечего.</p>
      <div v-else class="print-label-grid">
        <div
          v-for="label in labelSheet.labels"
          :key="label.instanceId"
          class="print-label"
          :class="{ 'is-unmarked': !label.marked, 'is-duplicated': label.duplicated }"
        >
          <span class="print-label-text">{{ label.text || '—' }}</span>
          <span class="print-label-address">{{ label.address || 'Без адреса' }}</span>
          <span class="print-label-meta">{{ label.position }} · {{ label.name }}</span>
          <span v-if="label.duplicated" class="print-label-flag">адрес повторяется</span>
          <span v-else-if="!label.marked" class="print-label-flag">адрес не проставлен</span>
        </div>
      </div>
    </section>

    <section class="print-connections">
      <h2>Соединения и ПУГВ</h2>
      <p v-if="!project.connections.length">Подключения не заданы.</p>
      <ol>
        <li v-for="connection in project.connections" :key="connection.id">
          <strong>{{ connection.label || 'Без подписи' }}</strong>
          <span>{{ wireSource(connection) }} → {{ addressByInstanceId.get(connection.toDeviceId) || 'устройство' }}{{ wireTerminal(connection) ? `, ${wireTerminal(connection)}` : '' }} · ПУГВ · {{ connection.color }} · {{ connection.thickness }} мм</span>
        </li>
      </ol>
    </section>

    <section class="print-bom">
      <h2>Спецификация</h2>
      <table>
        <thead><tr><th>Категория / наименование</th><th>Бренд</th><th>Артикул</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Проверка / источник</th></tr></thead>
        <tbody>
          <tr v-for="line in lines" :key="line.productId">
            <td><strong>{{ line.name }}</strong><small>{{ line.category }}</small></td>
            <td>{{ line.brand }}</td>
            <td>{{ line.sku }}</td>
            <td>{{ line.quantity }}</td>
            <td>{{ line.priceKnown ? `${line.unitPrice.toLocaleString('ru-RU')} ₽` : '«уточняется»' }}</td>
            <td>{{ line.priceKnown ? `${line.total.toLocaleString('ru-RU')} ₽` : '«уточняется»' }}</td>
            <td>{{ verificationLabel(productFor(line.productId)?.verificationStatus) }}<template v-if="claimsASource(productFor(line.productId)?.verificationStatus) && productFor(line.productId)?.sourceUrl"> · источник указан</template></td>
          </tr>
        </tbody>
      </table>
      <p v-if="lines.some((line) => !line.priceKnown)" class="print-price-note">Коммерческая сумма не рассчитана: для части позиций цена неизвестна. Значение «уточняется» не является нулём.</p>
    </section>

    <section class="print-issues">
      <h2>Диагностика и проверки</h2>
      <p v-if="!issues.length">Автоматические замечания не найдены.</p>
      <ol>
        <li v-for="issue in issues" :key="issue.id" :class="`print-issue-${issue.level}`">
          <strong>{{ issue.title }} · {{ issue.ruleCode }} v{{ issue.ruleVersion }}</strong>
          <span>{{ issue.message }}</span>
        </li>
      </ol>
    </section>

    <footer class="print-revisions">
      <p><b>Редакции:</b> схема проекта {{ project.schemaVersion || PROJECT_SCHEMA_VERSION }} (поддерживается {{ PROJECT_SCHEMA_VERSION }}), каталог {{ CATALOG_REVISION }}, проверки {{ VALIDATION_REVISION }}.</p>
      <p class="print-disclaimer">Расчёты компоновки, проверки и цены предварительные и не являются проектной документацией, сметой или публичной офертой. До применения проверьте схему, паспорта изделий, источники, нагрузки и действующие требования у квалифицированного специалиста.</p>
    </footer>
  </article>
</template>

<style scoped>
.print-label { min-width: 0; }
.print-label-text, .print-label-address { overflow-wrap: anywhere; white-space: pre-wrap; }
.print-label-address { font: 600 8pt var(--mono); }
</style>
