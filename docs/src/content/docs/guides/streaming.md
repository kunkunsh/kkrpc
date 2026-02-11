---
title: Streaming
description: Stream data with AsyncIterable — yield values from async generators and consume them with for-await-of
sidebar:
  order: 6
---

kkrpc supports first-class streaming via `AsyncIterable`. If an RPC method returns an `AsyncIterable` (e.g. an async generator), the values are streamed chunk-by-chunk to the consumer.

## How It Works

1. An RPC method returns an `AsyncIterable` (typically an async generator)
2. kkrpc detects the `AsyncIterable` and enters streaming mode
3. Each `yield`ed value is sent as a **stream-chunk** message to the consumer
4. The consumer receives an `AsyncIterable` and reads chunks with `for await...of`
5. When the generator completes, kkrpc sends a **stream-end** message
6. If the generator throws, kkrpc sends a **stream-error** message
7. If the consumer `break`s out of the loop, kkrpc sends a **stream-cancel** message back to stop production

## Basic Usage

```ts
// Server: return an async generator
const api = {
	async *countdown(from: number) {
		for (let i = from; i >= 0; i--) {
			yield i
		}
	}
}

new RPCChannel(io, { expose: api })
```

```ts
// Client: consume with for-await-of
const api = rpc.getAPI()

for await (const n of await api.countdown(5)) {
	console.log(n) // 5, 4, 3, 2, 1, 0
}
```

## Consumer Cancellation

Breaking out of the loop automatically sends a cancel signal to the producer:

```ts
const api = {
	async *watchFiles(path: string) {
		const watcher = fs.watch(path)
		try {
			for await (const event of watcher) {
				yield event
			}
		} finally {
			watcher.close() // Cleanup runs when consumer cancels
		}
	}
}
```

```ts
for await (const event of await api.watchFiles("/tmp")) {
	console.log(event)
	if (shouldStop) break // sends stream-cancel, producer's finally{} runs
}
```

## Error Propagation

If the producer throws, the error is serialized and delivered to the consumer:

```ts
const api = {
	async *failingStream() {
		yield 1
		yield 2
		throw new Error("something went wrong")
	}
}
```

```ts
try {
	for await (const n of await api.failingStream()) {
		console.log(n) // 1, 2
	}
} catch (error) {
	console.log(error.message) // "something went wrong"
}
```

## Concurrent Streams

Multiple streams can run simultaneously over the same channel:

```ts
const [stream1, stream2] = await Promise.all([api.countdown(5), api.countdown(3)])

// Consume concurrently
await Promise.all([
	(async () => {
		for await (const n of stream1) {
			/* ... */
		}
	})(),
	(async () => {
		for await (const n of stream2) {
			/* ... */
		}
	})()
])
```

## Nested Methods

Streaming works with nested API methods:

```ts
const api = {
	data: {
		async *stream(count: number) {
			for (let i = 0; i < count; i++) {
				yield `item-${i}`
			}
		}
	}
}

for await (const item of await api.data.stream(3)) {
	console.log(item) // "item-0", "item-1", "item-2"
}
```

## With Interceptors

Interceptors wrap the handler call (which returns the `AsyncIterable`) — not each individual chunk:

```ts
const logger: RPCInterceptor = async (ctx, next) => {
	console.log(`stream started: ${ctx.method}`)
	const result = await next() // returns the AsyncIterable
	console.log(`stream created: ${ctx.method}`)
	return result
}
```

## Protocol Details

The streaming protocol adds four message types:

| Message Type    | Direction           | Purpose                          |
| --------------- | ------------------- | -------------------------------- |
| `stream-chunk`  | Producer → Consumer | Carries a yielded value          |
| `stream-end`    | Producer → Consumer | Stream completed normally        |
| `stream-error`  | Producer → Consumer | Stream failed with an error      |
| `stream-cancel` | Consumer → Producer | Stop producing (sent on `break`) |

The initial response is a regular `response` message with `{ __stream: true }` which tells the consumer to expect stream messages. This keeps backward compatibility — older consumers that don't understand streaming will receive the marker object as the result.

## No Streaming (backward compatible)

```ts
// Existing code works exactly as before — methods that don't return
// AsyncIterable continue to work as normal request/response
new RPCChannel(io, { expose: api })
```
