---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---

# vs Alternatives

## How kkRPC Compares

::left::

### tRPC

- Great for HTTP APIs
- HTTP only
- Client calls server only
- No callbacks

### Comlink

- Good for Workers
- Browser only
- No stdio/HTTP support

::right::

### kkRPC

- **15+ transports** (stdio, HTTP, WS, postMessage...)
- **Bidirectional** - both sides call each other
- **Cross-runtime** (Node, Deno, Bun, Browser)
- **Callbacks** supported
- **Nested APIs**
- **Error preservation**

<v-click>
<div class="mt-6 p-4 bg-green-900/30 rounded-lg">
<strong>Choose kkRPC when:</strong> You need type-safe IPC across different contexts and runtimes.
</div>
</v-click>

<!--
How does kkRPC compare to alternatives?

tRPC is excellent for HTTP APIs but it's HTTP-only and unidirectional.

Comlink is great for Web Workers but limited to browsers.

kkRPC gives you the best of both - any transport, bidirectional, cross-runtime.

Choose kkRPC when you need flexible, type-safe IPC across different contexts.
-->
