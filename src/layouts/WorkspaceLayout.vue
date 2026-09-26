<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useProjectStore } from '../stores/project'

const store = useProjectStore()
const { toast } = storeToRefs(store)
</script>

<template>
  <RouterView />
  <Transition name="toast">
    <div
      v-if="toast"
      class="toast"
      :class="`toast-${toast.tone}`"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
    >
      <span>{{ toast.tone === 'error' ? '×' : '✓' }}</span>{{ toast.text }}
    </div>
  </Transition>
</template>
