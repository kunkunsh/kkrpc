---
title: Request Metadata
description: Propagate trace, logging, and request context through kkrpc calls.
sidebar:
  order: 6
---

kkrpc request metadata carries out-of-band context with an RPC request. Use it for tracing, logging, activity IDs, tenant IDs, session IDs, or other request-scoped diagnostics without changing the exposed API method signature.

Metadata is attached to request messages only. It is not a user argument and it is not returned automatically in responses.

## When To Use Metadata

Use metadata when the receiving side needs context about the call rather than data for the method itself.

Good uses:

- Trace context such as `traceparent`, `tracestate`, and `baggage`.
- Log correlation IDs such as `requestId`, `sessionId`, `activityId`, or `operationId`.
- Runtime context such as the caller runtime, extension ID, worker name, or retry count.
- Auth or tenant context that middleware validates before calling the handler.

Avoid metadata for normal method inputs. If a value changes the business result of the method, make it an explicit API argument instead.

## Metadata Shape

Metadata is typed as `RPCMessageMetadata` and exported from `kkrpc`.

```ts
import type { RPCMessageMetadata } from "kkrpc"
```

Built-in fields are intentionally generic:

```ts
interface RPCMessageMetadata {
	traceparent?: string
	tracestate?: string
	baggage?: string
	requestId?: string
	sessionId?: string
	runtime?: Record<string, string | number | boolean | null | undefined>
	[key: string]: unknown
}
```

Custom fields are allowed. Keep them JSON-compatible if the transport serializes messages as JSON.

## Attach Metadata To Outgoing Calls

Pass `getMetadata` to `wrap()`, `expose()`, or `RPCChannel`. kkrpc calls it for each outgoing request.

```ts
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { API } from "./server"

const api = wrap<API>(webSocketClientTransport({ url: "ws://localhost:3000" }), {
	getMetadata: () => ({
		traceparent: currentTraceparent(),
		baggage: currentBaggage(),
		requestId: currentRequestId(),
		runtime: {
			name: "browser",
			worker: false
		}
	})
})
```

`getMetadata` can return `undefined` or an empty object when there is no context to send. Empty metadata is omitted from the request message.

If `getMetadata` throws, the outgoing call rejects and no request is sent. This prevents a partially constructed request from reaching the remote side with missing trace or auth context.

## Bidirectional Channels

Metadata is configured per channel and applies to requests sent by that channel.

```ts
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, {
	expose: localAPI,
	getMetadata: () => ({ sessionId: currentSessionId() })
})

const remote = channel.getAPI()
await remote.notify("ready")
```

If both endpoints make calls, configure `getMetadata` on both endpoints when both directions need trace or logging context.

## Read Metadata In Plugins

Receive-side plugins can read metadata from `ctx.meta`.

```ts
import { expose, type RPCPlugin } from "kkrpc"

const loggingPlugin: RPCPlugin = {
	onRequest(ctx) {
		logger.info("rpc:start", {
			id: ctx.id,
			method: ctx.method,
			requestId: ctx.meta?.requestId,
			traceparent: ctx.meta?.traceparent
		})
	},
	onError(ctx) {
		logger.error("rpc:error", {
			id: ctx.id,
			method: ctx.method,
			requestId: ctx.meta?.requestId,
			error: ctx.error
		})
	}
}

expose(api, transport, { plugins: [loggingPlugin] })
```

Plugin contexts include the wire request id as `ctx.id`. Use it with `ctx.meta` to correlate request, response, error, and transport logs.

## Read Metadata In Middleware

Middleware created with `middlewarePlugin()` also receives metadata.

```ts
import { expose } from "kkrpc"
import { middlewarePlugin, type MiddlewareHandler } from "kkrpc/middleware"

const requestLogger: MiddlewareHandler = async (ctx, next) => {
	const startedAt = Date.now()
	try {
		return await next()
	} finally {
		logger.info("rpc", {
			id: ctx.id,
			method: ctx.method,
			requestId: ctx.meta?.requestId,
			sessionId: ctx.meta?.sessionId,
			durationMs: Date.now() - startedAt
		})
	}
}

expose(api, transport, {
	plugins: [middlewarePlugin([requestLogger])]
})
```

Middleware can also enforce context before the handler runs.

```ts
const requireTenant: MiddlewareHandler = async (ctx, next) => {
	if (typeof ctx.meta?.tenantId !== "string") {
		throw new Error("Missing tenant metadata")
	}
	return await next()
}
```

## OpenTelemetry Pattern

kkrpc does not import OpenTelemetry. The application owns extraction and injection so each runtime can use its preferred OTel setup.

Outgoing side:

```ts
const api = wrap<API>(transport, {
	getMetadata: () => ({
		traceparent: readCurrentTraceparent(),
		tracestate: readCurrentTracestate(),
		baggage: readCurrentBaggage()
	})
})
```

Receiving side:

```ts
const tracingMiddleware: MiddlewareHandler = async (ctx, next) => {
	return await runWithExtractedTraceContext(ctx.meta, async () => {
		return await next()
	})
}
```

The helper names above are placeholders for your OTel integration. kkrpc only moves the metadata across the RPC boundary and exposes it to plugins and middleware.

## Logging Pattern

For logging, prefer stable low-cardinality fields and avoid large metadata objects.

```ts
const api = wrap<API>(transport, {
	getMetadata: () => ({
		requestId: requestContext.id,
		sessionId: requestContext.sessionId,
		runtime: {
			app: "kunkun",
			process: "renderer"
		}
	})
})
```

On the receiving side, copy only the fields you need into logs.

```ts
logger.info("rpc:received", {
	id: ctx.id,
	method: ctx.method,
	requestId: ctx.meta?.requestId,
	sessionId: ctx.meta?.sessionId,
	runtime: ctx.meta?.runtime
})
```

## Transport Notes

Metadata is part of the request message, so it works across object-mode and JSON/string transports.

Important constraints:

- Metadata must be serializable by the selected transport codec.
- HTTP can carry metadata for client-initiated unary calls, but HTTP still does not support callbacks or server-initiated calls.
- Metadata is not automatically forwarded across separate RPC hops. If a handler calls another RPC endpoint, configure that outgoing channel's `getMetadata` to forward the desired context.
- Metadata should not contain secrets unless the transport and remote endpoint are trusted to receive them.

## Migration From kkrpc 0.7 Metadata

kunkun's 0.7 branch added `getMetadata` on the classic channel and exposed `ctx.meta` to interceptors. In kkrpc 1.0, the same concept maps to the native transport architecture.

| 0.7-era concept                                        | 1.0 replacement                                  |
| ------------------------------------------------------ | ------------------------------------------------ |
| `new RPCChannel(io, { getMetadata })`                  | `new RPCChannel(transport, { getMetadata })`     |
| `wrap` or client channel using a classic `IoInterface` | `wrap(remoteTransport, { getMetadata })`         |
| Classic `interceptors` reading `ctx.meta`              | `middlewarePlugin()` handlers reading `ctx.meta` |
| Classic middleware `ctx.id`                            | 1.0 middleware and plugin `ctx.id`               |
| `RPCMessageMetadata` from serialization types          | `RPCMessageMetadata` from `kkrpc`                |

Minimal migration example:

```ts title="0.7-style intent"
new RPCChannel(io, {
	getMetadata: () => ({
		activity: { activityId, operationId }
	}),
	interceptors: [logger]
})
```

```ts title="1.0 native transport"
import { RPCChannel } from "kkrpc"
import { middlewarePlugin } from "kkrpc/middleware"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, {
	expose: localAPI,
	getMetadata: () => ({
		activity: { activityId, operationId }
	}),
	plugins: [middlewarePlugin([logger])]
})
```

The logger receives the same metadata shape through `ctx.meta`.

## Testing Metadata

Test metadata at the transport boundary, not just by calling the provider directly.

```ts
test("metadata reaches middleware", async () => {
	let seenRequestId: string | undefined
	const middleware: MiddlewareHandler = async (ctx, next) => {
		seenRequestId = ctx.meta?.requestId
		return await next()
	}

	const server = new RPCChannel(serverTransport, {
		expose: api,
		plugins: [middlewarePlugin([middleware])]
	})
	const client = new RPCChannel<object, API>(clientTransport, {
		getMetadata: () => ({ requestId: "request-1" })
	})

	await client.getAPI().ping()
	expect(seenRequestId).toBe("request-1")

	client.destroy()
	server.destroy()
})
```

Also test the failure path when `getMetadata` throws if your application requires metadata for authorization or tracing.
