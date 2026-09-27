<script setup lang="ts">
import { plans } from '../content/plans'
</script>

<template>
  <div class="marketing-page pricing-page">
    <section class="pricing-hero page-width">
      <span class="eyebrow">Тарифы</span>
      <h1>Начните локально.<br /><em>Добавьте синхронизацию, когда она будет готова.</em></h1>
      <p>Ниже — предварительная структура тарифов для проверки продукта. Серверная синхронизация, оплата и entitlement ещё не подключены.</p>
    </section>

    <section class="pricing-table page-width" aria-label="Сравнение тарифов">
      <div v-for="plan in plans" :key="plan.id" class="pricing-plan" :class="{ featured: plan.featured }">
        <div class="pricing-plan-head"><span class="pricing-status">{{ plan.id === 'start' ? 'Доступен сейчас' : 'Предварительный план' }}</span><h2>{{ plan.name }}</h2><p>{{ plan.note }}</p></div>
        <div class="pricing-price"><strong>{{ plan.price }}</strong><span>{{ plan.period }}</span></div>
        <ul><li v-for="feature in plan.features" :key="feature">{{ feature }}</li></ul>
        <RouterLink class="pricing-cta" :to="plan.to">{{ plan.cta }}</RouterLink>
      </div>
    </section>

    <section class="pricing-note page-width" aria-labelledby="pricing-note-title">
      <div><span class="eyebrow">Важно</span><h2 id="pricing-note-title">Это страница продукта, а не платёжный терминал.</h2></div>
      <p>Цены 990 ₽ и 2 490 ₽ — предварительные демонстрационные значения. Они не создают долг, не активируют подписку и не являются публичной офертой. После подключения backend здесь появятся реальные возможности, лимиты, оплата, отмена и история платежей.</p>
    </section>

    <section class="pricing-faq page-width" aria-labelledby="faq-title">
      <div class="pricing-faq-title"><span class="eyebrow">Коротко</span><h2 id="faq-title">Что уже работает</h2></div>
      <div class="pricing-faq-list"><details open><summary>Можно ли работать без аккаунта?</summary><p>Да. На странице входа есть «Продолжить локально», а на лендинге — отдельный DEMO-предпросмотр без аккаунта.</p></details><details><summary>Что будет после подключения сервера?</summary><p>Demo-сессия заменится серверной сессией, а локальное хранилище — синхронизацией проектов с правами доступа. Миграция не потребует переписывать 2D-редактор.</p></details><details><summary>Стоимость BOM — это стоимость подписки?</summary><p>Нет. Стоимость BOM — ориентировочная сумма устройств в проекте. Тарифы Панель 36 относятся только к самому программному продукту.</p></details></div>
    </section>
  </div>
</template>

<style scoped>
.marketing-page { overflow: hidden; }.page-width { width: min(100% - 32px, 1120px); margin: 0 auto; }
.pricing-hero { padding: clamp(68px, 11vw, 140px) 0 72px; }.pricing-hero h1 { max-width: 900px; margin-top: 14px; font-size: clamp(40px, 6.4vw, 74px); line-height: .98; letter-spacing: -.055em; }.pricing-hero h1 em { color: var(--accent); font-style: normal; }.pricing-hero p { max-width: 600px; margin-top: 24px; color: var(--text-muted); font-size: var(--text-base); line-height: 1.7; }
.pricing-table { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: stretch; padding-bottom: 100px; }.pricing-plan { display: flex; flex-direction: column; min-height: 480px; padding: 24px; border: 1px solid var(--line); background: var(--surface); }.pricing-plan.featured { border-color: var(--service); box-shadow: 8px 8px 0 var(--accent-soft); }.pricing-status { color: var(--accent); font:var(--text-micro) var(--mono); text-transform: uppercase; }.pricing-plan h2 { margin-top: 25px; font-size: var(--text-xl); }.pricing-plan-head p { min-height: 34px; margin-top: 8px; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.45; }.pricing-price { display: flex; align-items: baseline; gap: 8px; margin-top: 28px; padding: 22px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }.pricing-price strong { color: var(--heading); font:700 var(--text-3xl) var(--mono); letter-spacing: -.06em; }.pricing-price span { color: var(--text-muted); font-size: var(--text-xs); }.pricing-plan ul { display: grid; gap: 12px; margin: 23px 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--text-xs); }.pricing-plan li::before { content: '—'; margin-right: 8px; color: var(--accent); }.pricing-cta { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; margin-top: auto; border: 1px solid var(--service); color: var(--service); font-size: var(--text-xs); font-weight: 800; text-decoration: none; }.pricing-cta:hover { background: var(--service); color: var(--on-service); }.featured .pricing-cta { background: var(--service); color: var(--on-service); }.featured .pricing-cta:hover { background: var(--accent); border-color: var(--accent); }
.pricing-note { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; padding: 64px 0; border-top: 1px solid var(--line); }.pricing-note h2 { margin-top: 12px; font-size: var(--text-3xl); line-height: 1.05; letter-spacing: -.035em; }.pricing-note > p { color: var(--text-muted); font-size: var(--text-sm); line-height: 1.7; }
.pricing-faq { display: grid; grid-template-columns: .7fr 1.3fr; gap: 80px; padding: 72px 0 120px; border-top: 1px solid var(--line); }.pricing-faq h2 { margin-top: 12px; font-size: var(--text-3xl); line-height: 1.05; }.pricing-faq-list details { border-bottom: 1px solid var(--line); }.pricing-faq-list summary { min-height: 58px; display: flex; align-items: center; cursor: pointer; list-style: none; color: var(--heading); font-size: var(--text-sm); font-weight: 800; }.pricing-faq-list summary::after { content: '+'; margin-left: auto; color: var(--accent); font:var(--text-lg) var(--mono); }.pricing-faq-list details[open] summary::after { content: '−'; }.pricing-faq-list p { max-width: 600px; padding: 0 34px 18px 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6; }
@media (max-width: 800px) { .pricing-table { grid-template-columns: 1fr; }.pricing-plan { min-height: 0; }.pricing-plan.featured { box-shadow: 5px 5px 0 var(--accent-soft); }.pricing-note, .pricing-faq { grid-template-columns: 1fr; gap: 30px; padding: 54px 0; }.pricing-faq { padding-bottom: 80px; } }
@media (max-width: 520px) { .page-width { width: min(100% - 28px, 1120px); }.pricing-hero { padding-top: 58px; }.pricing-hero h1 { font-size: var(--text-4xl); } }
</style>
