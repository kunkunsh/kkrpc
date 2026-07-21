import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const projectUrl = new URL('../', import.meta.url);
const slides = await readFile(new URL('slides.md', projectUrl), 'utf8');

test('contains the 20-slide kkRPC narrative', () => {
  const slideIds = slides.match(/<!-- slide:\d{2} -->/g) ?? [];
  assert.equal(slideIds.length, 21);
  assert.match(slides, /One typed call\. Another runtime\./);
  assert.match(slides, /15 adapters/);
  assert.doesNotMatch(slides, /Welcome to Slidev/);
});

test('uses progressive developer-teaching features', () => {
  assert.match(slides, /twoslash/);
  assert.match(slides, /magic-move/);
  assert.match(slides, /v-mark/);
  assert.match(slides, /\[click\]/);
  assert.match(slides, /```mermaid/);
});

test('keeps the JSON-RPC qualifier and typed error example', () => {
  assert.match(slides, /raw JSON-RPC/i);
  assert.match(slides, /generated clients/i);
  assert.match(slides, /add\(1, "2"\)/);
  assert.match(slides, /Argument of type 'string'/);
});

test('does not render Vue markup as indented Markdown code after a fence', () => {
  assert.doesNotMatch(slides, /```\n\n {4,}<[^>]+>/);
});

test('defines typed progressive-visual component interfaces', async () => {
  const expected = new Map([
    ['DeckFrame.vue', []],
    ['FocusRing.vue', ['at', 'x', 'y', 'width', 'height']],
    ['ArchitectureRail.vue', ['activeStep']],
    ['RequestJourney.vue', ['step']],
    ['AdapterWall.vue', ['activeGroup']],
    ['ComparisonMatrix.vue', ['active']],
  ]);

  for (const [file, props] of expected) {
    const source = await readFile(new URL(`components/${file}`, projectUrl), 'utf8');
    assert.match(source, /<script setup lang="ts">/, `${file} must use typed script setup`);
    for (const prop of props)
      assert.match(source, new RegExp(`\\b${prop}\\b`), `${file} must expose ${prop}`);
  }

  const adapterWall = await readFile(new URL('components/AdapterWall.vue', projectUrl), 'utf8');
  for (const label of [
    'Web Worker', 'stdio', 'HTTP', 'WebSocket', 'Hono WS', 'Elysia WS',
    'iframe', 'Chrome extension', 'Electron', 'Tauri', 'Socket.IO',
    'RabbitMQ', 'Kafka', 'Redis Streams', 'NATS',
  ])
    assert.match(adapterWall, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
