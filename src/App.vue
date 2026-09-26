<script setup lang="ts">
import { RouterView } from 'vue-router'
import DeviceFaceDefs from './components/catalog/DeviceFaceDefs.vue'
import ConfirmHost from './components/ui/ConfirmHost.vue'
</script>

<template>
  <DeviceFaceDefs />
  <RouterView />
  <ConfirmHost />
</template>
