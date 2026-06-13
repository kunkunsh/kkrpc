---
title: Continuous Updates
description: Async iterables, callbacks, events, and chunked responses
sidebar:
  order: 6
---

Stable kkrpc's default entry supports request/response calls and simple top-level callback arguments. First-class remote async iterables are opt-in via `kkrpc/streaming` so the default bundle stays small.

```ts
import { expose, wrap } from "kkrpc/streaming"
```

Use async iterables for windowed pull streams with backpressure. Use callbacks for simple progress notifications. Use chunked request methods for paginated data, especially over HTTP.

## Async Iterable Results

With the `kkrpc/streaming` entry, return an `AsyncIterable` or async generator from an exposed method. The remote caller can consume it directly with `for await`.

```ts
type API = {
	tailLogs(service: string): AsyncIterable<string>
}

const api: API = {
	async *tailLogs(service) {
		for await (const line of openLogTail(service)) {
			yield line
		}
	}
}
```

```ts
for await (const line of remote.tailLogs("worker")) {
	console.log(line)
	if (line.includes("ready")) break
}
```

The consumer controls backpressure: kkrpc grants the producer a bounded credit window and replenishes it as the consumer drains values. This avoids one round trip per chunk while still capping buffered values. If the consumer breaks early, kkrpc calls `return()` on the source iterator so generator `finally` blocks can release resources.

```ts
const iterator = remote.tailLogs("worker")[Symbol.asyncIterator]()

console.log(await iterator.next())
await iterator.return?.(undefined)
```

Errors thrown by the source iterator reject the remote `next()` call after any already-buffered values have been drained.

HTTP is still unary request/response and cannot continue a remote async iterator after the initial response. Use WebSocket, stdio, workers, iframes, desktop IPC, Socket.IO, or point-to-point message-bus transports for async iterable streams.

## Async Iterable Arguments

With the `kkrpc/streaming` entry, async iterables can also be passed as top-level method arguments over bidirectional transports.

```ts
type API = {
	sum(values: AsyncIterable<number>): Promise<number>
}

const total = await remote.sum((async function* () {
	yield 2
	yield 3
	yield 5
})())
```

## Progress Callbacks

Callbacks are the simplest way for a long-running RPC method to report progress to its caller. The default core callback path is fire-and-forget: callback return values are not propagated. If the remote side must await a callback return value or catch callback errors, use `kkrpc/remote-refs` and pass `proxy(callback)` instead.

```ts
type API = {
	processFile(path: string, onProgress: (percent: number) => void): Promise<{ outputPath: string }>
}

const api: API = {
	async processFile(path, onProgress) {
		for (let step = 1; step <= 10; step++) {
			await doWork(path, step)
			onProgress(step * 10)
		}
		return { outputPath: `${path}.out` }
	}
}
```

```ts
const result = await remote.processFile("input.dat", (percent) => {
	console.log(`progress: ${percent}%`)
})
```

## Explicit Chunking

For large result sets, expose page or cursor methods instead of returning an open-ended stream.

```ts
type API = {
	listItems(cursor?: string): Promise<{
		items: string[]
		nextCursor?: string
	}>
}

let cursor: string | undefined
do {
	const page = await remote.listItems(cursor)
	for (const item of page.items) console.log(item)
	cursor = page.nextCursor
} while (cursor)
```

## Evented Transports

When you need long-lived bidirectional updates, use WebSocket, Socket.IO, worker, iframe, or point-to-point message-bus transports and expose explicit subscribe/unsubscribe methods in your API. For RabbitMQ, Kafka, Redis Streams, and NATS, set `remotePeerId` so stream control (`t: "sq"`) and stream data (`t: "sr"`) envelopes are routed to one peer instead of broadcast to every consumer.
