# kkrpc — Improvement Roadmap

**Created:** 2026-02-07
**Status:** Planning
**Branch:** main (at current HEAD)

---

## Overview

Four architectural improvements identified from design review and competitive analysis against tRPC, oRPC, Comlink, panrpc, and gRPC. Ordered by implementation dependency — later items may depend on earlier ones.

---

## 1. Middleware / Interceptor System

### Problem

There is no way to inject cross-cutting concerns (logging, auth, rate limiting, timing, metrics) without wrapping every handler function manually. Compare to tRPC which has a rich `.use()` middleware chain on procedures, or oRPC which supports middleware and interceptors at both procedure and router level.

Currently the only option is wrapping the entire API object:

```typescript
// Ugly: manual wrapping per method
const api = {
	add: async (a: number, b: number) => {
		console.log("add called") // logging
		checkAuth() // auth
		const start = Date.now()
		const result = a + b
		console.log(`took ${Date.now() - start}ms`) // timing
		return result
	}
}
```

This doesn't compose, doesn't apply uniformly, and mixes business logic with infrastructure.

### Proposed Solution

Add an optional `interceptors` (or `middleware`) option to `RPCChannel` constructor. The interceptor chain runs on the **receiving side** (where `handleRequest` processes incoming calls), wrapping the actual handler invocation.

#### API Design

```typescript
// Interceptor function signature
type RPCInterceptor = (ctx: RPCCallContext, next: () => Promise<unknown>) => Promise<unknown>

interface RPCCallContext {
	method: string // Dotted path, e.g. "math.grade1.add"
	args: unknown[] // Arguments after callback restoration
	// Could also include: timestamp, requestId, metadata from headers, etc.
}

// Usage
new RPCChannel(io, {
	expose: api,
	interceptors: [
		// Logging
		async (ctx, next) => {
			console.log(`→ ${ctx.method}`, ctx.args)
			const result = await next()
			console.log(`← ${ctx.method}`, result)
			return result
		},
		// Timing
		async (ctx, next) => {
			const start = performance.now()
			const result = await next()
			console.log(`${ctx.method} took ${(performance.now() - start).toFixed(1)}ms`)
			return result
		},
		// Auth (throw to reject)
		async (ctx, next) => {
			if (ctx.method.startsWith("admin.") && !isAuthorized()) {
				throw new Error("Unauthorized")
			}
			return next()
		}
	]
})
```

#### Implementation Location

`channel.ts` → `handleRequest()` method (line ~398). Currently the flow is:

```
handleRequest → resolve method path → restore callbacks → validate input → call handler → validate output → sendResponse
```

With middleware it becomes:

```
handleRequest → resolve method path → restore callbacks → validate input → run interceptor chain(call handler) → validate output → sendResponse
```

Validation should run **outside** the interceptor chain (before input interceptors see args, after output is returned) so interceptors work with validated data. Alternatively, make validation itself an interceptor — this is a design choice.

#### Key Decisions Needed

1. **Interceptor position relative to validation**: Run interceptors before validation (raw args), between validation and handler (validated args), or make validation an interceptor itself?

   - Recommendation: Between validation and handler. Interceptors see validated, clean args.

2. **Per-method vs global interceptors**: Start with global only (applies to all methods). Per-method interceptors can come later via a filter pattern:

   ```typescript
   // Future: filtered interceptor
   { match: "admin.*", interceptor: authInterceptor }
   ```

3. **Context extensibility**: Should interceptors be able to attach data to `ctx` for downstream interceptors?
   - Recommendation: Yes, add a `ctx.state: Record<string, unknown>` bag.

#### Files to Change

- `channel.ts`: Add `interceptors` option, modify `handleRequest()` to wrap handler call in interceptor chain
- `serialization.ts`: Possibly extend `Message` type if we want to pass metadata from caller → callee (e.g. auth tokens in message headers)
- New file: `middleware.ts` — interceptor types, chain runner utility

#### Complexity: Low-Medium

The core change is small: wrap the `targetMethod.apply(target, processedArgs)` call in `handleRequest()` with an interceptor chain runner. The chain runner is ~20 lines (iterate interceptors, call next recursively).

---

## 2. Streaming / Subscription Support

### Problem

kkrpc is strictly request/response. There's no first-class way to:

- Stream large datasets incrementally
- Subscribe to events (file changes, database updates, progress)
- Return an `AsyncIterable` from an RPC method

Currently the **workaround** is passing callbacks:

```typescript
// Current: callback-based streaming (clunky)
const api = {
	watchFiles: async (path: string, onChange: (event: FileEvent) => void) => {
		fs.watch(path, (event) => onChange(event))
	}
}

// Client side
await api.watchFiles("/tmp", (event) => {
	console.log("file changed:", event)
})
```

This works but has issues:

- No backpressure (producer doesn't know if consumer is slow)
- No way to signal completion from producer
- No way to cancel from consumer (without another RPC call)
- Can't use `for await...of` on the client side
- Callbacks are fire-and-forget (no error propagation back to producer)

Compare to tRPC v11 which supports SSE subscriptions with async generators, or gRPC which has server/client/bidirectional streaming.

### Proposed Solution

Add a new message type `"stream"` to the protocol, and support returning `AsyncIterable` from RPC methods.

#### API Design

```typescript
// Server: return an AsyncIterable (or async generator)
const api = {
	async *watchFiles(path: string): AsyncGenerator<FileEvent> {
		const watcher = fs.watch(path)
		try {
			for await (const event of watcher) {
				yield event // Each yield sends a stream chunk
			}
		} finally {
			watcher.close() // Cleanup when consumer cancels or disconnects
		}
	},

	async *countdown(from: number): AsyncGenerator<number> {
		for (let i = from; i >= 0; i--) {
			yield i
			await sleep(1000)
		}
	}
}

// Client: consume with for-await-of
const api = rpc.getAPI()
for await (const event of api.watchFiles("/tmp")) {
	console.log("file changed:", event)
	if (shouldStop) break // Break sends cancel signal to producer
}

// Or collect all values
const numbers: number[] = []
for await (const n of api.countdown(5)) {
	numbers.push(n)
}
// numbers = [5, 4, 3, 2, 1, 0]
```

#### Protocol Extension

New message types to add to `Message.type`:

```typescript
type MessageType =
	| "request"
	| "response"
	| "callback"
	| "get"
	| "set"
	| "construct"
	// New:
	| "stream-chunk" // Producer → Consumer: here's the next value
	| "stream-end" // Producer → Consumer: stream is complete
	| "stream-error" // Producer → Consumer: stream errored
	| "stream-cancel" // Consumer → Producer: stop producing
```

Wire format for stream messages:

```typescript
// stream-chunk
{ id: "<original-request-id>", type: "stream-chunk", method: "", args: { value: <yielded_value> } }

// stream-end
{ id: "<original-request-id>", type: "stream-end", method: "", args: {} }

// stream-error
{ id: "<original-request-id>", type: "stream-error", method: "", args: { error: <serialized_error> } }

// stream-cancel
{ id: "<original-request-id>", type: "stream-cancel", method: "", args: {} }
```

#### Implementation Plan

**Producer side** (in `handleRequest`):

```typescript
const result = await targetMethod.apply(target, processedArgs)

if (result && typeof result[Symbol.asyncIterator] === "function") {
	// It's an AsyncIterable — stream it
	this.streamResult(id, result)
	return // Don't send normal response
}

// Normal response path (unchanged)
this.sendResponse(id, result)
```

```typescript
private async streamResult(requestId: string, iterable: AsyncIterable<unknown>): Promise<void> {
  // Track active streams for cancellation
  this.activeStreams.set(requestId, iterable)

  try {
    for await (const value of iterable) {
      // Check if consumer cancelled
      if (!this.activeStreams.has(requestId)) break

      this.sendMessage({
        id: requestId,
        method: "",
        args: { value },
        type: "stream-chunk"
      })
    }
    this.sendMessage({ id: requestId, method: "", args: {}, type: "stream-end" })
  } catch (error: any) {
    this.sendError(id, error)  // Reuse existing error path, or use stream-error
  } finally {
    this.activeStreams.delete(requestId)
  }
}
```

**Consumer side** (in `callMethod` / proxy):

When the proxy detects the response is a stream (first message is `stream-chunk` instead of `response`), return an `AsyncIterable` to the caller:

```typescript
// In pendingRequests resolution, if first message is stream-chunk:
// Instead of resolving the promise with a value, resolve with a ReadableStream/AsyncIterable

private createStreamIterable(requestId: string): AsyncIterable<unknown> {
  const channel = this
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          return new Promise((resolve) => {
            channel.pendingStreamChunks.set(requestId, { resolve })
          })
        },
        return(): Promise<IteratorResult<unknown>> {
          // Send cancel signal
          channel.sendMessage({ id: requestId, method: "", args: {}, type: "stream-cancel" })
          channel.pendingStreamChunks.delete(requestId)
          return Promise.resolve({ done: true, value: undefined })
        }
      }
    }
  }
}
```

#### Key Decisions Needed

1. **How does the consumer know it's a stream vs a regular response?**

   - Option A: First message determines it (if `stream-chunk` arrives for a request ID, treat as stream). This is implicit.
   - Option B: The initial `response` message includes a flag `{ type: "response", args: { stream: true } }` that tells the consumer to expect stream messages. This is explicit.
   - Recommendation: Option B — send a `{ type: "response", args: { result: null, stream: true } }` first, then stream chunks. This keeps the pending request resolution clean.

2. **Backpressure**: Should the producer wait for consumer acknowledgment before sending the next chunk?

   - For most IPC use cases, no. Fire-and-forget chunks with consumer-side buffering is simpler.
   - For high-volume streams, add optional flow control later.

3. **Validation for streams**: Should `output` validation run on each chunk?

   - Recommendation: Yes, validate each yielded value against the output schema if present.

4. **Type safety for streams**: How to express `AsyncGenerator<T>` in the RemoteAPI type?
   - The proxy needs to return `AsyncIterable<T>` for methods that return `AsyncGenerator<T>`.
   - This should work naturally if the RemoteAPI type declares `watchFiles(path: string): AsyncIterable<FileEvent>`.

#### Files to Change

- `serialization.ts`: Add new message types to `Message.type` union
- `channel.ts`: Modify `handleRequest()` to detect AsyncIterable results; add `streamResult()`, `handleStreamChunk()`, `handleStreamEnd()`, `handleStreamError()`, `handleStreamCancel()` methods; modify `processDecodedMessage()` to route new message types; modify proxy to return AsyncIterable when stream is detected
- New state: `activeStreams: Map<string, AsyncIterable>` and `pendingStreamChunks: Map<string, ...>` on RPCChannel

#### Complexity: Medium-High

This is the most impactful change. The protocol extension is straightforward, but getting the consumer-side AsyncIterable right (with proper cleanup, cancellation, and error propagation) requires careful design. Recommend implementing a basic version first (no backpressure, no stream validation) and iterating.

---

## 3. Request Timeout

### Problem

`pendingRequests` in `RPCChannel` is a `Record<string, PendingRequest>` that grows unbounded. If the remote side crashes, hangs, or the transport drops silently, promises hang forever and memory leaks:

```typescript
// These promises never resolve if remote dies
const result = await api.doSomething() // Hangs forever
```

There is no timeout, no cleanup, no way to detect dead connections.

### Proposed Solution

Add an optional `timeout` configuration to RPCChannel that auto-rejects pending requests after a deadline.

#### API Design

```typescript
new RPCChannel(io, {
	expose: api,
	timeout: 30_000 // Default: no timeout (Infinity). Reject after 30s.
})

// Per-call timeout (future enhancement)
// await api.slowOperation.$timeout(60_000).call(args)  // 60s for this call
```

#### Implementation

In `callMethod()`, `getProperty()`, `setProperty()`, `callConstructor()` — anywhere `pendingRequests[messageId]` is created:

```typescript
public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const messageId = generateUUID()
    this.pendingRequests[messageId] = { resolve, reject }

    // New: set timeout
    if (this.timeout && this.timeout !== Infinity) {
      const timer = setTimeout(() => {
        if (this.pendingRequests[messageId]) {
          this.pendingRequests[messageId].reject(
            new RPCTimeoutError(method as string, this.timeout!)
          )
          delete this.pendingRequests[messageId]
        }
      }, this.timeout)

      // Store timer so we can clear it on response
      this.pendingTimers[messageId] = timer
    }

    // ... rest of callMethod
  })
}
```

In `handleResponse()`, clear the timer:

```typescript
private handleResponse(response: Message<Response<any>>): void {
  const { id } = response
  if (this.pendingRequests[id]) {
    // Clear timeout timer
    if (this.pendingTimers[id]) {
      clearTimeout(this.pendingTimers[id])
      delete this.pendingTimers[id]
    }
    // ... existing resolve/reject logic
  }
}
```

New error class:

```typescript
export class RPCTimeoutError extends Error {
	public readonly method: string
	public readonly timeoutMs: number

	constructor(method: string, timeoutMs: number) {
		super(`RPC call to "${method}" timed out after ${timeoutMs}ms`)
		this.name = "RPCTimeoutError"
		this.method = method
		this.timeoutMs = timeoutMs
	}
}
```

#### Cleanup on Destroy

In `destroy()`, reject all pending requests and clear all timers:

```typescript
destroy(): void {
  // Reject all pending requests
  for (const [id, pending] of Object.entries(this.pendingRequests)) {
    pending.reject(new Error("RPC channel destroyed"))
    if (this.pendingTimers[id]) {
      clearTimeout(this.pendingTimers[id])
    }
  }
  this.pendingRequests = {}
  this.pendingTimers = {}

  this.freeCallbacks()
  if (this.io && this.io.destroy) {
    this.io.destroy()
  }
}
```

#### Files to Change

- `channel.ts`: Add `timeout` option, `pendingTimers` map, timeout logic in all `callX` methods, cleanup in `handleResponse()` and `destroy()`
- New export: `RPCTimeoutError` class (could go in `channel.ts` or a new `errors.ts`)

#### Complexity: Low

This is the simplest of the four improvements. Mostly mechanical — add a timer alongside each pending request, clear it on response.

---

## 4. Stronger Proxy Type Safety

### Problem

The proxy returned by `getAPI()` has a type safety gap. Internally, `createNestedProxy()` returns `any`, and type safety is only recovered via `as RemoteAPI` cast:

```typescript
// channel.ts:787-789
public getAPI(): RemoteAPI {
  return this.createNestedProxy() as RemoteAPI  // ← Cast, not inference
}

// channel.ts:204
public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<void> {
  //                                                         ^^^^^ args is any[]!
}
```

This means TypeScript doesn't actually verify that the arguments you pass match the method signature at the `callMethod` boundary — it only checks at the proxy surface (because the proxy is cast to `RemoteAPI`). The `as RemoteAPI` cast is what provides type safety to the **consumer**, but internally the types are lost.

Comlink has the same issue. tRPC and oRPC don't — their types flow structurally from procedure definitions through to the client.

### What Can Be Improved

The `as RemoteAPI` cast at the proxy boundary is actually fine for most users — they get autocomplete and type checking when using `api.method(args)`. The real improvements are:

#### 4a. Tighter `callMethod` Signature

Currently:

```typescript
public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<void>
```

Could be:

```typescript
public callMethod<T extends keyof RemoteAPI>(
  method: T,
  args: RemoteAPI[T] extends (...args: infer A) => any ? A : never[]
): RemoteAPI[T] extends (...args: any[]) => infer R ? R : Promise<void>
```

This constrains `args` to match the method's parameter types and returns the correct return type. However, this only works for **top-level** methods (not nested like `math.grade1.add`). For nested paths, we'd need recursive path typing:

```typescript
// Advanced: recursive path types (TypeScript 4.1+ template literal types)
type DeepKeyOf<T, Prefix extends string = ""> = {
	[K in keyof T & string]: T[K] extends Record<string, any>
		? `${Prefix}${K}` | DeepKeyOf<T[K], `${Prefix}${K}.`>
		: `${Prefix}${K}`
}[keyof T & string]

type DeepMethodArgs<T, Path extends string> = Path extends `${infer Head}.${infer Tail}`
	? Head extends keyof T
		? DeepMethodArgs<T[Head], Tail>
		: never
	: Path extends keyof T
		? T[Path] extends (...args: infer A) => any
			? A
			: never
		: never
```

This is complex TypeScript but achievable. It would make `callMethod("math.grade1.add", [1, 2])` fully type-checked.

#### 4b. Better Schema-First Client Types

For the `defineAPI()` / `InferAPI` path, the types already flow well. The gap is on the **consumer side** — when creating `RPCChannel<{}, InferAPI<typeof api>>`, the `RemoteAPI` generic is set correctly. No changes needed here.

#### 4c. `unknown` Instead of `any` in Internal Signatures

Several internal signatures use `any` where `unknown` would be safer:

```typescript
// Current
interface CallbackFunction {
	(...args: any[]): void
}
interface PendingRequest {
	resolve: (result: any) => void
	reject: (error: any) => void
}

// Better
interface CallbackFunction {
	(...args: unknown[]): void
}
interface PendingRequest {
	resolve: (result: unknown) => void
	reject: (error: unknown) => void
}
```

This forces explicit narrowing inside the implementation rather than silently accepting anything.

#### Files to Change

- `channel.ts`: Tighten generic constraints on `callMethod`, `callConstructor`, `getProperty`, `setProperty`; change `any` → `unknown` in internal interfaces
- Possibly new file: `types.ts` with recursive path type utilities

#### Complexity: Medium-High (for 4a), Low (for 4c)

Recommendation: Start with 4c (`any` → `unknown` cleanup) which is low-risk. Then attempt 4a (tighter `callMethod`) — but be prepared to back off if the type gymnastics create confusing error messages for users. Better type safety that produces incomprehensible TS errors is worse than `any`.

---

## Suggested Implementation Order

```
1. Request Timeout       (Low complexity, standalone, no dependencies)
2. Middleware System      (Low-Medium complexity, standalone)
3. Streaming Support      (Medium-High complexity, may benefit from middleware for stream interceptors)
4. Proxy Type Safety      (Medium complexity, can be done anytime, start with any→unknown)
```

Timeout is the smallest change with immediate reliability benefit. Middleware is a clean addition. Streaming is the biggest change but the most impactful for your other project. Type safety cleanup can happen incrementally alongside the other work.
