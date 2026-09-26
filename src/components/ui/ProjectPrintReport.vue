<script setup lang="ts">
import { computed } from 'vue'
import { getFootprintModules, getFreeSlots, getRowCapacity, getRowUsage, isDinDevice, resolveLayout } from '../../domain/layout'
import { buildBom } from '../../domain/pricing'
import { CATALOG_REVISION, PROJECT_SCHEMA_VERSION, VALIDATION_REVISION } from '../../domain/projectSchema'
import { validateProject } from '../../domain/validation'
import type { DeviceDefinition, PanelProject } from '../../domain/types'

const props = defineProps<{
  project: PanelProject
  definitions: Map<string, DeviceDefinition>
  title?: string
  generatedAt?: string
}>()

const printedAt = computed(() => props.generatedAt || new Date().toISOString())
const layout = computed(() => resolveLayout(props.project))
const lines = computed(() => buildBom(props.project.devices, props.definitions))
const issues = computed(() => validateProject(props.project, props.definitions))
// The summary must count modules exactly the way the per-row table does, so a
// missing product or a fractional import width cannot make the two disagree.
const modules = computed(() => props.project.devices.filter(isDinDevice).reduce((sum, device) => sum + getFootprintModules(device, props.definitions), 0))
const capacity = computed(() => getRowCapacity(props.project) * props.project.settings.rows)
const rows = computed(() => Array.from({ length: props.project.settings.rows }, (_, index) => index))
const productFor = (productId: string) => props.definitions.get(productId)
const verificationLabel = (status: DeviceDefinition['verificationStatus']) => status === 'verified' ? 'подтверждено' : status === 'template' ? 'шаблон' : 'старые данные'
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
            <td>{{ project.devices.filter((device) => device.row === row).map((device) => device.marking || device.address).join(', ') || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="print-marking">
      <h2>Нижняя маркировка</h2>
      <table>
        <thead><tr><th>Поз.</th><th>Изделие</th><th>Серия / артикул</th><th>Адрес</th><th>Проверка / источник</th></tr></thead>
        <tbody>
          <tr v-for="device in project.devices.filter(isDinDevice)" :key="device.instanceId">
            <td>{{ device.row + 1 }}.{{ device.slot + 1 }}</td>
            <td>{{ productFor(device.productId)?.name || 'Неизвестное изделие' }}</td>
            <td>{{ productFor(device.productId)?.series || productFor(device.productId)?.sku || '—' }}</td>
            <td>{{ device.marking || device.address }}</td>
            <td>{{ verificationLabel(productFor(device.productId)?.verificationStatus) }}<template v-if="productFor(device.productId)?.sourceUrl"> · источник указан в каталоге</template></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="print-connections">
      <h2>Соединения и ПУГВ</h2>
      <p v-if="!project.connections.length">Подключения не заданы.</p>
      <ol>
        <li v-for="connection in project.connections" :key="connection.id">
          <strong>{{ connection.label || 'Без подписи' }}</strong>
          <span>{{ connection.kind === 'busbar' ? 'FORK-шина' : `${connection.fromBus} → ${project.devices.find((device) => device.instanceId === connection.toDeviceId)?.address || 'устройство'}` }} · ПУГВ · {{ connection.color }} · {{ connection.thickness }} мм</span>
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
            <td>{{ verificationLabel(productFor(line.productId)?.verificationStatus) }}<template v-if="productFor(line.productId)?.sourceUrl"> · источник указан</template></td>
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
