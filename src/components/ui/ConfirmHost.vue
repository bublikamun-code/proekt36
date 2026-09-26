<script setup lang="ts">
import AppDialog from './AppDialog.vue'
import { resolveConfirm, useConfirm } from '../../composables/useConfirm'

const { confirmState } = useConfirm()
</script>

<template>
  <AppDialog
    :open="confirmState.open"
    :title="confirmState.title"
    :description="confirmState.description"
    @close="resolveConfirm(false)"
  >
    <div class="app-dialog-actions">
      <button type="button" @click="resolveConfirm(false)">{{ confirmState.cancelLabel }}</button>
      <button
        type="button"
        :class="{ 'danger-button': confirmState.danger }"
        @click="resolveConfirm(true)"
      >{{ confirmState.confirmLabel }}</button>
    </div>
  </AppDialog>
</template>
