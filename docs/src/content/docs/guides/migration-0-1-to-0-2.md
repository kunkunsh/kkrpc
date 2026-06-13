---
title: Migrate from v0.1.0 to v0.2.0
description: Move v0.1.0 code to v0.2.0's slim default core and opt-in streaming/remote-reference entries.
sidebar:
  order: 98
---

v0.2.0 keeps the stable `Transport<RPCMessage>` architecture but changes where advanced features live. The default `kkrpc` entry is now a slim core for ordinary request/response RPC. Async iterable streaming and request/response remote references moved to explicit subpath entries.

This guide is for code written against v0.1.0 behavior where streaming or remote references were available from the default `kkrpc` entry.

## What Changed

| Feature | v0.1.0 | v0.2.0 |
| --- | --- | --- |
| Ordinary RPC calls | `kkrpc` | `kkrpc` |
| Property get/set, constructors | `kkrpc` | `kkrpc` |
| Top-level progress callbacks | `kkrpc` | `kkrpc`, fire-and-forget only |
| Callback return values / thrown callback errors | default remote refs | `kkrpc/remote-refs` with `proxy(callback)` |
| Explicit object handles | `proxy(value)` from default entry | `proxy(value)` from `kkrpc/remote-refs` |
| Nested function leaves | automatic in remote-ref core | explicit `proxy(fn)` only in `kkrpc/remote-refs` |
| Async iterable arguments/results | default core | `kkrpc/streaming` |
| HTTP with callbacks/streams/refs | unsupported | clearly rejected before unsupported traffic starts |

## Quick Checklist

1. Leave ordinary request/response code on `kkrpc`.
2. Move async iterable APIs to `kkrpc/streaming` on both endpoints.
3. Move callback-return or object-handle APIs to `kkrpc/remote-refs` on both endpoints.
4. Wrap by-reference callbacks, returned functions, and object handles with `proxy()`.
5. Replace assumptions about automatic nested function refs with explicit `proxy(fn)` markers.
6. Keep HTTP value-only. Move callback, streaming, or remote-handle boundaries to WebSocket, Worker, stdio, iframe, Electron, Tauri, Socket.IO, or a supported message bus.
7. Update tests to import the feature entry that matches the behavior under test.

## Entry Point Changes

### Default Core

Use `kkrpc` for small, value-oriented RPC.

```ts
import { expose, wrap } from "kkrpc"

const controller = expose(api, transport)
const remote = wrap<RemoteAPI>(transport)
```

Default callback arguments are still useful for progress notifications:

```ts
await remote.processFile("input.dat", (percent) => {
	console.log(percent)
})
```

Do not rely on the callback return value in the default entry. The callback is invoked through a compact `t: "cb"` message and is fire-and-forget.

### Async Iterable Streaming

If a method returns or accepts `AsyncIterable`, import `wrap`, `expose`, or `RPCChannel` from `kkrpc/streaming` on both sides of the boundary.

```ts title="v0.1.0"
import { expose, wrap } from "kkrpc"
```

```ts title="v0.2.0"
import { expose, wrap } from "kkrpc/streaming"
```

The API shape can stay the same:

```ts
type LogAPI = {
	tail(service: string): AsyncIterable<string>
}

for await (const line of remote.tail("api")) {
	console.log(line)
}
```

`kkrpc/streaming` uses pull credit internally, so it avoids one round trip per chunk while still bounding buffered values.

### Remote References

If a callback return value matters, or if a value should cross the RPC boundary by reference, use `kkrpc/remote-refs`.

```ts title="v0.1.0"
import { expose, wrap } from "kkrpc"
```

```ts title="v0.2.0"
import { expose, proxy, releaseProxy, wrap } from "kkrpc/remote-refs"
```

Mark callback functions explicitly:

```ts title="v0.2.0 callback return value"
const result = await remote.useCallback(
	proxy(async (value) => {
		if (value === "bad") throw new Error("callback rejected")
		return `callback:${value}`
	})
)
```

Mark returned object handles explicitly:

```ts title="v0.2.0 returned handle"
class CounterHandle {
	value = 0

	increment(amount: number) {
		this.value += amount
		return this.value
	}
}

const api = {
	createCounter() {
		return proxy(new CounterHandle())
	}
}
```

Release long-lived remote proxies when their application lifetime ends:

```ts
const counter = await remote.createCounter()
console.log(await counter.increment(5))
await releaseProxy(counter)
```

## Nested Function Leaves Are Explicit

v0.2.0's remote-reference entry does not automatically proxy every unmarked nested function. Mark the specific function leaf that should remain callable remotely.

```ts title="v0.1.0 style"
return {
	message,
	hide: async () => `hidden:${message}`
}
```

```ts title="v0.2.0"
return {
	message,
	hide: proxy(async () => `hidden:${message}`)
}
```

This makes the by-reference boundary visible and keeps plain data as by-value data.

## HTTP Migration

HTTP remains unary request/response. It cannot support features that require later bidirectional traffic.

Unsupported over `kkrpc/http`:

- callback arguments
- async iterable streaming
- `kkrpc/remote-refs` handles
- server-initiated calls

If v0.1.0 code tried to use those patterns over HTTP, split the API:

- keep value-only calls on HTTP
- move progress, subscriptions, streams, or remote handles to WebSocket, Worker, stdio, iframe, Electron, Tauri, Socket.IO, or a message-bus transport

## Test Migration

Update tests to import the entry that matches the behavior:

```ts title="Streaming tests"
import { RPCChannel } from "kkrpc/streaming"
```

```ts title="Remote-reference tests"
import { RPCChannel, proxy, releaseProxy } from "kkrpc/remote-refs"
```

Keep default-core tests focused on ordinary calls, property access, transfer descriptors, plugins, and fire-and-forget top-level callbacks.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `RPC result is not async iterable` | Client used default `kkrpc` for a streaming method | Import from `kkrpc/streaming` on both sides |
| Callback result is `undefined` | Default callback arguments are fire-and-forget | Use `kkrpc/remote-refs` and pass `proxy(callback)` |
| Nested returned function is not callable remotely | Function was not explicitly marked | Wrap the function leaf with `proxy(fn)` |
| `RPC channel does not support remote references` | Remote refs entry used with a transport or channel that does not advertise support | Use a bidirectional object-mode transport and `kkrpc/remote-refs` on both endpoints |
| HTTP rejects callbacks, streams, or refs | HTTP is unary | Move that boundary to a bidirectional transport |

## Why This Change Exists

The default bundle had grown as streaming and remote-reference state machines were added directly to core. v0.2.0 moves those costs behind explicit entries.

Measured after the split:

| Bundle | Raw minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `kkrpc core` | 6.37 KB | 2.41 KB | 2.17 KB |
| `kkrpc/streaming` | 14.78 KB | 4.28 KB | 3.81 KB |
| `kkrpc/remote-refs` | 16.85 KB | 4.79 KB | 4.24 KB |

Use the smallest entry that matches the behavior you need.
