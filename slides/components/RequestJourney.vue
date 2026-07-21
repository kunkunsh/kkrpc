<script setup lang="ts">
const props = withDefaults(defineProps<{ step?: number }>(), {step: 0})

const steps = [
  {id: 'proxy', label: 'Proxy', detail: 'records path + call', value: 'math.add'},
  {id: 'pending', label: 'Channel', detail: 'stores resolver', value: 'pending[id]'},
  {id: 'transport', label: 'Transport', detail: 'sends request', value: '{ t: q }'},
  {id: 'execute', label: 'Exposed API', detail: 'runs add(1, 2)', value: '1 + 2'},
  {id: 'response', label: 'Response', detail: 'returns id + value', value: '{ t: r, v: 3 }'},
  {id: 'resolve', label: 'Promise', detail: 'resolves at caller', value: '3'},
] as const
</script>

<template>
  <div class="journey">
    <article
      v-for="(item, index) in steps"
      :key="item.id"
      class="journey__step"
      :class="{'is-reached': props.step >= index + 1, 'is-active': props.step === index + 1}"
    >
      <div class="journey__number">0{{ index + 1 }}</div>
      <div class="journey__label">{{ item.label }}</div>
      <div class="journey__detail">{{ item.detail }}</div>
      <div class="journey__value">{{ item.value }}</div>
    </article>
  </div>
</template>
