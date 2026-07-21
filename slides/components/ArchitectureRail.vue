<script setup lang="ts">
const props = withDefaults(defineProps<{ activeStep?: number }>(), {activeStep: 0})

const nodes = [
  {label: 'Web UI', icon: '▣', detail: 'typed call in a browser surface'},
  {label: 'Rust host', icon: '◇', detail: 'owns permissions and process I/O'},
  {label: 'Plugin runtime', icon: '⌁', detail: 'Deno, Node, Worker, or iframe'},
] as const
</script>

<template>
  <div class="arch-rail">
    <template v-for="(node, index) in nodes" :key="node.label">
      <article class="arch-rail__node" :class="{'is-active': props.activeStep === index + 1}">
        <div class="arch-rail__icon">{{ node.icon }}</div>
        <div class="arch-rail__label">{{ node.label }}</div>
        <div class="arch-rail__detail">{{ node.detail }}</div>
      </article>
      <div
        v-if="index < nodes.length - 1"
        class="arch-rail__edge"
        :class="{'is-active': props.activeStep > index + 1}"
      />
    </template>
  </div>
</template>
