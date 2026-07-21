<script setup lang="ts">
const props = withDefaults(defineProps<{ active?: number }>(), {active: 0})

const rows = [
  ['Typed call surface', 'generated', 'native', 'native'],
  ['Callbacks / remote refs', 'extra layer', 'yes', 'yes'],
  ['Runtime scope', 'transport-neutral', 'browser ports', 'adapter-based'],
  ['Validation / middleware', 'ecosystem', 'manual', 'optional'],
] as const

const tone = (value: string) => value === 'yes' || value === 'native' || value === 'optional'
  ? 'compare__yes'
  : value === 'browser ports' || value === 'transport-neutral' || value === 'adapter-based'
    ? 'compare__scope'
    : 'compare__no'
</script>

<template>
  <div class="compare">
    <div class="compare__cell compare__cell--head"></div>
    <div class="compare__cell compare__cell--head" :class="{'is-active': props.active === 1}">JSON-RPC</div>
    <div class="compare__cell compare__cell--head" :class="{'is-active': props.active === 2}">Comlink</div>
    <div class="compare__cell compare__cell--head" :class="{'is-active': props.active === 3}">kkRPC</div>
    <template v-for="row in rows" :key="row[0]">
      <div class="compare__cell compare__cell--label">{{ row[0] }}</div>
      <div v-for="(value, index) in row.slice(1)" :key="value" class="compare__cell" :class="[tone(value), {'is-active': props.active === index + 1}]">
        {{ value }}
      </div>
    </template>
  </div>
</template>
