<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getEnclosureMinimum, getFootprintModules, getFreeSlots, getRowCapacity, isDinDevice } from '../../domain/layout'
import { getPanelGeometry } from '../../domain/panelGeometry'
import { cabinetDefinitions, cabinetSpecLabel, railDefinitions } from '../../data/enclosures'
import { phaseBalance, validateProject } from '../../domain/validation'
import { useProjectStore } from '../../stores/project'
import DeviceVisual from '../catalog/DeviceVisual.vue'
import { getDeviceFaceMetrics } from '../catalog/deviceFace/metrics'
import AppSelect, { type AppSelectOption } from '../ui/AppSelect.vue'
import AssistantPanel from '../assistant/AssistantPanel.vue'
import { useConfirm } from '../../composables/useConfirm'
import { CONNECTION_THICKNESS_MM } from '../../domain/connectionSpec'
import type { Category, RailDefinition } from '../../domain/types'

const emit = defineEmits<{ focusCategory: [Category] }>()

/** The number input hands over `NaN` for an empty field; the range comes from the domain, not from here. */
const clampThickness = (value: number) => Number.isFinite(value)
  ? Math.min(CONNECTION_THICKNESS_MM.max, Math.max(CONNECTION_THICKNESS_MM.min, value))
  : CONNECTION_THICKNESS_MM.default

const PHASE_OPTIONS: AppSelectOption[] = [
  { value: '1', label: 'L1' },
  { value: '2', label: 'L2' },
  { value: '3', label: 'L3' },
]
const SUPPLY_PHASE_OPTIONS: AppSelectOption[] = [
  { value: '1', label: '1 фаза' },
  { value: '3', label: '3 фазы' },
]
const BUS_OPTIONS: AppSelectOption[] = [
  { value: 'L', label: 'L · фаза' },
  { value: 'N', label: 'N · нейтраль' },
  { value: 'PE', label: 'PE · земля' },
]

const store = useProjectStore()
const { confirm } = useConfirm()
const { currentProject, selectedDevice, selectedProduct, definitions, cabinetMigration } = storeToRefs(store)
const migrationDialog = ref<HTMLDialogElement | null>(null)
const metrics = computed(() => {
  const project = currentProject.value
  const map = definitions.value
  const minimum = getEnclosureMinimum(project, map)
  const balance = phaseBalance(project, map)
  return {
    minimum,
    free: getFreeSlots(project, map),
    capacity: getRowCapacity(project),
    balance,
    modules: project.devices.filter(isDinDevice).reduce((sum, item) => sum + getFootprintModules(item, map), 0),
  }
})
const cabinetOptions = computed<AppSelectOption[]>(() => cabinetDefinitions.map((cabinet) => ({
  value: cabinet.id,
  label: `${cabinet.name} · ${cabinetSpecLabel(cabinet)}`,
})))
const railOptions = computed<AppSelectOption[]>(() => {
  const selectedCabinet = cabinetDefinitions.find((item) => item.id === currentProject.value.settings.cabinetId)
  return railDefinitions.map((rail) => ({
    value: rail.id,
    label: `${rail.name} · 18 мм/модуль`,
    disabled: Boolean(selectedCabinet && selectedCabinet.railId !== rail.id),
  }))
})
const deviceOptions = computed<AppSelectOption[]>(() => currentProject.value.devices.map((device) => ({
  value: device.instanceId,
  label: `${device.address || 'Без адреса'} · ${definitions.value.get(device.productId)?.name ?? device.productId}`,
})))
const protectionOptions = (): AppSelectOption[] => protectionDevices.value.map((device) => ({
  value: device.instanceId,
  label: `${device.address} · ${definitions.value.get(device.productId)?.name ?? device.productId}`,
}))

const issues = computed(() => validateProject(currentProject.value, definitions.value))
const panelGeometry = computed(() => getPanelGeometry(currentProject.value, definitions.value))
const selectedPhysical = computed(() => {
  if (!selectedDevice.value || !selectedProduct.value) return null
  const productId = selectedDevice.value.productId
  return {
    modules: getFootprintModules(selectedDevice.value, definitions.value),
    widthMm: panelGeometry.value.deviceWidthMm(productId),
    heightMm: selectedProduct.value.height,
    depthMm: selectedProduct.value.depth,
  }
})
const selectedFrontView = computed(() => {
  if (!selectedProduct.value) return null
  const face = getDeviceFaceMetrics(selectedProduct.value)
  const scale = Math.min(180 / face.heightMm, 220 / face.widthMm)
  return {
    width: Math.round(face.widthMm * scale),
    height: Math.round(face.heightMm * scale),
    widthMm: Math.round(face.widthMm * 10) / 10,
  }
})
const errorCount = computed(() => issues.value.filter((item) => item.level === 'error').length)
const warningCount = computed(() => issues.value.filter((item) => item.level === 'warning').length)
const statusLabel = computed(() => errorCount.value
  ? `Ошибки: ${errorCount.value}`
  : warningCount.value
    ? `Предупреждения: ${warningCount.value}`
    : 'Проверки выполнены')
const statusClass = computed(() => errorCount.value ? 'status-error' : warningCount.value ? 'status-warning' : 'status-ok')
const protectionDevices = computed(() => currentProject.value.devices.filter((item) => ['MCB', 'RCCB', 'RCBO'].includes(definitions.value.get(item.productId)?.category ?? '')))
const connectionsFor = (circuitId: string) => currentProject.value.connections.filter((item) => item.circuitId === circuitId)
const busbars = computed(() => currentProject.value.devices.filter((item) => item.mount === 'busbar'))
const protectionTargets = computed(() => currentProject.value.devices.filter((item) => ['MCB', 'RCCB', 'RCBO'].includes(definitions.value.get(item.productId)?.category ?? '')))
const busbarLinkExists = (busbarId: string, deviceId: string) =>
  currentProject.value.connections.some((connection) => connection.kind === 'busbar' && connection.fromDeviceId === busbarId && connection.toDeviceId === deviceId)
const removeCircuit = async (id: string, circuitName: string) => {
  if (await confirm({
    title: 'Удалить цепь?',
    description: `Цепь «${circuitName}» и все её подключения будут удалены из щита. Действие можно отменить через Ctrl+Z.`,
    confirmLabel: 'Удалить цепь',
    danger: true,
  })) store.deleteCircuit(id)
}
const removeConnection = async (id: string, circuitName: string) => {
  if (await confirm({
    title: 'Удалить подключение?',
    description: `Подключение к цепи «${circuitName}» будет удалено.`,
    confirmLabel: 'Удалить подключение',
    danger: true,
  })) store.deleteConnection(id)
}
const removeSelected = async () => {
  if (!selectedDevice.value) return
  const name = selectedDevice.value.address || selectedDevice.value.instanceId
  if (await confirm({
    title: 'Удалить устройство?',
    description: `Устройство «${name}» и все его подключения будут удалены из щита. Действие можно отменить через Ctrl+Z.`,
    confirmLabel: 'Удалить устройство',
    danger: true,
  })) store.deleteSelected()
}

const changeSelectedQuantity = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (!store.updateSelected({ quantity: input.valueAsNumber })) input.value = String(selectedDevice.value?.quantity ?? 1)
}
const changeCircuitNumber = (id: string, key: 'current' | 'power' | 'wireCrossSection', event: Event) => {
  const input = event.target as HTMLInputElement
  if (!store.updateCircuit(id, { [key]: input.valueAsNumber })) {
    const circuit = currentProject.value.circuits.find((item) => item.id === id)
    input.value = String(circuit?.[key] ?? 0)
  }
}
const changeSettingNumber = (key: 'inputCurrent' | 'reserveModules', event: Event) => {
  const input = event.target as HTMLInputElement
  if (!store.updateSettings({ [key]: input.valueAsNumber })) input.value = String(currentProject.value.settings[key])
}

watch(cabinetMigration, async (plan) => {
  await nextTick()
  const dialog = migrationDialog.value
  if (!dialog) return
  if (plan && !dialog.open) dialog.showModal()
  if (!plan && dialog.open) dialog.close()
})
const cancelMigration = () => {
  store.cancelCabinetMigration()
  migrationDialog.value?.close()
}
const confirmMigration = () => {
  if (store.commitCabinetMigration()) migrationDialog.value?.close()
}
const migrationTargetName = computed(() => {
  const plan = cabinetMigration.value
  if (!plan) return ''
  const cabinet = cabinetDefinitions.find((item) => item.id === plan.target.cabinetId)
  const rail = railDefinitions.find((item) => item.id === plan.target.railId)
  return `${cabinet?.name ?? plan.target.cabinetId}; ${rail?.name ?? plan.target.railId}`
})
const migrationIssueLabel = (code: string) => ({
  'invalid-target': 'Несовместимая цель',
  'invalid-row': 'Неверный ряд',
  'width-overflow': 'Не помещается по ширине',
  overlap: 'Наложение',
  'missing-product': 'Нет товара',
}[code] ?? code)
</script>

<template>
  <aside class="inspector-panel" aria-label="Свойства и проверка">
    <div class="panel-heading">
      <div><span class="eyebrow">Параметры</span><h2>Инспектор</h2></div>
      <span class="status-chip" :class="statusClass"><i></i>{{ statusLabel }}</span>
    </div>

    <section class="inspector-section selection-section">
      <div class="section-title"><h3>Выбранное устройство</h3><span class="mono">{{ selectedDevice?.address || '—' }}</span></div>
      <template v-if="selectedDevice && selectedProduct">
        <div class="selected-product"><div class="product-monogram">{{ selectedProduct.brand.slice(0, 2).toUpperCase() }}</div><div><strong>{{ selectedProduct.name }}</strong><small>{{ selectedProduct.brand }} · {{ selectedProduct.sku }}</small></div></div>
        <figure v-if="selectedFrontView" class="selected-front-view" data-front-view><DeviceVisual :product="selectedProduct" :width="selectedFrontView.width" :height="selectedFrontView.height" /><figcaption>фронтальный вид · {{ selectedFrontView.widthMm }} мм</figcaption></figure>
        <div class="form-grid compact-form">
          <label>Позиция<input :value="selectedDevice.row + 1 + ' ряд / ' + (selectedDevice.slot + 1)" disabled /></label>
          <label>Адрес<input :value="selectedDevice.address" @change="store.updateSelected({ address: ($event.target as HTMLInputElement).value })" /></label>
          <label>Маркировка<input :value="selectedDevice.marking || selectedDevice.address" placeholder="Например, QF01" @change="store.updateSelected({ marking: ($event.target as HTMLInputElement).value })" /></label>
          <label>Количество<input :value="selectedDevice.quantity" type="number" min="1" max="99" @change="changeSelectedQuantity" /></label>
          <label v-if="selectedPhysical">Физический footprint<input :value="`${selectedPhysical.modules} мод. · ${selectedPhysical.widthMm} мм`" disabled /></label>
          <label v-if="selectedPhysical">Габариты<input :value="`${selectedPhysical.widthMm} × ${selectedPhysical.heightMm} × ${selectedPhysical.depthMm} мм`" disabled /></label>
          <label>Фаза<AppSelect label="Фаза" :model-value="String(selectedDevice.phase)" :options="PHASE_OPTIONS" @update:model-value="store.updateSelected({ phase: Number($event) as 1 | 2 | 3 })" /></label>
          <label class="wide">Примечание<input :value="selectedDevice.note" placeholder="Нагрузка, помещение, кабель" @change="store.updateSelected({ note: ($event.target as HTMLInputElement).value })" /></label>
        </div>
        <div class="button-row">
          <button @click="store.moveSelected(selectedDevice.row, selectedDevice.slot + getFootprintModules(selectedDevice, definitions))">Сдвинуть →</button>
          <button @click="store.compactSelectedRow">Уплотнить ряд</button>
          <button @click="store.duplicateSelected">Дублировать</button>
          <button class="danger" aria-label="Удалить устройство" @click="removeSelected">Удалить</button>
        </div>
      </template>
      <div v-else class="inspector-empty"><span>↖</span><p>Выберите аппарат на DIN-рейке, чтобы изменить его параметры.</p></div>
    </section>

    <section class="inspector-section" aria-labelledby="busbar-title">
      <div class="section-title"><h3 id="busbar-title">Соединительные шины</h3><span class="mono">{{ busbars.length }}</span></div>
      <p class="microcopy">FORK подключается к аппаратам шинами. Защитный прибор получает связь с шиной сразу при добавлении; остальные приборы соединяются кнопкой ＋ — без дублей.</p>
      <div v-for="busbar in busbars" :key="busbar.instanceId" class="connection-card">
        <div class="connection-card-head"><strong>{{ definitions.get(busbar.productId)?.name }}</strong><span class="mono">{{ busbar.address }}</span></div>
        <div v-for="target in protectionTargets" :key="target.instanceId" class="busbar-link">
          <span>{{ target.address || 'Без адреса' }} · {{ definitions.get(target.productId)?.name }}</span>
          <button class="text-button" :disabled="busbarLinkExists(busbar.instanceId, target.instanceId)" :aria-label="busbarLinkExists(busbar.instanceId, target.instanceId) ? `Шина ${busbar.address} уже соединена с ${target.address || 'устройством без адреса'}` : `Соединить шину ${busbar.address} с ${target.address || 'устройством без адреса'}`" @click="store.addBusbarConnection(busbar.instanceId, target.instanceId)">{{ busbarLinkExists(busbar.instanceId, target.instanceId) ? '✓' : '＋' }}</button>
        </div>
      </div>
      <p v-if="!busbars.length" class="connection-empty">Добавьте FORK из каталога «Шины».</p>
    </section>

    <section class="inspector-section circuits-section">
      <div class="section-title"><h3>Цепи и подключения</h3><button class="text-button" :disabled="!currentProject.devices.length" @click="store.addCircuit()">＋ Цепь</button></div>
      <p class="microcopy">Цепь связывает выбранное устройство с защитным аппаратом. Нагрузка и баланс фаз считаются по цепям.</p>
      <div v-for="circuit in currentProject.circuits" :key="circuit.id" class="circuit-card">
        <div class="circuit-card-head"><strong>{{ circuit.name }}</strong><button class="icon-button danger" :aria-label="`Удалить цепь ${circuit.name}`" @click="removeCircuit(circuit.id, circuit.name)">×</button></div>
        <div class="form-grid compact-form">
          <label>Название<input :value="circuit.name" @change="store.updateCircuit(circuit.id, { name: ($event.target as HTMLInputElement).value })" /></label>
          <label>Нагрузка<input :value="circuit.loadName" @change="store.updateCircuit(circuit.id, { loadName: ($event.target as HTMLInputElement).value })" /></label>
          <label>Ток, А<input :value="circuit.current" type="number" min="0" step="0.1" @change="changeCircuitNumber(circuit.id, 'current', $event)" /></label>
          <label>Мощность, Вт<input :value="circuit.power" type="number" min="0" step="1" @change="changeCircuitNumber(circuit.id, 'power', $event)" /></label>
          <label>Фаза<AppSelect label="Фаза" :model-value="String(circuit.phase)" :options="PHASE_OPTIONS" @update:model-value="store.updateCircuit(circuit.id, { phase: Number($event) as 1 | 2 | 3 })" /></label>
          <label>Защита<AppSelect label="Защита" :model-value="circuit.protectionDeviceId" :options="protectionOptions()" placeholder="Выберите аппарат" @update:model-value="store.updateCircuit(circuit.id, { protectionDeviceId: $event })" /></label>
          <label>Провод, мм²<input :value="circuit.wireCrossSection" type="number" min="0.5" step="0.5" @change="changeCircuitNumber(circuit.id, 'wireCrossSection', $event)" /></label>
          <label>Цвет<input :value="circuit.color" type="color" @change="store.updateCircuit(circuit.id, { color: ($event.target as HTMLInputElement).value })" /></label>
        </div>
        <div class="connection-heading"><span>Подключения <b>{{ connectionsFor(circuit.id).length }}</b></span><button class="text-button" :disabled="!currentProject.devices.length" @click="store.addConnection(circuit.id)">＋ Подключение</button></div>
        <div v-for="(connection, connectionIndex) in connectionsFor(circuit.id)" :key="connection.id" class="connection-card" :data-connection-id="connection.id">
          <div class="connection-card-head"><strong>Подключение {{ connectionIndex + 1 }}</strong><button class="icon-button danger" :aria-label="`Удалить подключение ${connectionIndex + 1} цепи ${circuit.name}`" @click="removeConnection(connection.id, circuit.name)">×</button></div>
          <div class="form-grid compact-form">
            <label>Шина<AppSelect label="Шина" :model-value="connection.fromBus" :options="BUS_OPTIONS" @update:model-value="store.updateConnection(connection.id, { fromBus: $event as 'L' | 'N' | 'PE' })" /></label>
            <label>Устройство<AppSelect label="Устройство" :model-value="connection.toDeviceId" :options="deviceOptions" placeholder="Выберите аппарат" @update:model-value="store.updateConnection(connection.id, { toDeviceId: $event })" /></label>
            <label>Цвет<input :value="connection.color" type="color" @change="store.updateConnection(connection.id, { color: ($event.target as HTMLInputElement).value })" /></label>
            <label>Толщина<input :value="connection.thickness" type="number" :min="CONNECTION_THICKNESS_MM.min" :max="CONNECTION_THICKNESS_MM.max" :step="CONNECTION_THICKNESS_MM.step" @change="store.updateConnection(connection.id, { thickness: clampThickness(Number(($event.target as HTMLInputElement).value)) })" /></label>
            <label class="wide">Подпись<input :value="connection.label" placeholder="Например, L1 → QF01" @change="store.updateConnection(connection.id, { label: ($event.target as HTMLInputElement).value })" /></label>
          </div>
        </div>
        <p v-if="!connectionsFor(circuit.id).length" class="connection-empty">Подключение не задано.</p>
      </div>
      <div v-if="!currentProject.circuits.length" class="inspector-empty compact-empty"><span>⌁</span><p>Цепи появятся здесь после выбора защитного устройства.</p></div>
    </section>

    <section class="inspector-section">
      <div class="section-title"><h3>Параметры панели</h3><span class="mono">профиль</span></div>
      <div class="form-grid compact-form">
        <label class="wide">Корпус<AppSelect label="Корпус" :model-value="currentProject.settings.cabinetId || ''" :options="cabinetOptions" placeholder="Выберите корпус" @update:model-value="store.stageCabinetMigration($event)" /></label>
        <label class="wide">Рейка<AppSelect label="Рейка" :model-value="currentProject.settings.railId || ''" :options="railOptions" :disabled="!currentProject.settings.cabinetId" placeholder="Выберите рейку" @update:model-value="store.stageRailMigration($event as RailDefinition['id'])" /></label>
        <label>Фаза<AppSelect label="Фаза" :model-value="String(currentProject.settings.phase)" :options="SUPPLY_PHASE_OPTIONS" @update:model-value="store.updateSettings({ phase: Number($event) as 1 | 3 })" /></label>
        <label>Вводной ток, А<input :value="currentProject.settings.inputCurrent" type="number" min="1" max="1000" @change="changeSettingNumber('inputCurrent', $event)" /></label>
        <label>Габариты, мм<input :value="`${currentProject.settings.enclosureWidth} × ${currentProject.settings.enclosureHeight} × ${currentProject.settings.enclosureDepth}`" disabled /></label>
        <label>Рядов<input :value="currentProject.settings.rows" disabled /></label>
        <label>Резерв, мод.<input :value="currentProject.settings.reserveModules" type="number" min="0" @change="changeSettingNumber('reserveModules', $event)" /></label>
      </div>
      <p class="microcopy">Каталоговая модель: {{ panelGeometry.capacity }} модулей в ряду, шаг {{ panelGeometry.modulePitchMm }} мм{{ panelGeometry.legacy ? ' · legacy fallback' : '' }}. Числовые размеры корпуса и профиль рейки предварительные.</p>
    </section>

    <section class="inspector-section metrics-section">
      <div class="section-title"><h3>Расчётная геометрия</h3><span class="mono">предварительно</span></div>
      <div class="metric-grid">
        <div><span>Минимум корпуса</span><strong>{{ metrics.minimum.width }} × {{ metrics.minimum.height }}<small> мм</small></strong></div>
        <div><span>Свободно</span><strong>{{ metrics.free }}<small> мод.</small></strong></div>
        <div><span>Заполнено</span><strong>{{ metrics.modules }} / {{ metrics.capacity * currentProject.settings.rows }}<small> мод.</small></strong></div>
        <div><span>Разброс фаз</span><strong>{{ metrics.balance.spread }}<small> %</small></strong></div>
      </div>
      <div class="phase-bar" role="img" :aria-label="`Нагрузка фаз: ${metrics.balance.totals.join(', ')} ампер`"><i v-for="(value, index) in metrics.balance.totals" :key="index" :class="`phase-${index}`" :style="{ flex: Math.max(1, value) }"></i></div>
      <p class="microcopy">Расчёт предварительный. Нормативное соответствие не подтверждается.</p>
    </section>

    <section class="inspector-section issues-section">
      <div class="section-title"><h3>Проверки</h3><span class="mono">{{ issues.length }}</span></div>
      <ul class="issue-list">
        <li v-for="issue in issues" :key="issue.id" :class="`issue-${issue.level}`"><span class="issue-symbol">{{ issue.level === 'error' ? '×' : issue.level === 'warning' ? '!' : 'i' }}</span><span><strong>{{ issue.title }}</strong><small>{{ issue.message }}</small></span></li>
      </ul>
    </section>

    <Teleport to="body">
    <dialog ref="migrationDialog" class="migration-dialog" aria-labelledby="migration-title" aria-describedby="migration-description" @cancel.prevent="cancelMigration">
      <template v-if="cabinetMigration">
        <div class="migration-dialog-head">
          <div><span class="eyebrow">Безопасная миграция</span><h2 id="migration-title">Подтвердите изменение корпуса</h2></div>
          <button class="icon-button" type="button" aria-label="Закрыть без миграции" @click="cancelMigration">×</button>
        </div>
        <p id="migration-description">Проект не изменится, пока вы явно не подтвердите миграцию. Устройства не удаляются; позиции ниже будут перенесены только после подтверждения.</p>
        <div class="migration-target"><span>Цель</span><strong>{{ migrationTargetName }}</strong><small>{{ cabinetMigration.target.rows }} ряд., {{ cabinetMigration.target.capacity }} мод./ряд · {{ cabinetMigration.target.width }} × {{ cabinetMigration.target.height }} × {{ cabinetMigration.target.depth }} мм</small></div>
        <section v-if="cabinetMigration.issues.length" class="migration-block" aria-labelledby="migration-issues-title">
          <h3 id="migration-issues-title">Обнаружено в текущем проекте</h3>
          <ul><li v-for="(issue, index) in cabinetMigration.issues" :key="`${issue.code}-${issue.instanceId ?? 'project'}-${index}`"><strong>{{ migrationIssueLabel(issue.code) }}</strong><span>{{ issue.message }}</span></li></ul>
        </section>
        <section class="migration-block" aria-labelledby="migration-positions-title">
          <h3 id="migration-positions-title">Изменится {{ cabinetMigration.affectedPositions.length }} позиций</h3>
          <ul v-if="cabinetMigration.affectedPositions.length" class="migration-positions">
            <li v-for="position in cabinetMigration.affectedPositions" :key="position.instanceId"><span><strong>{{ position.address || position.instanceId }}</strong> · {{ position.productName }}<small v-if="position.footprintModules">{{ position.footprintModules }} мод.</small></span><span class="mono">{{ position.from.row + 1 }}.{{ position.from.slot + 1 }} → {{ position.to.row + 1 }}.{{ position.to.slot + 1 }}</span></li>
          </ul>
          <p v-else class="connection-empty">Физические позиции устройств не изменятся.</p>
        </section>
        <p v-if="!cabinetMigration.canApply" class="migration-blocked" role="alert">Миграция заблокирована. Устраните блокирующие проблемы; устройства останутся в проекте.</p>
        <div class="migration-actions">
          <button type="button" @click="cancelMigration">Отмена</button>
          <button type="button" class="primary-button" :disabled="!cabinetMigration.canApply" @click="confirmMigration">Подтвердить миграцию</button>
        </div>
      </template>
    </dialog>
    </Teleport>

    <AssistantPanel @focus-category="emit('focusCategory', $event)" />
  </aside>
</template>
