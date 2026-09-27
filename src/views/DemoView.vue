<script setup lang="ts">
import { computed, ref } from 'vue'

type DemoDevice = {
  id: string
  name: string
  detail: string
  width: number
  tone: 'green' | 'accent' | 'neutral' | 'dark'
}

const activeView = ref<'2d' | 'bom'>('2d')
const selectedId = ref('qf01')
const devices: DemoDevice[] = [
  { id: 'qf01', name: 'QF01 · Автомат', detail: '1P · 16 A · 6 kA', width: 1, tone: 'green' },
  { id: 'qf02', name: 'QF02 · Автомат', detail: '1P · 16 A · 6 kA', width: 1, tone: 'green' },
  { id: 'q01', name: 'Q01 · УЗО', detail: '2P · 25 A · 30 mA', width: 2, tone: 'accent' },
  { id: 'spd', name: 'SPD01 · УЗИП', detail: '2P · Type 2', width: 2, tone: 'dark' },
  { id: 'psu', name: 'PSU01 · Блок питания', detail: '12 V DC · 1 A', width: 2, tone: 'neutral' },
]
const selectedDevice = computed(() => devices.find((device) => device.id === selectedId.value) || devices[0])
</script>

<template>
  <div class="demo-page">
    <section class="demo-hero page-width">
      <div>
        <span class="eyebrow">DEMO · локальная тестовая версия</span>
        <h1>Посмотрите, как<br /><em>собирается панель.</em></h1>
        <p>Это не аккаунт и не регистрация. Посмотрите ограниченную demo-страницу проекта с 2D-раскладкой, BOM и предварительными проверками.</p>
        <div class="demo-actions">
          <RouterLink class="marketing-primary" to="/demo/project">Открыть DEMO-проект</RouterLink>
          <RouterLink class="demo-secondary" to="/features">Что внутри</RouterLink>
        </div>
        <p class="demo-note"><span>●</span> Данные остаются в этом браузере. Ничего не отправляется на сервер.</p>
      </div>
      <div class="demo-hero-card">
        <div class="demo-card-top"><span><i></i> PANEL36 / DEMO</span><b>READ ONLY</b></div>
        <strong>Квартира · 1 фаза · 40 А</strong>
        <div class="demo-mini-rail" aria-hidden="true">
          <span v-for="slot in 12" :key="slot" :class="{ filled: [1, 2, 4, 6, 8, 10].includes(slot), wide: slot === 4 }"></span>
        </div>
        <div class="demo-card-foot"><span>NX8 / 24 MOD</span><span>2D PREVIEW</span></div>
      </div>
    </section>

    <section class="demo-workspace page-width" aria-labelledby="demo-preview-title">
      <div class="demo-workspace-heading">
        <div><span class="eyebrow">Интерактивный предпросмотр</span><h2 id="demo-preview-title">Панель 36, как её видит электрик.</h2></div>
        <div class="demo-tabs" role="tablist" aria-label="Предпросмотр панели">
          <button :class="{ active: activeView === '2d' }" role="tab" :aria-selected="activeView === '2d'" @click="activeView = '2d'">2D схема</button>
          <button :class="{ active: activeView === 'bom' }" role="tab" :aria-selected="activeView === 'bom'" @click="activeView = 'bom'">BOM / состав</button>
        </div>
      </div>

      <div v-if="activeView === '2d'" class="demo-preview-grid">
        <div class="demo-board" aria-label="Демонстрационная 2D-схема щита">
          <div class="demo-board-head"><span>Корпус NX8 · 24 модуля</span><b>Рейка 12 / 18 модулей</b></div>
          <div class="demo-cabinet">
            <div class="demo-rail" v-for="row in 3" :key="row">
              <span v-for="slot in 12" :key="slot" class="demo-slot" :class="{ filled: [1, 2, 4, 6, 8, 10].includes(slot), selected: selectedId === (row === 1 && slot === 4 ? 'q01' : '') }" @click="selectedId = row === 1 && slot === 4 ? 'q01' : selectedId"><i></i></span>
            </div>
            <div class="demo-cabinet-foot"><span>QF</span><span>Q</span><span>SPD</span><span>PE</span></div>
          </div>
        </div>
        <aside class="demo-inspector">
          <span class="eyebrow">Инспектор</span>
          <h3>{{ selectedDevice.name }}</h3>
          <p>{{ selectedDevice.detail }}</p>
          <dl><div><dt>Позиция</dt><dd>Ряд 1 · модуль 4</dd></div><div><dt>Ширина</dt><dd>{{ selectedDevice.width }} мод.</dd></div><div><dt>Статус</dt><dd class="ok-text">Размещено</dd></div></dl>
          <div class="demo-device-list"><button v-for="device in devices" :key="device.id" :class="{ active: selectedId === device.id }" @click="selectedId = device.id"><span :class="`tone-${device.tone}`"></span>{{ device.name }}<small>{{ device.detail }}</small></button></div>
        </aside>
      </div>

      <div v-else class="demo-bom">
        <div class="demo-bom-head"><span>Позиция</span><span>Устройство</span><span>Модули</span><span>Статус</span></div>
        <div v-for="(device, index) in devices" :key="device.id" class="demo-bom-row"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ device.name }}</strong><span>{{ device.width }}</span><span class="ok-text">Включено</span></div>
        <div class="demo-bom-total"><span>Итого</span><strong>8 модулей</strong><span>5 устройств</span><span>≈ 4 280 ₽</span></div>
      </div>
    </section>

    <section class="demo-capabilities page-width" aria-labelledby="demo-capabilities-title">
      <div><span class="eyebrow">Что можно посмотреть</span><h2 id="demo-capabilities-title">Не только текст — настоящая механика.</h2></div>
      <div class="demo-capability-list"><p><b>01</b> Физическая ширина модулей 18 мм и свободные слоты.</p><p><b>02</b> Каталог, инспектор и предварительные проверки.</p><p><b>03</b> BOM, JSON export и локальные проекты.</p></div>
    </section>
  </div>
</template>

<style scoped>
.demo-page { overflow: hidden; }
.page-width { width: min(100% - 32px, 1180px); margin: 0 auto; }
.demo-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 430px); gap: clamp(38px, 8vw, 110px); align-items: center; padding: clamp(58px, 9vw, 116px) 0 90px; }
.demo-hero h1 { margin-top: 14px; font-size: clamp(42px, 6.5vw, 76px); line-height: .96; letter-spacing: -.055em; }.demo-hero h1 em { color: var(--accent); font-style: normal; }.demo-hero p { max-width: 580px; margin-top: 24px; color: var(--text-muted); font-size: var(--text-base); line-height: 1.7; }.demo-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 30px; }.marketing-primary, .demo-secondary { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; font-size: var(--text-xs); font-weight: 800; text-decoration: none; }.marketing-primary { border: 1px solid var(--service); background: var(--service); color: var(--on-service); cursor: pointer; }.marketing-primary:hover { border-color: var(--accent); background: var(--accent); }.demo-secondary { border: 1px solid var(--line); background: var(--surface-raised); color: var(--text); }.demo-secondary:hover { border-color: var(--service); }.demo-note { display: flex; gap: 8px; align-items: center; margin-top: 22px; color: var(--text-faint); font:var(--text-micro) var(--mono); }.demo-note span { color: var(--ok); }
.demo-hero-card { padding: 18px; background: var(--surface-raised); border: 1px solid var(--service); box-shadow: 9px 10px 0 var(--accent-soft); }.demo-card-top, .demo-card-foot { display: flex; align-items: center; justify-content: space-between; padding: 11px 0; color: var(--text-faint); font:var(--text-micro) var(--mono); }.demo-card-top { border-bottom: 1px solid var(--line); }.demo-card-top span { display: inline-flex; align-items: center; gap: 7px; }.demo-card-top i { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }.demo-card-top b { color: var(--accent); font-weight: 500; }.demo-hero-card > strong { display: block; margin-top: 22px; color: var(--heading); font-size: var(--text-base); }.demo-mini-rail { display: flex; gap: 4px; margin-top: 18px; padding: 13px 10px; background: #aeb7af; border-block: 1px solid #6f7a73; }.demo-mini-rail span { flex: 1; height: 34px; background: #f5f5ef; border: 1px solid #7d8880; }.demo-mini-rail span.filled { background: #d7e7de; border-color: var(--ok); }.demo-mini-rail span.wide { flex: 2; background: #ead7cf; border-color: var(--accent); }.demo-card-foot { border-top: 1px solid var(--line); }
.demo-workspace { padding: 32px 0 100px; border-top: 1px solid var(--line); }.demo-workspace-heading { display: flex; align-items: end; justify-content: space-between; gap: 30px; }.demo-workspace-heading h2, .demo-capabilities h2 { margin-top: 12px; font-size: clamp(28px, 4vw, 48px); line-height: 1; letter-spacing: -.04em; }.demo-tabs { display: flex; padding: 4px; background: var(--surface); border: 1px solid var(--line); }.demo-tabs button { min-height: 40px; padding: 0 13px; color: var(--text-muted); font:600 var(--text-xs) var(--mono); }.demo-tabs button.active { background: var(--service); color: var(--on-service); }.demo-preview-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; margin-top: 34px; }.demo-board { min-height: 440px; padding: 18px; background: var(--canvas); border: 1px solid var(--line); background-image: linear-gradient(var(--line-soft) 1px, transparent 1px), linear-gradient(90deg, var(--line-soft) 1px, transparent 1px); background-size: 24px 24px; }.demo-board-head { display: flex; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid var(--line); color: var(--text-faint); font:var(--text-micro) var(--mono); }.demo-cabinet { width: min(100%, 530px); margin: 54px auto 30px; padding: 30px 24px 18px 42px; background: linear-gradient(100deg, #b7c0b9, #eef0ec 9%, #d0d7d0 90%, #a9b3ab); border: 3px solid #758179; box-shadow: 8px 9px 0 rgba(27,42,36,.16); }.demo-rail { display: flex; gap: 3px; height: 72px; margin-bottom: 13px; padding: 9px 5px; background: #aeb7af; border-block: 1px solid #6f7a73; }.demo-slot { flex: 1; position: relative; min-width: 0; background: #f5f5ef; border: 1px solid #7d8880; cursor: pointer; }.demo-slot.filled i { position: absolute; inset: 5px 2px; display: block; background: #d7e7de; border: 1px solid #4d9a6a; }.demo-slot:nth-child(4) i { inset-inline: 2px; background: #ead7cf; border-color: var(--accent); }.demo-slot:hover i, .demo-slot.selected i { background: var(--accent); border-color: var(--accent); }.demo-cabinet-foot { display: flex; justify-content: space-between; color: #69736d; font:var(--text-micro) var(--mono); }.demo-inspector { padding: 20px; background: var(--surface-raised); border: 1px solid var(--line); }.demo-inspector h3 { margin-top: 26px; color: var(--heading); font-size: var(--text-lg); }.demo-inspector > p { margin-top: 7px; color: var(--text-muted); font:var(--text-xs) var(--mono); }.demo-inspector dl { display: grid; gap: 9px; margin: 24px 0; padding: 15px 0; border-block: 1px solid var(--line); }.demo-inspector dl div { display: flex; justify-content: space-between; gap: 10px; font-size: var(--text-xs); }.demo-inspector dt { color: var(--text-faint); }.demo-inspector dd { color: var(--heading); font-weight: 700; }.ok-text { color: var(--ok) !important; }.demo-device-list { display: grid; gap: 5px; }.demo-device-list button { display: grid; grid-template-columns: 8px 1fr; gap: 8px; padding: 8px; text-align: left; color: var(--text-muted); font-size: var(--text-xs); }.demo-device-list button.active { color: var(--heading); background: var(--surface); }.demo-device-list button small { grid-column: 2; color: var(--text-faint); font:var(--text-micro) var(--mono); }.demo-device-list button > span { grid-row: span 2; width: 7px; height: 7px; margin-top: 2px; background: var(--ok); }.demo-device-list .tone-accent { background: var(--accent); }.demo-device-list .tone-dark { background: var(--service); }.demo-device-list .tone-neutral { background: var(--text-muted); }
.demo-bom { margin-top: 34px; border: 1px solid var(--line); background: var(--surface); }.demo-bom-head, .demo-bom-row, .demo-bom-total { display: grid; grid-template-columns: 80px 1.5fr 100px 140px; gap: 15px; align-items: center; padding: 14px 18px; }.demo-bom-head { color: var(--text-faint); font:var(--text-micro) var(--mono); text-transform: uppercase; }.demo-bom-row { border-top: 1px solid var(--line); color: var(--text-muted); font-size: var(--text-xs); }.demo-bom-row strong { color: var(--heading); }.demo-bom-total { margin-top: 1px; background: var(--service); color: var(--on-service); font:var(--text-xs) var(--mono); }.demo-bom-total strong { color: var(--accent); }
.demo-capabilities { display: grid; grid-template-columns: .8fr 1.2fr; gap: 80px; padding: 78px 0 110px; border-top: 1px solid var(--line); }.demo-capability-list { border-top: 1px solid var(--service); }.demo-capability-list p { display: grid; grid-template-columns: 38px 1fr; gap: 15px; padding: 19px 0; border-bottom: 1px solid var(--line); color: var(--text-muted); font-size: var(--text-xs); line-height: 1.55; }.demo-capability-list b { color: var(--accent); font:var(--text-xs) var(--mono); }
@media (max-width: 800px) { .demo-hero { grid-template-columns: 1fr; padding-bottom: 70px; }.demo-hero-card { max-width: 500px; }.demo-workspace-heading { display: grid; align-items: start; }.demo-preview-grid { grid-template-columns: 1fr; }.demo-inspector { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }.demo-inspector .eyebrow, .demo-inspector h3, .demo-inspector > p, .demo-inspector dl, .demo-device-list { grid-column: 1 / -1; }.demo-capabilities { grid-template-columns: 1fr; gap: 32px; padding-bottom: 80px; } }
@media (max-width: 520px) { .page-width { width: min(100% - 28px, 1180px); }.demo-hero h1 { font-size: var(--text-display); }.demo-actions { display: grid; }.demo-actions > * { width: 100%; }.demo-board { min-height: 350px; padding: 12px; }.demo-cabinet { margin-top: 38px; padding: 24px 12px 14px 28px; }.demo-rail { height: 55px; padding: 7px 3px; }.demo-bom-head, .demo-bom-row, .demo-bom-total { grid-template-columns: 45px 1fr 50px; }.demo-bom-head span:nth-child(4), .demo-bom-row span:nth-child(4), .demo-bom-total span:nth-child(4) { display: none; }.demo-inspector { display: block; } }
</style>
