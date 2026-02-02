---
transition: slide-up
layout: two-cols-header
layoutClass: gap-4
---

# Web Workers

> Message Passing Nightmare

::left::

### Manual postMessage

```ts
// main.ts
worker.postMessage({
	type: "add",
	data: [1, 2]
})

worker.onmessage = (e) => {
	if (e.data.type === "result") {
		console.log(e.data.result) // 3
	}
}
```

```ts
// worker.ts
self.onmessage = (e) => {
	if (e.data.type === "add") {
		const [a, b] = e.data.data
		self.postMessage({ type: "result", result: a + b })
	}
}
```

::right::

### Direct Function Calls

```ts
// main.ts
const api = rpc.getAPI()
const result = await api.add(1, 2) // 3
await api.math.grade1.add(2, 3) // Nested!
```

```ts
// worker.ts
const rpc = new RPCChannel(io, {
	expose: {
		add: (a, b) => a + b,
		math: { grade1: { add: (a, b) => a + b } }
	}
})
```

<v-click>
<div class="mt-4 p-4 bg-green-900/30 rounded-lg">
  <strong>Bidirectional:</strong> Worker can call main thread too!
</div>
</v-click>

<!--
Web Workers are powerful but the postMessage API is tedious. You have to:
- Define message types
- Parse messages manually
- Handle errors yourself
- No nested APIs

With kkRPC? Just call functions directly. And it's bidirectional - the worker can call methods exposed by the main thread too.
-->
