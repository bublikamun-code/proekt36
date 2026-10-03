<script setup lang="ts">
import { computed, ref } from 'vue'
import DeviceVisual from '../components/catalog/DeviceVisual.vue'
import ProjectPrintReport from '../components/ui/ProjectPrintReport.vue'
import { demoProject } from '../data/demoProject'
import { workspaceCatalog } from '../data/catalog'
import { getEnclosureMinimum, getFreeSlots, getRowUsage, getProductFootprintModules, resolveLayout } from '../domain/layout'
import { getPanelGeometry } from '../domain/panelGeometry'
import { buildBom } from '../domain/pricing'
import { verificationLabel as verificationLabelFor } from '../domain/provenance'
import { phaseBalance } from '../domain/electrical'
import { validateProject } from '../domain/validation'
import type { DeviceDefinition, PlacedDevice } from '../domain/types'

const definitions = new Map<string, DeviceDefinition>(workspaceCatalog.map((product) => [product.id, product]))
const activeTab = ref<'2d' | 'bom' | 'checks' | 'circuits'>('2d')
const selectedId = ref(demoProject.devices[0]?.instanceId || '')
const zoom = ref(1)

const layout = computed(() => resolveLayout(demoProject))
const geometry = computed(() => getPanelGeometry(demoProject, definitions))
const capacity = computed(() => geometry.value.capacity)
const freeSlots = computed(() => getFreeSlots(demoProject, definitions))
const minimum = computed(() => getEnclosureMinimum(demoProject, definitions))
const rows = computed(() => Array.from({ length: demoProject.settings.rows }, (_, index) => index))
const rowUsage = computed(() => rows.value.map((row) => getRowUsage(row, demoProject, definitions)))
const requiredModules = computed(() => rowUsage.value.reduce((sum, row) => sum + row.used, 0))
const bom = computed(() => buildBom(demoProject.devices, definitions))
const issues = computed(() => validateProject(demoProject, definitions))
const phase = computed(() => phaseBalance(demoProject, definitions))
const selected = computed(() => demoProject.devices.find((device) => device.instanceId === selectedId.value) || demoProject.devices[0])
const selectedDefinition = computed(() => selected.value ? definitions.get(selected.value.productId) : undefined)
const selectedPosition = computed(() => selected.value ? `Ряд ${selected.value.row + 1} · модуль ${selected.value.slot + 1}` : '—')
const criticalIssues = computed(() => issues.value.filter((issue) => issue.level !== 'info'))
const tabs = [
  { id: '2d' as const, label: '2D схема' },
  { id: 'bom' as const, label: 'BOM' },
  { id: 'checks' as const, label: 'Проверки' },
  { id: 'circuits' as const, label: 'Цепи' },
]

const devicesInRow = (row: number) => demoProject.devices.filter((device) => device.row === row).sort((a, b) => a.slot - b.slot)
const productFor = (device: PlacedDevice) => definitions.get(device.productId)
const widthFor = (device: PlacedDevice) => productFor(device) ? getProductFootprintModules(productFor(device)!) : 1
const slotOccupied = (row: number, slot: number) => devicesInRow(row).some((device) => {
  const start = device.slot
  return slot >= start && slot < start + widthFor(device)
})
const demoRowStyle = (row: number) => ({ height: `${geometry.value.rowHeightsPx[row] ?? geometry.value.rowHeightsPx[0] ?? 0}px`, marginLeft: `${geometry.value.railStartXPx}px`, width: `${geometry.value.railWidthPx}px` })
const demoRailStyle = (row: number) => ({
  top: `${geometry.value.railOffsetPx(row)}px`,
  width: `${geometry.value.railWidthPx}px`,
  height: `${geometry.value.railHeightPx}px`,
})
const demoRowNumberStyle = () => ({ left: `${-geometry.value.railStartXPx}px` })
const demoDeviceStyle = (device: PlacedDevice) => ({
  left: `${device.slot * geometry.value.moduleWidthPx}px`,
  top: `${geometry.value.deviceOnRailOffsetPx(device.row, device.productId)}px`,
  width: `${geometry.value.deviceWidthPx(device.productId)}px`,
  height: `${geometry.value.deviceHeightPx(device.productId)}px`,
})
const demoSlotStyle = (slot: number) => ({ left: `${slot * geometry.value.moduleWidthPx}px`, width: `${geometry.value.moduleWidthPx}px` })
const pitchLabel = computed(() => geometry.value.legacy ? `${geometry.value.modulePitchMm} мм · legacy` : `${geometry.value.modulePitchMm} мм`)
const changeZoom = (delta: number) => {
  zoom.value = Math.min(1.4, Math.max(0.7, Number((zoom.value + delta).toFixed(1))))
}
const resetZoom = () => { zoom.value = 1 }
const printDemo = () => requestAnimationFrame(() => window.print())
const setTab = (tab: typeof tabs[number]['id']) => { activeTab.value = tab }
const onTabKeydown = (event: KeyboardEvent, index: number) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  setTab(tabs[next].id)
  document.querySelector<HTMLButtonElement>(`[data-demo-tab="${tabs[next].id}"]`)?.focus()
}
const verificationLabel = (productId: string) => verificationLabelFor(definitions.get(productId)?.verificationStatus, { sentence: true })
const formatCategory = (category: string) => category === 'terminals' ? 'Клеммы' : category === 'RCBO' ? 'Дифавтоматы' : category === 'MCB' ? 'Автоматы' : category === 'SPD' ? 'УЗИП' : category
</script>

<template>
  <div class="demo-project-page">
    <section class="demo-project-shell" aria-labelledby="demo-project-title">
      <header class="demo-project-header">
        <div class="demo-project-heading">
          <span class="eyebrow">DEMO · отдельный проект</span>
          <h1 id="demo-project-title">{{ demoProject.name }}</h1>
          <p>Ограниченный просмотр готовой раскладки без аккаунта и без изменения пользовательских данных.</p>
        </div>
        <div class="demo-identity" aria-label="Демо-пользователь">
          <span class="identity-avatar">ДП</span>
          <span><b>Демо-пользователь</b><small>Только просмотр</small></span>
        </div>
        <button class="demo-print" type="button" @click="printDemo">Печать</button>
      </header>

      <div class="demo-project-meta">
        <span><b>Корпус</b> {{ layout.cabinet?.name || 'NX8' }}</span>
        <span><b>Рейка</b> {{ layout.rail?.name || '12 модулей' }}</span>
        <span><b>Ввод</b> {{ demoProject.settings.inputCurrent }} А · {{ demoProject.settings.phase === 1 ? '1 фаза' : '3 фазы' }}</span>
        <span><b>Модульный шаг</b> {{ pitchLabel }}</span>
        <span class="meta-readonly"><i></i> Демо-режим</span>
      </div>

      <nav class="demo-project-tabs" role="tablist" aria-label="Разделы демо-проекта">
        <button v-for="(tab, index) in tabs" :id="`demo-tab-${tab.id}`" :key="tab.id" :data-demo-tab="tab.id" :aria-controls="`demo-panel-${tab.id}`" :aria-selected="activeTab === tab.id" :class="{ active: activeTab === tab.id }" :tabindex="activeTab === tab.id ? 0 : -1" type="button" role="tab" @click="setTab(tab.id)" @keydown="onTabKeydown($event, index)">{{ tab.label }}</button>
      </nav>

      <section v-if="activeTab === '2d'" id="demo-panel-2d" class="demo-project-board-view" role="tabpanel" aria-label="2D-схема демо-проекта">
        <div class="demo-project-metrics">
          <div><b>{{ requiredModules }}</b><span>занято модулей</span></div>
          <div><b>{{ freeSlots }}</b><span>свободно из {{ capacity * demoProject.settings.rows }}</span></div>
          <div><b>{{ demoProject.devices.length }}</b><span>устройств на схеме</span></div>
          <div><b>{{ criticalIssues.length }}</b><span>критичных замечаний</span></div>
        </div>
        <div class="demo-project-board-toolbar">
          <div><span class="eyebrow">Корпус {{ layout.cabinet?.modules || 24 }} MOD</span><b>{{ layout.cabinet?.name || 'NX8 / 24 модуля' }}</b></div>
          <div class="zoom-controls" aria-label="Масштаб схемы">
            <button type="button" aria-label="Уменьшить схему" @click="changeZoom(-0.1)">−</button>
            <span>{{ Math.round(zoom * 100) }}%</span>
            <button type="button" aria-label="Увеличить схему" @click="changeZoom(0.1)">+</button>
            <button type="button" aria-label="Сбросить масштаб" @click="resetZoom">Сброс</button>
          </div>
        </div>
        <div class="demo-project-canvas">
          <div class="demo-project-cabinet" :style="{ width: `${geometry.cabinetWidthPx}px`, minHeight: `${geometry.cabinetHeightPx}px`, transform: `scale(${zoom})` }">
            <div class="demo-project-plate" :style="{ left: `${geometry.plateInsetPx}px`, top: `${geometry.plateTopPx}px`, width: `${geometry.plateWidthPx}px`, height: `${geometry.plateHeightPx}px` }">
              <span v-for="fastener in 4" :key="fastener" class="plate-fastener" aria-hidden="true"></span>
              <div class="cabinet-caption"><span>МОНТАЖНАЯ ПЛАСТИНА</span><b>{{ geometry.cabinetWidthMm }} × {{ geometry.cabinetHeightMm }} × {{ geometry.cabinetDepthMm }} мм</b></div>
              <div v-for="row in rows" :key="row" class="demo-project-row" :style="demoRowStyle(row)">
                <span class="row-number" :style="demoRowNumberStyle()">Р{{ row + 1 }}</span>
                <div class="demo-project-rail" :style="demoRailStyle(row)">
                  <div class="row-slots">
                    <button
                      v-for="slot in capacity"
                      :key="slot - 1"
                      class="demo-project-slot"
                      :class="{ occupied: slotOccupied(row, slot - 1) }"
                      type="button"
                      :style="demoSlotStyle(slot - 1)"
                      :aria-label="`Ряд ${row + 1}, модуль ${slot}. ${slotOccupied(row, slot - 1) ? 'Занят устройством' : 'Свободен'}`"
                      @click="devicesInRow(row).filter((device) => slot - 1 >= device.slot && slot - 1 < device.slot + widthFor(device)).forEach((device) => { selectedId = device.instanceId })"
                    ><span>{{ slot }}</span></button>
                    <button
                      v-for="device in devicesInRow(row)"
                      :key="device.instanceId"
                      class="demo-project-device"
                      :class="{ selected: selectedId === device.instanceId }"
                      type="button"
                      :style="demoDeviceStyle(device)"
                      :data-footprint-modules="widthFor(device)"
                      :data-width-mm="geometry.deviceWidthMm(device.productId)"
                      :aria-label="`${device.marking || device.address}: ${productFor(device)?.name || 'Устройство'}`"
                      @click="selectedId = device.instanceId"
                    >
                      <DeviceVisual v-if="productFor(device)" :product="productFor(device)!" :width="geometry.deviceWidthPx(device.productId)" />
                      <strong>{{ device.marking || device.address }}</strong>
                    </button>
                  </div>
                </div>
                <span class="row-usage">{{ rowUsage[row]?.used || 0 }} / {{ capacity }} мод.</span>
              </div>
              <div class="cabinet-footer"><span>L</span><span>N</span><span>PE</span><b>{{ pitchLabel }} на модуль</b></div>
            </div>
          </div>
        </div>
        <p class="demo-readonly-note"><span>●</span> Схема доступна только для просмотра. Свободные слоты не принимают новые устройства.</p>
      </section>

      <section v-else-if="activeTab === 'bom'" id="demo-panel-bom" class="demo-project-panel" role="tabpanel" aria-labelledby="demo-bom-title">
        <div class="panel-intro"><div><span class="eyebrow">Предварительная спецификация</span><h2 id="demo-bom-title">BOM проекта</h2></div><span class="preliminary-pill">{{ bom.length }} позиций · {{ demoProject.devices.length }} устройств</span></div>
        <div class="demo-bom-table-wrap">
          <div class="demo-bom-table demo-bom-head"><span>Позиция</span><span>Изделие</span><span>Модули</span><span>Кол-во</span><span>Цена</span><span>Проверка / источник</span></div>
          <div v-for="line in bom" :key="line.productId" class="demo-bom-table demo-bom-line">
            <span class="mono">{{ line.sku }}</span>
            <span><strong>{{ line.name }}</strong><small>{{ line.brand }} · {{ formatCategory(line.category) }}</small></span>
            <span>{{ line.category === 'terminals' ? '—' : definitions.get(line.productId)?.moduleWidth || 1 }}</span>
            <span>{{ line.quantity }}</span>
            <span>{{ line.priceKnown ? `${line.unitPrice.toLocaleString('ru-RU')} ₽` : '«уточняется»' }}</span>
            <span><small>{{ verificationLabel(line.productId) }}</small><small>{{ definitions.get(line.productId)?.sourceUrl ? 'Источник указан' : 'Источник не указан' }}</small></span>
          </div>
        </div>
        <p class="demo-disclaimer">Цены и масса ENMAS/CHINT в этом DEMO не подтверждены и не являются официальным расчётом. Итоговую спецификацию сверяйте по паспортам и прайсу поставщика.</p>
      </section>

      <section v-else-if="activeTab === 'checks'" id="demo-panel-checks" class="demo-project-panel" role="tabpanel" aria-labelledby="demo-checks-title">
        <div class="panel-intro"><div><span class="eyebrow">Предварительные проверки</span><h2 id="demo-checks-title">Состояние раскладки</h2></div><span class="status-pill" :class="criticalIssues.length ? 'has-issues' : 'is-clean'">{{ criticalIssues.length ? 'Есть замечания' : 'Ошибок не найдено' }}</span></div>
        <div class="check-summary"><div><b>{{ layout.cabinet?.modules || 24 }}</b><span>модулей корпуса</span></div><div><b>{{ requiredModules }}</b><span>занято</span></div><div><b>{{ freeSlots }}</b><span>свободно</span></div><div><b>{{ minimum.width }} × {{ minimum.height }}</b><span>расчётный минимум, мм</span></div></div>
        <div class="demo-issues">
          <div v-for="issue in issues" :key="issue.id" class="demo-issue" :class="`level-${issue.level}`"><span class="issue-mark">{{ issue.level === 'error' ? '!' : issue.level === 'warning' ? '!' : 'i' }}</span><span><strong>{{ issue.title }}</strong><small>{{ issue.message }}</small></span></div>
        </div>
        <p class="demo-disclaimer">Проверки носят предварительный информационный характер и не заменяют проверку схемы, нагрузок и требований квалифицированным специалистом.</p>
      </section>

      <section v-else id="demo-panel-circuits" class="demo-project-panel" role="tabpanel" aria-labelledby="demo-circuits-title">
        <div class="panel-intro"><div><span class="eyebrow">Демонстрационные связи</span><h2 id="demo-circuits-title">Цепи и фазовый баланс</h2></div><span class="preliminary-pill">Только просмотр</span></div>
        <div class="phase-summary"><div class="phase-total"><b>{{ phase.totals[0] }} А</b><span>Фаза L1</span></div><div class="phase-total"><b>{{ phase.totals[1] }} А</b><span>Фаза L2</span></div><div class="phase-total"><b>{{ phase.totals[2] }} А</b><span>Фаза L3</span></div><div class="phase-total"><b>{{ phase.spread }}%</b><span>разброс</span></div></div>
        <div class="demo-circuit-list">
          <article v-for="circuit in demoProject.circuits" :key="circuit.id" class="demo-circuit"><span class="circuit-line" :style="{ background: circuit.color }"></span><div><strong>{{ circuit.name }}</strong><small>{{ circuit.loadName }} · {{ circuit.power }} Вт</small></div><span>{{ circuit.current }} A</span><span class="mono">{{ circuit.wireCrossSection }} мм²</span></article>
        </div>
        <p class="demo-disclaimer">Связи показаны для демонстрации интерфейса и не являются электрической схемой или проектной документацией.</p>
      </section>

      <section class="demo-inspector" aria-labelledby="demo-inspector-title">
        <div class="inspector-heading"><span class="eyebrow">Read-only инспектор</span><h2 id="demo-inspector-title">{{ selectedDefinition?.name || 'Устройство не выбрано' }}</h2><p>{{ selected?.note || 'Выберите позицию на схеме.' }}</p></div>
        <dl v-if="selected && selectedDefinition">
          <div><dt>Позиция</dt><dd>{{ selectedPosition }}</dd></div>
          <div><dt>Серия / артикул</dt><dd>{{ selectedDefinition.series }} · {{ selectedDefinition.sku }}</dd></div>
          <div><dt>Номинал</dt><dd>{{ selectedDefinition.ratedCurrent }} A · {{ selectedDefinition.moduleWidth }} мод.</dd></div>
          <div><dt>Статус</dt><dd class="ok-text">Размещено</dd></div>
        </dl>
        <div v-if="selected && selectedDefinition?.sourceUrl" class="demo-source"><span>Источник серии</span><a :href="selectedDefinition.sourceUrl" target="_blank" rel="noreferrer">Открыть паспорт ↗</a></div>
      </section>

      <footer class="demo-project-footer"><span>Панель 36 · DEMO-проект</span><span>Расчёты и проверки предварительные · данные не сохраняются</span></footer>
      <ProjectPrintReport :project="demoProject" :definitions="definitions" title="Демо-проект · Квартира" />
    </section>
  </div>
</template>

<style scoped>
.demo-project-page {
  min-height: calc(100vh - 66px);
  padding: 42px 16px 64px;
  background: var(--canvas);
}
.demo-project-shell {
  width: min(100%, 1240px);
  margin: 0 auto;
}
.demo-project-header {
  display: flex;
  align-items: end;
  gap: 24px;
  padding: 28px;
  color: var(--on-service);
  background: var(--service);
  border: 1px solid var(--service);
  box-shadow: 10px 10px 0 var(--accent-soft);
}
.demo-project-heading {
  min-width: 0;
  flex: 1;
}
.demo-project-heading h1 {
  margin-top: 10px;
  font-size: clamp(28px, 4vw, 48px);
  line-height: 1;
  letter-spacing: -.04em;
}
.demo-project-heading p {
  max-width: 680px;
  margin-top: 12px;
  color: color-mix(in srgb, var(--on-service) 68%, transparent);
  font-size: var(--text-xs);
  line-height: 1.55;
}
.demo-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 175px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--on-service) 25%, transparent);
}
.identity-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--service);
  background: var(--accent);
  font:700 var(--text-xs) var(--mono);
}
.demo-identity b,
.demo-identity small {
  display: block;
}
.demo-identity b {
  font-size: var(--text-xs);
}
.demo-identity small {
  margin-top: 3px;
  color: color-mix(in srgb, var(--on-service) 60%, transparent);
  font:var(--text-micro) var(--mono);
}
.demo-print {
  min-height: 38px;
  padding: 0 12px;
  color: var(--service);
  background: var(--accent);
  border: 1px solid var(--accent);
  font:800 var(--text-xs) var(--mono);
  cursor: pointer;
}
.demo-print:hover {
  color: #fff;
  background: transparent;
  border-color: var(--accent);
}
.demo-project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-top: 18px;
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--text-muted);
  font:var(--text-xs) var(--mono);
}
.demo-project-meta b {
  margin-right: 5px;
  color: var(--text-faint);
  font-weight: 500;
}
.meta-readonly {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--ok);
}
.meta-readonly i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft);
}
.demo-project-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 22px;
  padding: 4px;
  width: fit-content;
  background: var(--surface);
  border: 1px solid var(--line);
}
.demo-project-tabs button {
  min-height: 40px;
  padding: 0 16px;
  color: var(--text-muted);
  font:700 var(--text-xs) var(--mono);
  cursor: pointer;
}
.demo-project-tabs button.active {
  color: var(--on-service);
  background: var(--service);
}
.demo-project-board-view,
.demo-project-panel,
.demo-inspector {
  margin-top: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
}
.demo-project-board-view {
  padding: 18px;
}
.demo-project-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--line);
}
.demo-project-metrics div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px 16px;
  border-right: 1px solid var(--line);
}
.demo-project-metrics div:last-child {
  border-right: 0;
}
.demo-project-metrics b {
  color: var(--heading);
  font:700 var(--text-xl) var(--mono);
}
.demo-project-metrics span {
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
  text-transform: uppercase;
}
.demo-project-board-toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  margin-top: 22px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--line);
}
.demo-project-board-toolbar > div:first-child {
  display: grid;
  gap: 5px;
}
.demo-project-board-toolbar b {
  color: var(--heading);
  font-size: var(--text-base);
}
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.zoom-controls button {
  min-width: 34px;
  min-height: 30px;
  padding: 0 8px;
  color: var(--text-muted);
  border: 1px solid var(--line);
  font:var(--text-xs) var(--mono);
  cursor: pointer;
}
.zoom-controls button:hover {
  color: var(--heading);
  border-color: var(--service);
}
.zoom-controls span {
  min-width: 48px;
  color: var(--text-faint);
  text-align: center;
  font:var(--text-xs) var(--mono);
}
.demo-project-canvas {
  min-height: 360px;
  overflow: auto;
  margin-top: 14px;
  padding: 38px 20px 42px;
  background-color: var(--canvas);
  background-image: linear-gradient(var(--line-soft) 1px, transparent 1px), linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
  background-size: 24px 24px;
}
.demo-project-cabinet {
  position: relative;
  max-width: 900px;
  margin: 0 auto;
  padding: 0;
  background: linear-gradient(100deg, #b7c0b9, var(--board-case-hi) 9%, #d0d7d0 90%, #a9b3ab);
  border: 3px solid #758179;
  box-shadow: 8px 9px 0 var(--board-case-shadow);
  transform-origin: top center;
  transition: width .2s ease, transform .2s ease;
}
.demo-project-plate {
  position: absolute;
  overflow: visible;
  background-color: var(--board-plate);
  background-image: linear-gradient(105deg, rgba(255,255,255,.22), transparent 38%), repeating-linear-gradient(0deg, transparent 0 4px, rgba(74,86,79,.045) 4px 5px);
  border: 1px solid var(--board-plate-edge);
  box-shadow: inset 0 0 0 2px rgba(245,247,242,.32), inset 0 0 18px rgba(31,48,39,.14), 2px 2px 0 rgba(35,49,42,.12);
}
.cabinet-caption,
.cabinet-footer {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  color: var(--board-ink);
  font:var(--text-micro) var(--mono);
}
.cabinet-caption {
  height: 22px;
  align-items: center;
}
.cabinet-caption span {
  letter-spacing: .1em;
}
.demo-project-row {
  position: relative;
  z-index: 2;
  min-height: 0;
  border-top: 1px solid rgba(74, 86, 79, .16);
}
.demo-project-row:first-of-type {
  border-top: 0;
}
.row-number {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  color: var(--board-ink);
  font:700 var(--text-micro) var(--mono);
}
.demo-project-rail {
  position: absolute;
  left: 0;
  background: repeating-linear-gradient(90deg, transparent 0 13px, rgba(34,50,41,.12) 13px 15px), linear-gradient(180deg, var(--board-din-1) 0 42%, var(--board-din-2) 43% 57%, var(--board-din-3) 58% 100%);
  box-shadow: inset 0 1px var(--board-rail-edge), inset 0 -1px var(--board-rail-edge), 0 3px 0 rgba(47, 61, 53, .18);
}
.row-slots {
  position: absolute;
  inset: 0;
  padding: 0;
}
.demo-project-slot {
  position: absolute;
  top: 0;
  bottom: 0;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--board-slot-edge);
  background: var(--board-slot);
  color: transparent;
  font:var(--text-micro) var(--mono);
  cursor: default;
}
.demo-project-slot:first-child {
  border-left: 1px solid var(--board-slot-edge);
}
.demo-project-slot.occupied {
  background: var(--board-slot-filled);
}
.demo-project-slot:hover {
  background: var(--board-slot-hover);
}
.demo-project-slot span {
  position: absolute;
  left: 50%;
  bottom: -16px;
  transform: translateX(-50%);
  color: var(--board-ink);
}
.demo-project-device {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 1px 1px;
  border: 1px solid var(--board-device-edge);
  border-radius: 1.5px;
  background: transparent;
  color: var(--heading);
  cursor: pointer;
  overflow: hidden;
}
.demo-project-device:hover,
.demo-project-device.selected {
  z-index: 3;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
}
.demo-project-device :deep(.device-visual) {
  display: block;
  width: 100% !important;
  height: auto !important;
  min-height: 0;
  flex: 1 1 auto;
}
.demo-project-device strong {
  display: block;
  margin: 0 0 1px;
  padding: 1px 0;
  border-top: 1px solid rgba(118, 128, 121, .5);
  background: linear-gradient(180deg, var(--dv-paper-1, #fbfaf2), var(--dv-paper-2, #e4e3d7));
  color: var(--dv-ink, #2f3831);
  max-width: 100%;
  overflow: hidden;
  font:600 var(--text-annotation) var(--mono);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-usage {
  position: absolute;
  z-index: 3;
  right: -8px;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  color: var(--board-ink);
  font:var(--text-micro) var(--mono);
  white-space: nowrap;
}
.cabinet-footer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding-top: 12px;
  border-top: 1px solid rgba(101,112,105,.4);
}
.cabinet-footer b {
  margin-left: auto;
}
.demo-readonly-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
}
.demo-readonly-note span {
  color: var(--ok);
}
.demo-project-panel {
  padding: 24px;
}
.panel-intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.panel-intro h2 {
  margin-top: 8px;
  color: var(--heading);
  font-size: var(--text-2xl);
}
.preliminary-pill,
.status-pill {
  padding: 7px 10px;
  color: var(--text-muted);
  border: 1px solid var(--line);
  font:var(--text-micro) var(--mono);
}
.status-pill.is-clean {
  color: var(--ok);
  border-color: var(--ok);
}
.status-pill.has-issues {
  color: var(--warning);
  border-color: var(--warning);
}
.demo-bom-table-wrap {
  margin-top: 18px;
  overflow-x: auto;
}
.demo-bom-table {
  display: grid;
  grid-template-columns: 120px minmax(220px, 1fr) 80px 70px 110px 150px;
  gap: 16px;
  min-width: 840px;
  align-items: center;
}
.demo-bom-head {
  padding: 0 12px 10px;
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
  text-transform: uppercase;
}
.demo-bom-line {
  padding: 14px 12px;
  border-top: 1px solid var(--line);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.demo-bom-line strong,
.demo-bom-line small {
  display: block;
}
.demo-bom-line strong {
  color: var(--heading);
  font-size: var(--text-xs);
}
.demo-bom-line small {
  margin-top: 4px;
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
}
.demo-disclaimer {
  margin-top: 18px;
  color: var(--text-faint);
  font:var(--text-micro)/1.55 var(--mono);
}
.check-summary,
.phase-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-top: 18px;
  border: 1px solid var(--line);
}
.check-summary div,
.phase-total {
  display: grid;
  gap: 5px;
  padding: 15px;
  border-right: 1px solid var(--line);
}
.check-summary div:last-child,
.phase-total:last-child {
  border-right: 0;
}
.check-summary b,
.phase-total b {
  color: var(--heading);
  font:700 var(--text-lg) var(--mono);
}
.check-summary span,
.phase-total span {
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
  text-transform: uppercase;
}
.demo-issues {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}
.demo-issue {
  display: flex;
  gap: 11px;
  padding: 13px 15px;
  background: var(--surface-raised);
  border: 1px solid var(--line);
}
.demo-issue.level-error {
  border-color: var(--error);
}
.demo-issue.level-warning {
  border-color: var(--warning);
}
.demo-issue.level-info {
  border-color: var(--service);
}
.issue-mark {
  display: grid;
  flex: 0 0 22px;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--service);
  background: var(--accent-soft);
  font:800 var(--text-xs) var(--mono);
}
.level-error .issue-mark,
.level-warning .issue-mark {
  color: var(--heading);
  background: var(--warning-soft);
}
.demo-issue strong,
.demo-issue small {
  display: block;
}
.demo-issue strong {
  color: var(--heading);
  font-size: var(--text-xs);
}
.demo-issue small {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.45;
}
.demo-circuit-list {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}
.demo-circuit {
  display: grid;
  grid-template-columns: 5px 1fr 60px 70px;
  gap: 14px;
  align-items: center;
  padding: 13px 15px;
  border: 1px solid var(--line);
  background: var(--surface-raised);
}
.circuit-line {
  align-self: stretch;
  border-radius: 2px;
}
.demo-circuit strong,
.demo-circuit small {
  display: block;
}
.demo-circuit strong {
  color: var(--heading);
  font-size: var(--text-xs);
}
.demo-circuit small {
  margin-top: 3px;
  color: var(--text-faint);
  font-size: var(--text-xs);
}
.demo-circuit > span:not(.circuit-line) {
  color: var(--text-muted);
  font:var(--text-xs) var(--mono);
}
.demo-inspector {
  display: grid;
  grid-template-columns: 1.1fr 1fr .8fr;
  gap: 28px;
  align-items: start;
  padding: 24px;
}
.inspector-heading h2 {
  margin-top: 9px;
  color: var(--heading);
  font-size: var(--text-lg);
}
.inspector-heading p {
  margin-top: 7px;
  color: var(--text-muted);
  font:var(--text-xs) var(--mono);
}
.demo-inspector dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
  margin: 0;
}
.demo-inspector dl div {
  display: grid;
  gap: 4px;
}
.demo-inspector dt {
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
  text-transform: uppercase;
}
.demo-inspector dd {
  margin: 0;
  color: var(--heading);
  font-size: var(--text-xs);
  font-weight: 700;
}
.demo-source {
  display: grid;
  gap: 7px;
  align-self: end;
  padding: 12px;
  background: var(--surface-raised);
  border: 1px solid var(--line);
  font:var(--text-micro) var(--mono);
}
.demo-source span {
  color: var(--text-faint);
}
.demo-source a {
  color: var(--accent);
  text-decoration: none;
}
.demo-project-footer {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-top: 24px;
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
}
@media (max-width: 820px) {
  .demo-project-header {
    flex-wrap: wrap;
  }
  .demo-project-heading {
    flex-basis: 100%;
  }
  .demo-project-board-view {
    padding: 12px;
  }
  .demo-inspector {
    grid-template-columns: 1fr 1fr;
  }
  .demo-source {
    grid-column: 1 / -1;
  }
}
@media (max-width: 600px) {
  .demo-project-page {
    padding: 22px 10px 44px;
  }
  .demo-project-header {
    padding: 20px;
  }
  .demo-project-meta {
    display: grid;
    gap: 8px;
  }
  .meta-readonly {
    margin-left: 0;
  }
  .demo-project-tabs {
    width: 100%;
  }
  .demo-project-tabs button {
    flex: 1;
    padding: 0 8px;
  }
  .demo-project-metrics,
  .check-summary,
  .phase-summary {
    grid-template-columns: 1fr 1fr;
  }
  .demo-project-metrics div:nth-child(2),
  .check-summary div:nth-child(2),
  .phase-total:nth-child(2) {
    border-right: 0;
  }
  .demo-project-metrics div:nth-child(-n+2),
  .check-summary div:nth-child(-n+2),
  .phase-total:nth-child(-n+2) {
    border-bottom: 1px solid var(--line);
  }
  .demo-project-metrics b {
    font-size: var(--text-lg);
  }
  .demo-project-board-toolbar,
  .panel-intro {
    align-items: start;
    flex-direction: column;
  }
  .zoom-controls {
    width: 100%;
  }
  .zoom-controls span {
    flex: 1;
  }
  .demo-project-panel,
  .demo-inspector {
    padding: 16px;
  }
  .demo-inspector {
    grid-template-columns: 1fr;
  }
  .demo-source {
    grid-column: auto;
  }
  .demo-circuit {
    grid-template-columns: 5px 1fr 50px;
  }
  .demo-circuit > span:last-child {
    grid-column: 2 / -1;
  }
  .demo-project-footer {
    display: grid;
    gap: 7px;
  }
}
@media print {
  .demo-project-page {
    padding: 0;
    background: #fff;
  }
  .demo-project-shell > :not(.print-report) {
    display: none !important;
  }
  .demo-project-tabs,
  .demo-print,
  .zoom-controls,
  .demo-project-footer,
  .public-header,
  .public-footer {
    display: none !important;
  }
  .demo-project-header {
    box-shadow: none;
  }
  .demo-project-shell {
    width: 100%;
  }
  .print-report {
    display: block !important;
  }
}
</style>
