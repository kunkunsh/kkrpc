---
theme: seriph
title: kkRPC - Type-Safe Cross-Runtime RPC
info: |
  ## TypeScript-First RPC Library

  Seamless bi-directional communication between processes, workers, and contexts.

  Call remote functions as if they were local, with full TypeScript type safety.
class: text-center
drawings:
  persist: false
transition: slide-left
mdc: true
duration: 15min
---

# kkRPC

## Type-Safe Cross-Runtime RPC

Seamless bi-directional communication for TypeScript/JavaScript

<div @click="$slidev.nav.next" class="mt-12 py-1" hover:bg="white op-10">
  Press Space to continue <carbon:arrow-right />
</div>

<!--
Welcome! Today I'm going to show you kkRPC, a TypeScript-first RPC library that makes cross-context communication incredibly simple and type-safe.

If you've ever struggled with IPC in Electron, Tauri, Web Workers, or iframes - this is for you.
-->

---
transition: fade-out
---
# The Problem

## Cross-Context Communication is Painful

- **No Type Safety** - Event names as strings, manual parsing
- **Boilerplate Heavy** - Handlers for every single method
- **No Autocomplete** - Guess the API, check at runtime
- **Error Prone** - Easy to break, hard to refactor
- **Limited Features** - No nested APIs, no callbacks

<div class="mt-8 text-2xl text-red-400 font-bold">
  When you have hundreds of API calls, this becomes unmaintainable.
</div>

<!--
Let me paint a picture. You're building a desktop app with Electron. You need to communicate between the renderer and main process.

You end up with:
- String-based event names
- Manual message parsing
- No type checking
- Tons of boilerplate

And when your app grows to hundreds of API calls? Good luck maintaining that.
-->
