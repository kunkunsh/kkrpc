<script setup lang="ts">
withDefaults(defineProps<{
  at: number
  x: number
  y: number
  width: number
  height: number
  active?: boolean
  tone?: 'cyan' | 'purple' | 'green' | 'amber' | 'red'
}>(), {active: true, tone: 'cyan'})
</script>

<template>
  <div
    v-if="active"
    class="focus-ring"
    :class="`focus-ring--${tone}`"
    :data-click="at"
    :style="{left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`}"
  />
</template>
