<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { safeInternalPath } from '../../domain/auth'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const name = ref('')
const email = ref('')
const password = ref('')
const confirmation = ref('')
const pending = ref(false)
const error = ref('')
const returnTo = computed(() => safeInternalPath(route.query.redirect))

const submit = async () => {
  pending.value = true
  error.value = ''
  try {
    if (password.value !== confirmation.value) throw new Error('Пароли не совпадают')
    await auth.register(name.value, email.value, password.value)
    await router.push(returnTo.value)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Не удалось создать локальный профиль'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card auth-card-wide">
      <div class="auth-heading"><span class="eyebrow">Демо-профиль</span><h1>Создать профиль</h1><p>Это локальная демо-регистрация. Она не создаёт серверный аккаунт и не активирует платный тариф.</p></div>
      <form class="auth-form" @submit.prevent="submit">
        <label>Имя<input v-model="name" type="text" autocomplete="name" placeholder="Как к вам обращаться" minlength="2" required /></label>
        <label>Email<input v-model="email" type="email" autocomplete="email" placeholder="name@example.com" required /></label>
        <label>Пароль<input v-model="password" type="password" autocomplete="new-password" minlength="6" placeholder="Не менее 6 символов" required /></label>
        <label>Повторите пароль<input v-model="confirmation" type="password" autocomplete="new-password" minlength="6" placeholder="Ещё раз" required /></label>
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <button class="auth-submit" type="submit" :disabled="pending">{{ pending ? 'Создаём…' : 'Создать demo-профиль' }}</button>
      </form>
      <p class="auth-note">Имя и email остаются только в sessionStorage. Пароль используется для проверки формы и никуда не отправляется.</p>
      <p class="auth-switch">Уже есть профиль? <RouterLink to="/login">Войти</RouterLink></p>
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
.auth-card-wide {
  width: min(100%, 520px);
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
  gap: 13px;
  margin-top: 28px;
}
.auth-form label {
  gap: 7px;
}
.auth-form input {
  min-height: 44px;
  font-size: var(--text-sm);
}
.auth-submit {
  width: 100%;
  min-height: 46px;
  margin-top: 3px;
  background: var(--service);
  color: var(--on-service);
  border-color: var(--service);
  font-size: var(--text-xs);
  font-weight: 800;
}
.auth-submit:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
}
.auth-error {
  padding: 9px 11px;
  background: var(--error-soft);
  color: var(--error);
  font-size: var(--text-xs);
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
