<script setup lang="ts">
import BrandMark from '../components/ui/BrandMark.vue'
</script>

<template>
  <div class="marketing-page marketing-home">
    <section class="marketing-hero page-width" aria-labelledby="home-title">
      <div class="marketing-hero-copy">
        <span class="eyebrow">Конфигуратор электрощитов</span>
        <h1 id="home-title">Соберите панель<br /><em>до мелочей.</em></h1>
        <p>«Панель 36» — браузерный рабочий макет для электрика: физически осмысленные корпуса, рейки, DIN-модули, маркировка и предварительные проверки в одном 2D-комплекте.</p>
        <div class="marketing-actions">
          <RouterLink class="marketing-primary" to="/demo/project">Попробовать DEMO</RouterLink>
          <RouterLink class="marketing-secondary" to="/features">Посмотреть возможности</RouterLink>
        </div>
        <div class="marketing-proof"><span><b>18 мм</b> на модуль</span><span><b>12 / 18</b> модулей на рейке</span><span><b>Local</b> режим</span></div>
      </div>

      <div class="marketing-schematic" aria-label="Схематичная компоновка электрощита">
        <div class="schematic-top"><span><i></i> Панель 36 / 2D</span><b>Схема 001</b></div>
        <div class="schematic-stage">
          <div class="schematic-cabinet">
            <span class="schematic-label">МОНТАЖНАЯ ПЛАСТИНА</span>
            <div class="schematic-bus"></div>
            <div v-for="row in 3" :key="row" class="schematic-row"><i v-for="slot in (row === 2 ? 7 : 10)" :key="slot" :class="{ wide: slot === 4, green: slot === 2 }"></i></div>
            <small>36 MOD</small>
          </div>
        </div>
        <div class="schematic-foot"><span>Корпус</span><span>Рейка 18</span><span>BOM</span><span>Проверки</span></div>
      </div>
    </section>

    <section class="marketing-band" aria-label="Ключевые характеристики">
      <div class="page-width marketing-band-grid">
        <div><strong>01</strong><span>Выберите корпус</span><p>Совместимые рейки подбираются автоматически, а старые проекты сохраняют legacy-параметры.</p></div>
        <div><strong>02</strong><span>Разложите модули</span><p>Добавление сдвигает соседей, а перенос существующего устройства ищет свободный интервал.</p></div>
        <div><strong>03</strong><span>Проверьте и выгрузите</span><p>Спецификация, предварительная стоимость и JSON-экспорт остаются на вашем устройстве.</p></div>
      </div>
    </section>

    <section class="marketing-section page-width" aria-labelledby="workflow-title">
      <div class="section-intro"><span class="eyebrow">Рабочий сценарий</span><h2 id="workflow-title">От корпуса до спецификации — без лишних переключений.</h2><p>Панель 36 показывает электрику не абстрактный список деталей, а понятную раскладку в корпусе.</p></div>
      <div class="workflow-grid">
        <article class="workflow-item"><span class="workflow-number">A</span><h3>Корпус и рейка</h3><p>Выберите встраиваемый или накладной корпус. Рейка выбирается только из совместимых вариантов.</p><span class="workflow-code">NX8 / 24 MOD</span></article>
        <article class="workflow-item"><span class="workflow-number">B</span><h3>Схема 2D</h3><p>Размещайте автоматы, УЗО, SPD и другие модули в реальном модульном шаге 18 мм.</p><span class="workflow-code">ROW 01–04</span></article>
        <article class="workflow-item"><span class="workflow-number">C</span><h3>Проверки и BOM</h3><p>Смотрите занятые модули, предварительные замечания и спецификацию с массой и ценой.</p><span class="workflow-code">CHECK / BOM</span></article>
      </div>
    </section>

    <section class="marketing-section marketing-cta-section page-width" aria-labelledby="cta-title">
      <div class="marketing-cta-panel"><BrandMark /><h2 id="cta-title">Ваша следующая панель начинается с одного понятного чертежа.</h2><p>Создайте локальный проект, перетащите модули на рейку и сохраните рабочую копию в JSON.</p><RouterLink class="marketing-primary" to="/demo/project">Открыть DEMO-конфигуратор</RouterLink></div>
    </section>

    <p class="marketing-disclaimer page-width">Расчёты, стоимость и проверки носят предварительный информационный характер. Панель 36 не заменяет проектную документацию и проверку квалифицированным специалистом.</p>
  </div>
</template>

<style scoped>
.marketing-page { overflow: hidden; }
.page-width { width: min(100% - 32px, 1180px); margin: 0 auto; }
.marketing-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 500px); gap: clamp(38px, 8vw, 120px); align-items: center; padding: clamp(58px, 9vw, 116px) 0 clamp(68px, 9vw, 118px); }
.marketing-hero-copy { max-width: 650px; }
.marketing-hero h1 { margin-top: 14px; font-size: clamp(42px, 7vw, 78px); line-height: .96; letter-spacing: -.055em; }
.marketing-hero h1 em { color: var(--accent); font-style: normal; }
.marketing-hero-copy > p { max-width: 560px; margin-top: 24px; color: var(--text-muted); font-size: 15px; line-height: 1.7; }
.marketing-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 32px; }
.marketing-actions a, .marketing-primary, .marketing-secondary { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; font-size: 12px; font-weight: 800; text-decoration: none; }
.marketing-primary { background: var(--service); color: var(--on-service); border: 1px solid var(--service); }
.marketing-primary:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.marketing-secondary { background: var(--surface-raised); color: var(--text); border: 1px solid var(--line); }
.marketing-secondary:hover { border-color: var(--service); }
.marketing-proof { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 28px; color: var(--text-muted); font: 10px var(--mono); }
.marketing-proof b { color: var(--heading); font-weight: 600; }
.marketing-schematic { background: var(--surface-raised); border: 1px solid var(--service); box-shadow: 12px 14px 0 var(--accent-soft); }
.schematic-top, .schematic-foot { display: flex; align-items: center; gap: 12px; padding: 13px 15px; color: var(--text-muted); font: 500 10px var(--mono); }
.schematic-top { border-bottom: 1px solid var(--line); }.schematic-top span { display: inline-flex; align-items: center; gap: 8px; }.schematic-top i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }.schematic-top b { margin-left: auto; color: var(--heading); }
.schematic-stage { min-height: 350px; display: grid; place-items: center; background-color: var(--canvas); background-image: linear-gradient(var(--line-soft) 1px, transparent 1px), linear-gradient(90deg, var(--line-soft) 1px, transparent 1px); background-size: 24px 24px; }
.schematic-cabinet { position: relative; width: 245px; padding: 38px 28px 30px 44px; background: linear-gradient(100deg, #b7c0b9, #eef0ec 9%, #d0d7d0 90%, #a9b3ab); border: 3px solid #758179; box-shadow: 8px 9px 0 rgba(27,42,36,.16); }
.schematic-label { position: absolute; top: 12px; left: 44px; color: #69736d; font: 600 7px var(--mono); letter-spacing: .12em; }.schematic-cabinet > small { position: absolute; right: 10px; bottom: 8px; color: #657069; font: 700 8px var(--mono); }
.schematic-bus { position: absolute; top: 32px; bottom: 22px; left: 13px; width: 11px; border-right: 1px solid #7c8780; }.schematic-bus::before, .schematic-bus::after { content: ''; position: absolute; left: 3px; width: 4px; height: 32%; background: #a44d37; }.schematic-bus::before { top: 2px; }.schematic-bus::after { bottom: 2px; background: #48a16a; }
.schematic-row { position: relative; z-index: 1; height: 52px; display: flex; gap: 2px; padding: 6px 4px; margin-bottom: 8px; background: #aeb7af; border-top: 1px solid #6f7a73; border-bottom: 1px solid #6f7a73; }.schematic-row i { flex: 1; background: #f5f5ef; border: 1px solid #7d8880; }.schematic-row i.wide { flex: 2; background: #d7e7de; border-color: var(--ok); }.schematic-row i.green { background: #cbe4d2; border-color: #4d9a6a; }
.schematic-foot { justify-content: space-between; border-top: 1px solid var(--line); font-size: 9px; }
.marketing-band { background: var(--service); color: var(--on-service); }.marketing-band-grid { display: grid; grid-template-columns: repeat(3, 1fr); }.marketing-band-grid > div { min-height: 190px; padding: 32px 32px 30px 0; border-right: 1px solid rgba(255,255,255,.15); }.marketing-band-grid > div + div { padding-left: 32px; }.marketing-band-grid > div:last-child { border-right: 0; }.marketing-band-grid strong { display: block; margin-bottom: 28px; color: var(--accent); font: 500 11px var(--mono); }.marketing-band-grid span { display: block; margin-bottom: 8px; font-weight: 800; }.marketing-band-grid p { max-width: 300px; color: rgba(255,253,248,.64); font-size: 11px; line-height: 1.6; }
.marketing-section { padding: clamp(68px, 10vw, 130px) 0; }.section-intro { max-width: 720px; }.section-intro h2 { margin-top: 12px; font-size: clamp(29px, 4vw, 48px); line-height: 1.05; letter-spacing: -.035em; }.section-intro p { max-width: 560px; margin-top: 16px; color: var(--text-muted); font-size: 14px; line-height: 1.65; }
.workflow-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 42px; }.workflow-item { min-height: 250px; display: flex; flex-direction: column; padding: 22px; border: 1px solid var(--line); background: var(--surface); }.workflow-number { color: var(--accent); font: 600 12px var(--mono); }.workflow-item h3 { margin-top: 46px; color: var(--heading); font-size: 20px; }.workflow-item p { margin-top: 10px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }.workflow-code { margin-top: auto; padding-top: 24px; color: var(--text-faint); font: 9px var(--mono); }
.marketing-cta-section { padding-top: 0; }.marketing-cta-panel { padding: clamp(30px, 6vw, 64px); background: var(--accent-soft); border: 1px solid var(--accent); }.marketing-cta-panel h2 { max-width: 680px; margin-top: 28px; font-size: clamp(30px, 4.5vw, 56px); line-height: 1; letter-spacing: -.045em; }.marketing-cta-panel p { max-width: 500px; margin-top: 18px; color: var(--text-muted); font-size: 14px; line-height: 1.6; }.marketing-cta-panel .marketing-primary { margin-top: 28px; }
.marketing-disclaimer { max-width: 900px; padding: 0 0 64px; color: var(--text-faint); font: 10px/1.6 var(--mono); }

@media (max-width: 900px) { .marketing-hero { grid-template-columns: minmax(0, 1fr) minmax(290px, .85fr); gap: 36px; } }
@media (max-width: 720px) { .page-width { width: min(100% - 28px, 1180px); }.marketing-hero { display: block; padding: 52px 0 76px; }.marketing-hero h1 { font-size: clamp(42px, 14vw, 64px); }.marketing-schematic { margin-top: 48px; box-shadow: 7px 8px 0 var(--accent-soft); }.schematic-stage { min-height: 270px; }.marketing-band-grid, .workflow-grid { grid-template-columns: 1fr; }.marketing-band-grid > div, .marketing-band-grid > div + div { min-height: 0; padding: 24px 0; border-right: 0; border-bottom: 1px solid rgba(255,255,255,.15); }.marketing-band-grid > div:last-child { border-bottom: 0; }.marketing-band-grid strong { margin-bottom: 15px; }.workflow-item { min-height: 220px; }.workflow-item h3 { margin-top: 30px; } }
@media (max-width: 420px) { .marketing-actions { display: grid; }.marketing-actions a { width: 100%; }.marketing-proof { display: grid; gap: 9px; }.schematic-foot { gap: 5px; font-size: 8px; } }
</style>
