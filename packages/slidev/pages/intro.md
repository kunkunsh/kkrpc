---
layout: image
image: https://imgur.com/19XswxO.jpg
backgroundSize: contain
transition: slide-left
---

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

---
image: https://imgur.com/vR3Lmv0.png
backgroundSize: 30em
layout: two-cols-header
layoutClass: gap-4
transition: slide-right
---

# Environments

::left::

<div class="flex items-center justify-center h-full">
  <img src="https://imgur.com/vR3Lmv0.png" style="max-height: 200px;">
</div>

::right::

<div class="flex items-center justify-center h-full">
  <img src="https://i.imgur.com/zmOHNfu.png" style="max-height: 250px;">
</div>

---
transition: slide-right
layout: center
class: text-center
---

# Browser

<div class="flex items-center justify-center h-full">
  <img src="https://i.imgur.com/Gu7jH1v.png" style="max-height: 450px;">
</div>

---
transition: slide-right
layout: center
class: text-center
---

# Kunkun

<div class="flex items-center justify-center h-full">
  <img src="https://imgur.com/u728aVv.png" style="max-height: 400px;">
</div>
