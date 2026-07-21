<script setup lang="ts">
const props = withDefaults(defineProps<{
  activeGroup?: 'browser' | 'process' | 'network' | 'desktop' | 'bus' | 'all'
}>(), {activeGroup: 'all'})

const adapters = [
  ['Web Worker', 'worker.svg', 'browser'],
  ['stdio', 'stdio.svg', 'process'],
  ['HTTP', 'http.svg', 'network'],
  ['WebSocket', 'websocket.svg', 'network'],
  ['Hono WS', 'hono.svg', 'network'],
  ['Elysia WS', 'elysia.svg', 'network'],
  ['iframe', 'iframe.svg', 'browser'],
  ['Chrome extension', 'chrome.svg', 'browser'],
  ['Electron', 'electron.svg', 'desktop'],
  ['Tauri', 'tauri.svg', 'desktop'],
  ['Socket.IO', 'socketio.svg', 'network'],
  ['RabbitMQ', 'rabbitmq.svg', 'bus'],
  ['Kafka', 'kafka.svg', 'bus'],
  ['Redis Streams', 'redis.svg', 'bus'],
  ['NATS', 'nats.svg', 'bus'],
] as const

const groups = ['browser', 'process', 'network', 'desktop', 'bus'] as const
const groupIndex = (group: string) => groups.indexOf(group as typeof groups[number])
const isVisible = (group: string) => props.activeGroup === 'all' || groupIndex(group) <= groupIndex(props.activeGroup)
</script>

<template>
  <div>
    <div class="adapter-wall">
      <article
        v-for="adapter in adapters"
        :key="adapter[0]"
        class="adapter-card"
        :class="{'is-active': isVisible(adapter[2]), 'is-current': props.activeGroup === adapter[2] || props.activeGroup === 'all'}"
      >
        <img :src="`/icons/${adapter[1]}`" :alt="`${adapter[0]} icon`">
        <span class="adapter-card__label">{{ adapter[0] }}</span>
      </article>
    </div>
    <div class="adapter-wall__legend">
      <span v-for="group in groups" :key="group">{{ group }}</span>
    </div>
  </div>
</template>
