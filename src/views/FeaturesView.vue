<template>
  <div class="marketing-page features-page">
    <section class="features-hero page-width">
      <span class="eyebrow">Возможности</span>
      <h1>Всё, что нужно,<br /><em>чтобы увидеть щит.</em></h1>
      <p>Панель 36 помогает собрать понятную рабочую схему до выгрузки документации: от физической рейки до предварительной спецификации.</p>
    </section>

    <section class="feature-spec page-width" aria-labelledby="feature-spec-title">
      <div class="feature-spec-heading"><span class="eyebrow">Рабочая схема</span><h2 id="feature-spec-title">Панель — это не список деталей, а размещение.</h2></div>
      <div class="feature-spec-list">
        <article><span>01</span><div><h3>Корпуса и рейки</h3><p>Выбирайте встраиваемые и накладные корпуса. Для каждого корпуса доступны только совместимые рейки 12 или 18 модулей.</p></div><b>12 / 18 MOD</b></article>
        <article><span>02</span><div><h3>Физическая 2D-раскладка</h3><p>Модуль занимает реальные 18 мм. Занятые слоты, свободные интервалы и соседние устройства видны прямо на схеме.</p></div><b>18 MM</b></article>
        <article><span>03</span><div><h3>Каталог и инспектор</h3><p>Выбирайте устройства из каталога, настраивайте параметры и проверяйте, что находится в каждой позиции.</p></div><b>2D / BOM</b></article>
      </div>
    </section>

    <section class="feature-columns page-width" aria-label="Проверки и спецификация">
      <div class="feature-column feature-column-dark"><span class="eyebrow">Предварительно</span><h2>Проверки, которые видно сразу.</h2><p>Редактор подсвечивает занятые модули, конфликты компоновки и информационные замечания. Это не формальная сертификация и не замена проектной проверки.</p><RouterLink class="feature-link" to="/demo/project">Открыть DEMO-рабочую область →</RouterLink></div>
      <div class="feature-column feature-column-light"><span class="eyebrow">Спецификация</span><h2>Один взгляд на состав панели.</h2><p>BOM группирует устройства, показывает статус цены и источника, а экспорт сохраняет проект в понятном JSON-файле.</p><RouterLink class="feature-link" to="/demo/project">Попробовать DEMO →</RouterLink></div>
    </section>

    <section class="feature-local page-width" aria-labelledby="local-title">
      <div><span class="eyebrow">Локальный режим</span><h2 id="local-title">Ваши файлы остаются под контролем.</h2></div>
      <div class="local-points"><p><b>01</b> Проекты и тема сохраняются в localStorage этого браузера.</p><p><b>02</b> Импортированные GLB/glTF/ZIP остаются в IndexedDB и не отправляются на сервер.</p><p><b>03</b> JSON можно экспортировать для переноса или резервной копии.</p></div>
    </section>

    <section class="features-cta page-width"><div><h2>Соберите первую панель<br />и проверьте механику.</h2><RouterLink class="marketing-primary" to="/demo/project">Попробовать DEMO бесплатно</RouterLink></div></section>
  </div>
</template>

<style scoped>
.marketing-page { overflow: hidden; }.page-width { width: min(100% - 32px, 1120px); margin: 0 auto; }
.features-hero { padding: clamp(68px, 11vw, 140px) 0 clamp(64px, 9vw, 118px); }.features-hero h1 { margin-top: 14px; font-size: clamp(42px, 7vw, 78px); line-height: .98; letter-spacing: -.055em; }.features-hero h1 em { color: var(--accent); font-style: normal; }.features-hero p { max-width: 610px; margin-top: 24px; color: var(--text-muted); font-size: 15px; line-height: 1.7; }
.feature-spec { display: grid; grid-template-columns: .8fr 1.2fr; gap: 80px; padding: 80px 0; border-top: 1px solid var(--line); }.feature-spec-heading h2 { margin-top: 12px; font-size: 34px; line-height: 1.05; letter-spacing: -.035em; }.feature-spec-list { border-top: 1px solid var(--service); }.feature-spec-list article { display: grid; grid-template-columns: 44px 1fr auto; gap: 18px; align-items: start; padding: 24px 0; border-bottom: 1px solid var(--line); }.feature-spec-list article > span, .feature-spec-list article > b { color: var(--accent); font: 10px var(--mono); }.feature-spec-list article > b { color: var(--text-faint); font-weight: 500; white-space: nowrap; }.feature-spec-list h3 { color: var(--heading); font-size: 16px; }.feature-spec-list p { max-width: 480px; margin-top: 8px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
.feature-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-bottom: 110px; }.feature-column { min-height: 330px; display: flex; flex-direction: column; padding: 32px; }.feature-column-dark { background: var(--service); color: var(--on-service); }.feature-column-light { background: var(--accent-soft); color: var(--heading); }.feature-column h2 { max-width: 390px; margin-top: 42px; font-size: 30px; line-height: 1.05; letter-spacing: -.035em; }.feature-column p { max-width: 420px; margin-top: 16px; color: color-mix(in srgb, currentColor 68%, transparent); font-size: 12px; line-height: 1.65; }.feature-link { min-height: 44px; display: inline-flex; align-items: center; margin-top: auto; color: var(--accent); font-size: 12px; font-weight: 800; text-decoration: none; }
.feature-local { display: grid; grid-template-columns: .8fr 1.2fr; gap: 80px; padding: 76px 0; border-top: 1px solid var(--line); }.feature-local h2 { margin-top: 12px; font-size: 34px; line-height: 1.05; letter-spacing: -.035em; }.local-points { border-top: 1px solid var(--service); }.local-points p { display: grid; grid-template-columns: 35px 1fr; gap: 14px; padding: 20px 0; border-bottom: 1px solid var(--line); color: var(--text-muted); font-size: 12px; line-height: 1.6; }.local-points b { color: var(--accent); font: 10px var(--mono); }
.features-cta { padding: 80px 0 110px; }.features-cta > div { padding: 40px; border: 1px solid var(--service); background: var(--surface); }.features-cta h2 { margin-bottom: 26px; font-size: clamp(30px, 4vw, 48px); line-height: 1; letter-spacing: -.04em; }
@media (max-width: 760px) { .page-width { width: min(100% - 28px, 1120px); }.features-hero { padding-top: 60px; }.feature-spec, .feature-local { grid-template-columns: 1fr; gap: 34px; padding: 60px 0; }.feature-columns { grid-template-columns: 1fr; padding-bottom: 70px; }.feature-column { min-height: 290px; padding: 24px; }.features-cta { padding: 50px 0 80px; }.features-cta > div { padding: 24px; } }
</style>
