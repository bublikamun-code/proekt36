<script setup lang="ts">
/** One document-level gradient set shared by every device face, so 380 catalog rows cost nothing extra. */
const stop = (token: string) => ({ stopColor: `var(${token})` })
</script>

<template>
  <svg class="device-face-defs" aria-hidden="true" focusable="false" width="0" height="0">
    <defs>
      <linearGradient id="dv-shell" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" :style="stop('--dv-shell-1')" />
        <stop offset="0.13" :style="stop('--dv-shell-2')" />
        <stop offset="0.64" :style="stop('--dv-shell-3')" />
        <stop offset="1" :style="stop('--dv-shell-4')" />
      </linearGradient>
      <linearGradient id="dv-pocket" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :style="stop('--dv-pocket-1')" />
        <stop offset="0.55" :style="stop('--dv-pocket-2')" />
        <stop offset="1" :style="stop('--dv-pocket-3')" />
      </linearGradient>
      <linearGradient id="dv-toggle" x1="0" y1="0" x2="1" y2="0.2">
        <stop offset="0" :style="stop('--dv-toggle-1')" />
        <stop offset="0.32" :style="stop('--dv-toggle-2')" />
        <stop offset="1" :style="stop('--dv-toggle-3')" />
      </linearGradient>
      <linearGradient id="dv-lever" x1="0" y1="0" x2="1" y2="0.2">
        <stop offset="0" :style="stop('--dv-lever-1')" />
        <stop offset="0.32" :style="stop('--dv-lever-2')" />
        <stop offset="1" :style="stop('--dv-lever-3')" />
      </linearGradient>
      <linearGradient id="dv-window" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :style="stop('--dv-window-1')" />
        <stop offset="0.7" :style="stop('--dv-window-2')" />
      </linearGradient>
    </defs>
  </svg>
</template>
