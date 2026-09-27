<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <div class="brand" :class="{ compact }" aria-label="Панель 36">
    <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M8 8h7v7H8zm9 0h7v7h-7zM8 17h7v7H8z" fill="currentColor" />
      <path d="M19 17h4v7h-4z" fill="var(--accent)" />
    </svg>
    <span v-if="!compact">Панель <b>36</b></span>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--service);
  font-weight: 800;
  font-size: var(--text-base);
  white-space: nowrap;
  letter-spacing: 0;
}
.brand b {
  color: var(--accent);
}
.brand-mark {
  width: 27px;
  height: 27px;
  flex: none;
}
.compact .brand-mark {
  width: 25px;
  height: 25px;
}
</style>
