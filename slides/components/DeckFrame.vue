<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow: string
  title: string
  subtitle?: string
  chapter?: string
  page?: string
}>(), {
  subtitle: '',
  chapter: 'kkRPC',
  page: '',
})
</script>

<template>
  <section class="deck-frame">
    <div class="deck-frame__topline">
      <span class="deck-frame__eyebrow">{{ eyebrow }}</span>
      <span class="deck-frame__chapter">{{ chapter }}</span>
    </div>
    <h1 class="deck-frame__title">{{ title }}</h1>
    <p v-if="subtitle" class="deck-frame__subtitle">{{ subtitle }}</p>
    <div class="deck-frame__body"><slot /></div>
    <div class="deck-frame__footer">
      <span>one typed call · another runtime</span>
      <span>{{ page }}</span>
    </div>
  </section>
</template>
