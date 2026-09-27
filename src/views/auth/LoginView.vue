<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { safeInternalPath } from '../../domain/auth'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const pending = ref(false)
const error = ref('')
const returnTo = computed(() => safeInternalPath(route.query.redirect))

const submit = async () => {
  pending.value = true
  error.value = ''
  try {
    await auth.signIn(email.value, password.value)
    await router.push(returnTo.value)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Не удалось открыть демо-сессию'
  } finally {
    pending.value = false
  }
}

const continueLocally = async () => {
  pending.value = true
  await auth.continueLocally()
  await router.push(returnTo.value)
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-heading"><span class="eyebrow">Рабочая область</span><h1>Войти в Панель 36</h1><p>Локальный демо-вход для просмотра проектов и редактора.</p></div>
      <form class="auth-form" @submit.prevent="submit">
        <label>Email<input v-model="email" type="email" autocomplete="email" placeholder="name@example.com" required /></label>
        <label>Пароль<input v-model="password" type="password" autocomplete="current-password" minlength="6" placeholder="Не менее 6 символов" required /></label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="auth-submit" type="submit" :disabled="pending">{{ pending ? 'Открываем…' : 'Войти в демо' }}</button>
      </form>
      <div class="auth-divider"><span>или</span></div>
      <button class="auth-guest" :disabled="pending" @click="continueLocally">Продолжить локально</button>
      <p class="auth-note">Демо-режим: email и имя остаются только в sessionStorage. Пароль не отправляется и не сохраняется.</p>
      <p class="auth-switch">Нет demo-профиля? <RouterLink to="/register">Создать локальный профиль</RouterLink></p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - 66px);
  display: grid;
  place-items: center;
  padding: 48px 16px 80px;
  background: linear-gradient(90deg, transparent 49.9%, var(--line-soft) 50%, transparent 50.1%), var(--canvas);
  background-size: 80px 80px;
}
.auth-card {
  width: min(100%, 460px);
  padding: 34px;
  background: var(--surface-raised);
  border: 1px solid var(--service);
  box-shadow: 9px 9px 0 var(--accent-soft);
}
.auth-heading h1 {
  margin-top: 9px;
  font-size: var(--text-2xl);
  letter-spacing: -.04em;
}
.auth-heading p {
  margin-top: 12px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.55;
}
.auth-form {
  display: grid;
  gap: 15px;
  margin-top: 28px;
}
.auth-form label {
  gap: 7px;
}
.auth-form input {
  min-height: 44px;
  font-size: var(--text-sm);
}
.auth-submit,
.auth-guest {
  width: 100%;
  min-height: 46px;
  font-size: var(--text-xs);
  font-weight: 800;
}
.auth-submit {
  background: var(--service);
  color: var(--on-service);
  border-color: var(--service);
}
.auth-submit:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
}
.auth-guest {
  background: transparent;
}
.auth-error {
  padding: 9px 11px;
  background: var(--error-soft);
  color: var(--error);
  font-size: var(--text-xs);
}
.auth-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 22px 0 14px;
  color: var(--text-faint);
  font:var(--text-micro) var(--mono);
}
.auth-divider::before,
.auth-divider::after {
  content: '';
  height: 1px;
  flex: 1;
  background: var(--line);
}
.auth-note {
  margin-top: 18px;
  color: var(--text-faint);
  font:var(--text-micro)/1.55 var(--mono);
}
.auth-switch {
  margin-top: 24px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-align: center;
}
.auth-switch a {
  color: var(--accent);
  font-weight: 800;
}
@media (max-width: 620px) {
  .auth-page {
    min-height: calc(100vh - 58px);
    padding: 32px 14px 56px;
    background-size: 48px 48px;
  }
  .auth-card {
    padding: 24px 20px;
    box-shadow: 6px 6px 0 var(--accent-soft);
  }
}
</style>
