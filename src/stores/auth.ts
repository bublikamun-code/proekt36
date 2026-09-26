import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { WorkspaceSession } from '../domain/auth'
import { demoAuth } from '../services/demoAuth'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<WorkspaceSession | null>(demoAuth.restore())
  const isUnlocked = computed(() => Boolean(session.value))
  const displayName = computed(() => session.value?.name || 'Гость')

  const signIn = async (email: string, password: string) => {
    session.value = await demoAuth.signIn(email, password)
  }

  const register = async (name: string, email: string, password: string) => {
    session.value = await demoAuth.register(name, email, password)
  }

  const continueLocally = async () => {
    session.value = await demoAuth.continueLocally()
  }

  const signOut = async () => {
    await demoAuth.signOut()
    session.value = null
  }

  return { session, isUnlocked, displayName, signIn, register, continueLocally, signOut }
})
