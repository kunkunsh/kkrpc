---
title: Remote References
description: Pass callback functions and explicit object proxies across bidirectional kkrpc transports.
sidebar:
  order: 7
---

Remote references are opt-in. Import from `kkrpc/remote-refs` when you want values marked with `proxy(value)` to cross a bidirectional transport by reference while ordinary data continues to cross by value.

```ts
import { proxy, releaseProxy, wrap } from "kkrpc/remote-refs"
```

Use remote references for callbacks whose return values matter, returned handles with methods, and intentionally long-lived remote objects.

## What Remote References Are

Remote references are lightweight handles to values that stay owned by the endpoint that created them. When the other endpoint calls a referenced function or method, kkrpc sends a follow-up request back to the owner and resolves or rejects the original local call from the remote result.

This is different from serializing a value. The referenced function or object does not move across the transport; only a handle crosses the boundary.

## Explicit Function References

Plain objects still cross by value. If you want a nested function to remain callable by reference, mark that function with `proxy()` before returning or passing it.

```ts
type Toast = {
	message: string
	hide(): Promise<string>
}

const api = {
	createToast(message: string): Toast {
		return {
			message,
			hide: proxy(async () => `hidden:${message}`)
		}
	}
}
```

```ts
const toast = await remote.createToast("hello")

console.log(toast.message) // "hello" was copied by value
console.log(await toast.hide()) // hide() calls back to the original endpoint
```

This keeps object-shaped return values convenient without turning every object into a live remote proxy. Unmarked function values are rejected by the remote-reference entry instead of being passed by raw same-process identity; mark each by-reference function with `proxy(fn)`.

## Callback Return Values

Callbacks marked with `proxy()` use request/response semantics. If the remote endpoint calls your callback, kkrpc waits for the callback result and propagates returned values or thrown errors.

```ts
const result = await remote.useCallback(
	proxy(async (value) => {
		if (value === "bad") throw new Error("callback rejected")
		return `callback:${value}`
	})
)

console.log(result)
```

Returned callback values resolve on the caller side. Errors thrown by the callback reject the remote call with the preserved RPC error. For simple fire-and-forget progress notifications, the default core entry still supports top-level callback arguments without the remote-reference runtime.

## Explicit Object Proxies

Objects are copied by value unless you intentionally mark them with `proxy()`. Use this for long-lived handles where identity and methods matter, such as counters, subscriptions, or resources that should remain owned by one endpoint.

```ts
import { proxy } from "kkrpc/remote-refs"

class CounterHandle {
	#value = 0

	get(): number {
		return this.#value
	}

	add(amount: number): number {
		this.#value += amount
		return this.#value
	}
}

const api = {
	createCounter() {
		return proxy(new CounterHandle())
	}
}
```

On the consuming side, treat an explicit object proxy as a remote async handle. Property reads require `await`, and method calls are remote async calls that return promises even when the owner implementation is synchronous.

```ts
type CounterHandle = {
	value: Promise<number>
	get(): Promise<number>
	add(amount: number): Promise<number>
}

const counter = await api.createCounter()

console.log(await counter.value)
console.log(await counter.get())
console.log(await counter.add(5))
```

Direct property assignment sends an asynchronous `set` request to the owner endpoint:

```ts
counter.value = 10
```

The JavaScript assignment expression itself cannot be awaited and does not surface owner-side assignment errors. Prefer explicit setter methods when the caller must observe validation failures or completion:

```ts
await counter.setValue(10)
```

Treat explicit object proxies as an API design decision, not as a serialization shortcut. Do not proxy DOM events, DOM nodes, request objects, host internals, or other sensitive capability-bearing objects unless the trust boundary is explicitly designed for that exposure.

Remote proxies belong to the channel that decoded them. Do not pass a remote proxy obtained from one channel through a different channel as if it were a portable capability; kkrpc rejects that cross-channel pass-through with a clear error. If you need to bridge capabilities between endpoints, expose an explicit method that owns the forwarding policy.

## Cleanup

Call `releaseProxy()` when you are done with long-lived remote handles. Releasing tells the owner endpoint that the remote reference can be discarded.

```ts
import { releaseProxy } from "kkrpc/remote-refs"

const counter = await api.createCounter()
console.log(await counter.add(5))

await releaseProxy(counter)
```

Returned proxied function leaves are remote proxies too. You can release them directly when the function itself has a shorter lifetime than the object that contained it.

```ts
const toast = await api.createToast("hello")
await toast.hide()
await releaseProxy(toast.hide)
```

`releaseProxy()` is safe to call for values that are not remote proxies. When a channel is no longer needed, `channel.destroy()` cleans up references owned by that channel and closes the transport subscription.

```ts
channel.destroy()
```

Prefer explicit `releaseProxy()` for application-level lifetimes and `channel.destroy()` for endpoint teardown.

## Transport Support

Remote references require bidirectional transports because later function and method calls must travel back to the endpoint that owns the original value.

Supported bidirectional transports include workers, iframes, WebSocket, stdio, Electron IPC, Tauri IPC, Chrome extension ports, Socket.IO, and point-to-point message-bus transports.

For RabbitMQ, Kafka, Redis Streams, and NATS, configure both `localPeerId` and `remotePeerId` when using remote references. Broadcast-style bus transports intentionally do not advertise remote-reference support because a retained handle must have exactly one remote owner for later `op: "ref"` calls and cleanup.

Unary HTTP rejects remote references with a clear error. A single HTTP request/response cannot carry follow-up callback calls after the response value has crossed the boundary.

## Complete Demo

See the repository example at [`examples/remote-references-demo`](https://github.com/kunkunsh/kkrpc/tree/main/examples/remote-references-demo) for a Worker-based demo covering explicitly proxied returned function leaves, callback return values, object proxies, and deterministic cleanup with `releaseProxy()`.

Run it from the repository root:

```bash
pnpm --filter remote-references-demo demo
```
