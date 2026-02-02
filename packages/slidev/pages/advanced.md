---
transition: slide-up
layout: two-cols-header
layoutClass: gap-4
---

# Advanced Features

## Nested APIs + Callbacks

::left::

```ts
// Define nested API
type API = {
	math: {
		grade1: { add(a: number, b: number): Promise<number> }
		grade2: { multiply(a: number, b: number): Promise<number> }
	}
	calculate(n: number, onProgress: (p: number) => void): Promise<number>
}

const rpc = new RPCChannel<{}, API>(io)
const api = rpc.getAPI()

// Nested method call
const result = await api.math.grade2.multiply(4, 5)

// With callback
await api.calculate(100, (progress) => {
	console.log(`${progress}% complete`)
})
```

::right::

<div class="p-3 bg-purple-900/20 rounded-lg">
<h3 class="text-base font-bold text-purple-400">Nested APIs</h3>
<p class="text-sm">Organize your API hierarchically</p>
</div>

<div class="p-3 bg-cyan-900/20 rounded-lg mt-3">
<h3 class="text-base font-bold text-cyan-400">Callbacks</h3>
<p class="text-sm">Pass functions as parameters for progress updates</p>
</div>

<div class="p-3 bg-blue-900/20 rounded-lg mt-3">
<h3 class="text-base font-bold text-blue-400">Property Access</h3>
<p class="text-sm"><code>await api.config.theme</code> works too!</p>
</div>

<!--
Some advanced features that set kkRPC apart.

Nested APIs - organize your API hierarchically.

Callbacks - pass functions as parameters for progress updates.

Property access - you can even await remote properties like they're local.

These features make kkRPC feel like you're calling local code, not remote.
-->
