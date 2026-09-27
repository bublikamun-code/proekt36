<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isPrivacy = computed(() => route.name === 'privacy')
</script>

<template>
  <div class="legal-page page-width">
    <header class="legal-header"><span class="eyebrow">Документ</span><h1>{{ isPrivacy ? 'Конфиденциальность' : 'Условия использования' }}</h1><p>Предварительная версия · 24 сентября 2026</p></header>

    <div v-if="isPrivacy" class="legal-content">
      <section><h2>Что хранится</h2><p>В текущей браузерной версии Панель 36 хранит проекты и настройки темы в localStorage этого браузера. Импортированные GLB/glTF/ZIP и другие пользовательские модели остаются в IndexedDB. Демо-сессия с именем и email хранится в sessionStorage.</p></section>
      <section><h2>Что не происходит</h2><p>Пользовательские модели не отправляются на сервер. Пароль в демо-входе не сохраняется и не используется для серверной авторизации. В этой версии нет серверной синхронизации, аналитики и платёжного обработчика.</p></section>
      <section><h2>Управление данными</h2><p>Проект можно экспортировать в JSON или удалить из рабочей области. Команда «Очистить локальные данные» удаляет проекты и импортированные модели из браузера после подтверждения. Очистка данных браузера также удаляет локальное состояние.</p></section>
      <section><h2>Перед публичным запуском</h2><p>Перед подключением серверных аккаунтов и синхронизации этот документ нужно дополнить оператором, контактом, основаниями обработки, сроками хранения и порядком удаления аккаунта.</p></section>
    </div>

    <div v-else class="legal-content">
      <section><h2>Статус продукта</h2><p>Панель 36 находится в предварительной стадии. Страницы тарифов, входа и регистрации демонстрируют будущую структуру продукта; платёжная обработка, серверная синхронизация и выдача entitlement пока не подключены.</p></section>
      <section><h2>Расчёты и проверки</h2><p>Стоимость BOM, масса, количество модулей, проверки компоновки и сообщения инспектора являются предварительными. Они не являются проектной документацией, разрешением на эксплуатацию, сертификатом или гарантией соответствия нормам.</p></section>
      <section><h2>Каталог и модели</h2><p>Серии и параметры, добавленные в каталог, должны иметь подтверждённый источник. Пользовательские модели импортируются локально; пользователь отвечает за права и корректность использования этих файлов.</p></section>
      <section><h2>Ответственность пользователя</h2><p>Перед изготовлением или эксплуатацией электрощита пользователь должен проверить проект, применить действующие нормы и получить необходимую профессиональную проверку. Перед публичным запуском здесь должны появиться реквизиты оператора и применимые юридические условия.</p></section>
    </div>
  </div>
</template>

<style scoped>
.legal-page { width: min(100% - 32px, 900px); margin: 0 auto; padding: clamp(60px, 10vw, 120px) 0 120px; }.legal-header { padding-bottom: 42px; border-bottom: 1px solid var(--service); }.legal-header h1 { margin-top: 12px; font-size: clamp(38px, 6vw, 66px); letter-spacing: -.05em; }.legal-header p { margin-top: 16px; color: var(--text-faint); font:var(--text-xs) var(--mono); }.legal-content { max-width: 760px; padding-top: 28px; }.legal-content section { padding: 27px 0; border-bottom: 1px solid var(--line); }.legal-content h2 { font-size: var(--text-lg); }.legal-content p { margin-top: 12px; color: var(--text-muted); font-size: var(--text-sm); line-height: 1.75; }
@media (max-width: 620px) { .legal-page { width: min(100% - 28px, 900px); padding: 55px 0 80px; }.legal-content p { font-size: var(--text-xs); } }
</style>
