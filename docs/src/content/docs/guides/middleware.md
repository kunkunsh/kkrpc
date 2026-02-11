---
title: Middleware & Timeout
description: Interceptor chain for cross-cutting concerns and request timeout for reliability
sidebar:
  order: 5
---

kkrpc supports two features for production reliability: an **interceptor chain** for cross-cutting concerns and **request timeouts** to prevent hung calls.

## Middleware / Interceptors

### How It Works

1. You provide an `interceptors` array when creating an RPCChannel
2. When a call is received, kkrpc runs each interceptor in order (onion model)
3. Each interceptor calls `next()` to proceed to the next interceptor (or the handler)
4. Interceptors can inspect/modify args, transform return values, measure timing, or throw to abort
5. Interceptors run **after** input validation and **before** output validation

Since kkrpc is bidirectional, both sides can independently have interceptors for their own exposed API.

### Basic Usage

```ts
import { RPCChannel, type RPCInterceptor } from "kkrpc"

// Logging interceptor
const logger: RPCInterceptor = async (ctx, next) => {
	console.log(`→ ${ctx.method}`, ctx.args)
	const result = await next()
	console.log(`← ${ctx.method}`, result)
	return result
}

// Timing interceptor
const timer: RPCInterceptor = async (ctx, next) => {
	const start = performance.now()
	const result = await next()
	console.log(`${ctx.method} took ${(performance.now() - start).toFixed(1)}ms`)
	return result
}

// Auth interceptor (throw to reject)
const auth: RPCInterceptor = async (ctx, next) => {
	if (ctx.method.startsWith("admin.") && !isAuthorized()) {
		throw new Error("Unauthorized")
	}
	return next()
}

new RPCChannel(io, {
	expose: api,
	interceptors: [logger, timer, auth]
})
```

### Onion Model

Interceptors execute in the standard onion order — the first interceptor wraps all others:

```
interceptor[0] "before" →
  interceptor[1] "before" →
    handler()
  interceptor[1] "after" ←
interceptor[0] "after" ←
```

This means an outer interceptor (like a timer) can measure the total time including inner interceptors.

### RPCCallContext

Each interceptor receives a `ctx` object:

| Property | Type                      | Description                                                                 |
| -------- | ------------------------- | --------------------------------------------------------------------------- |
| `method` | `string`                  | Dotted method path (e.g. `"math.divide"`)                                   |
| `args`   | `unknown[]`               | Arguments after callback restoration and input validation                   |
| `state`  | `Record<string, unknown>` | Shared state bag — interceptors can attach data for downstream interceptors |

### Sharing state between interceptors

Use `ctx.state` to pass data between interceptors:

```ts
const setUser: RPCInterceptor = async (ctx, next) => {
	ctx.state.userId = await authenticate(ctx)
	return next()
}

const audit: RPCInterceptor = async (ctx, next) => {
	const result = await next()
	await logAudit(ctx.state.userId, ctx.method, ctx.args)
	return result
}

new RPCChannel(io, {
	expose: api,
	interceptors: [setUser, audit]
})
```

### Transforming return values

Interceptors can modify the handler's return value:

```ts
const doubler: RPCInterceptor = async (_ctx, next) => {
	const result = (await next()) as number
	return result * 2
}
```

### Position relative to validation

```
handleRequest flow:
  1. Resolve method path
  2. Restore callback arguments
  3. Input validation (if configured) — rejects early on bad input
  4. ▶ Interceptor chain wrapping handler invocation ◀
  5. Output validation (if configured) — rejects on bad return
  6. Send response
```

Interceptors see validated, clean args. They don't need to worry about malformed input. Output validation catches bad handler returns (including interceptor-modified returns).

### No interceptors (backward compatible)

```ts
// Existing code works exactly as before — no interceptors, no overhead
new RPCChannel(io, { expose: api })
```

## Request Timeout

### How It Works

1. You provide a `timeout` option (in milliseconds) when creating an RPCChannel
2. Each outgoing call (method call, property get/set, constructor) starts a timer
3. If the remote side doesn't respond before the deadline, the call rejects with `RPCTimeoutError`
4. When a response arrives, the timer is cleared
5. When `destroy()` is called, all pending requests are immediately rejected

### Basic Usage

```ts
import { isRPCTimeoutError, RPCChannel } from "kkrpc"

const rpc = new RPCChannel(io, {
	expose: api,
	timeout: 5000 // 5 second timeout
})

const api = rpc.getAPI()

try {
	await api.slowOperation()
} catch (error) {
	if (isRPCTimeoutError(error)) {
		console.log(error.method) // "slowOperation"
		console.log(error.timeoutMs) // 5000
	}
}
```

### RPCTimeoutError properties

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| `method`    | `string` | Method path or operation that timed out |
| `timeoutMs` | `number` | The configured timeout in milliseconds  |
| `name`      | `string` | Always `"RPCTimeoutError"`              |
| `message`   | `string` | Human-readable summary                  |

### Error serialization

`RPCTimeoutError` survives kkrpc's error serialization automatically — all custom properties (`method`, `timeoutMs`) are preserved across the wire. The `isRPCTimeoutError()` type guard works on both the original error and the deserialized version.

### Cleanup on destroy

When `destroy()` is called, kkrpc rejects all pending requests with `"RPC channel destroyed"` and clears all timers. This prevents memory leaks from abandoned pending promises.

### No timeout (default)

```ts
// Default: timeout is 0 (no timeout)
// Calls will wait indefinitely for a response
new RPCChannel(io, { expose: api })
```

## Combining Features

Middleware, validation, and timeout work together:

```ts
import { RPCChannel, type RPCInterceptor, type RPCValidators } from "kkrpc"

const logger: RPCInterceptor = async (ctx, next) => {
	console.log(`→ ${ctx.method}`)
	const result = await next()
	console.log(`← ${ctx.method}`)
	return result
}

new RPCChannel(io, {
	expose: api,
	validators, // Validate inputs/outputs
	interceptors: [logger], // Log all calls
	timeout: 10_000 // 10 second timeout
})
```

## API Reference

### Types

- `RPCCallContext` — `{ method: string, args: unknown[], state: Record<string, unknown> }`
- `RPCInterceptor` — `(ctx: RPCCallContext, next: () => Promise<unknown>) => Promise<unknown>`
- `RPCTimeoutError` — error class with `method`, `timeoutMs`

### Functions

- `runInterceptors(interceptors, ctx, handler)` — runs the interceptor chain (used internally, exported for testing)
- `isRPCTimeoutError(error)` — type guard that works across serialization boundaries
