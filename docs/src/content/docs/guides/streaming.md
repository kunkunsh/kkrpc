---
title: Continuous Updates
description: Current stable options for progress, events, and chunked responses
sidebar:
  order: 6
---

Stable kkrpc is request/response with callback support. It does not currently define first-class remote iterator streaming or stream protocol messages in the stable wire protocol.

Until native streaming is added with protocol and test coverage, model continuous work explicitly with callbacks, evented transports, or chunked request methods.

## Progress Callbacks

Callbacks are the simplest way for a long-running RPC method to report progress to its caller.

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

When you need long-lived bidirectional updates, use WebSocket, Socket.IO, worker, iframe, or message-bus transports and expose explicit subscribe/unsubscribe methods in your API.
