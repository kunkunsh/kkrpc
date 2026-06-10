---
title: Migrate from 0.7.x to 1.0
description: Move kkrpc 0.7.x applications to the stable 1.0 Transport-based API.
sidebar:
  order: 99
---

kkrpc 1.0 is a breaking rewrite of the public API. The stable package now uses native `Transport<RPCMessage>` objects everywhere. The old classic adapter model based on `IoInterface`, `IoMessage`, and public `*IO` classes is not preserved.

This guide is for applications currently using kkrpc 0.7.x or the temporary vNext entries and moving to kkrpc 1.0.

## What Changed

The 1.0 API promotes the previous native architecture into the stable `kkrpc` package entry.

Major changes:

- `kkrpc` now exports the stable native core: `RPCChannel`, `wrap()`, `expose()`, `dispose()`, `transfer()`, and core protocol/transport/plugin types.
- Runtime transports live behind subpath exports such as `kkrpc/worker`, `kkrpc/stdio`, `kkrpc/http`, `kkrpc/ws`, and `kkrpc/electron`.
- Optional integrations and peer dependencies are no longer pulled through the main entry.
- Validation and middleware are plugins, not top-level classic channel options.
- Request metadata for tracing and logging is configured with `getMetadata` and read from plugin or middleware `ctx.meta`.
- SuperJSON is an opt-in codec feature, not a core dependency.
- HTTP is explicitly unary request/response. Use WebSocket or another evented transport for bidirectional calls and callback arguments.
- Temporary `kkrpc/next` entries were removed because the native API is now stable.

## Quick Checklist

1. Upgrade the package to `kkrpc@1`.
2. Replace old imports with stable imports from `kkrpc` and transport subpaths.
3. Replace classic IO adapters with native transport factories.
4. Use `wrap()` for client-only proxies and `expose()` for server-only APIs.
5. Use `new RPCChannel(transport, { expose })` when both sides expose APIs.
6. Replace `validators` and `interceptors` channel options with `validationPlugin()` and `middlewarePlugin()`.
7. Move trace, logging, or activity context to request metadata. See [Request Metadata](/guides/metadata/).
8. Move SuperJSON usage to `kkrpc/superjson` and compose it through `createTransport()` only where needed.
9. Remove temporary `kkrpc/next`, `classic-compat`, `next/io`, `browser-lite`, `browser-mini`, and `electron-ipc` imports.
10. Run type checks and runtime tests for every migrated transport boundary.

## Removed Public APIs

These names and entries should not remain in 1.0 applications.

| Removed | Use instead |
| --- | --- |
| `IoInterface`, `IoMessage` | `Transport<RPCMessage>` |
| Public `*IO` adapter classes | Native transport factories, such as `workerTransport()` or `webSocketTransport()` |
| Classic `validators` option | `validationPlugin()` from `kkrpc/validation` |
| Classic `interceptors` option | `middlewarePlugin()` from `kkrpc/middleware` |
| `RPCValidators`, classic validation helpers | `defineMethod()`, `defineAPI()`, `extractValidators()`, `validationPlugin()` |
| `RPCInterceptor` from the old API | `MiddlewareHandler` from `kkrpc/middleware` |
| `kkrpc/next` and `kkrpc/next/*` | Stable `kkrpc` and stable subpaths |
| `kkrpc/next/classic-compat` | Native plugins and options |
| `kkrpc/next/io` | Native transport implementations |
| `kkrpc/browser-lite` | `kkrpc` or `kkrpc/browser` |
| `kkrpc/browser-mini` | `kkrpc` or `kkrpc/browser` |
| `kkrpc/electron-ipc` | `kkrpc/electron` |

Do not add compatibility bridges in new 1.0 code. If an old custom adapter still exists, migrate the adapter itself to `Transport<RPCMessage>`.

## Entry Points

The main entry is intentionally small and browser-safe. Runtime-specific code and optional peers live behind subpaths.

| Entry | Purpose |
| --- | --- |
| `kkrpc` | Stable core: `RPCChannel`, `wrap`, `expose`, `dispose`, `transfer`, core types |
| `kkrpc/browser` | Explicit browser-safe core entry |
| `kkrpc/deno` | Deno-friendly core entry |
| `kkrpc/transport` | `Transport`, `Platform`, `Codec`, `createTransport()` |
| `kkrpc/codecs` | Built-in object, JSON, and JSON-line codecs |
| `kkrpc/plugins` | Core plugin types and helpers |
| `kkrpc/validation` | Standard Schema validation plugin and schema helpers |
| `kkrpc/middleware` | Interceptor middleware plugin |
| `kkrpc/superjson` | SuperJSON codec helpers |
| `kkrpc/worker` | Web Worker transports |
| `kkrpc/stdio` | Node.js, Deno, and Bun stdio transports |
| `kkrpc/http` | HTTP client transport and request handler |
| `kkrpc/ws` | Plain WebSocket transports |
| `kkrpc/ws/hono` | Hono WebSocket integration |
| `kkrpc/ws/elysia` | Elysia WebSocket integration |
| `kkrpc/iframe` | iframe `postMessage` transports |
| `kkrpc/chrome-extension` | Chrome extension port transport |
| `kkrpc/electron` | Electron IPC and utility process transports |
| `kkrpc/tauri` | Tauri shell stdio transport |
| `kkrpc/socketio` | Socket.IO transport |
| `kkrpc/rabbitmq` | RabbitMQ transport |
| `kkrpc/kafka` | Kafka transport |
| `kkrpc/redis-streams` | Redis Streams transport |
| `kkrpc/nats` | NATS transport |
| `kkrpc/relay` | Transport relay helper |
| `kkrpc/inspector` | Native inspector helpers |

## Core API Migration

### Client-only calls

In 1.0, the common client path is `wrap(remoteTransport)`.

```ts title="1.0 client"
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { API } from "./server"

const api = wrap<API>(webSocketClientTransport({ url: "ws://localhost:3000" }))

console.log(await api.greet("World"))
```

Keep the proxy and call `dispose(api)` when the client lifetime ends.

```ts
import { dispose, wrap } from "kkrpc"

const api = wrap<API>(transport)

dispose(api)
```

### Server-only exposure

Expose a local object with `expose(api, transport)`. The returned controller owns the channel.

```ts title="1.0 server"
import { expose } from "kkrpc"
import { webSocketTransport } from "kkrpc/ws"

const controller = expose(api, webSocketTransport(socket))

controller.dispose()
```

### Bidirectional channels

Use `RPCChannel` directly when both sides expose APIs or when explicit channel ownership is useful.

```ts
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()

await remote.ping()
channel.destroy()
```

Type parameters are ordered as local API first, remote API second.

## Transport Migration

The old adapter layer exposed IO-like objects. The new layer exposes `Transport<RPCMessage>` factories. Pass the native transport directly into `wrap()`, `expose()`, or `RPCChannel`.

### Web Worker

Use `workerTransport()` on the parent side and `workerSelfTransport()` inside the worker.

```ts title="main.ts"
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const api = wrap<WorkerAPI>(workerTransport(worker))
```

```ts title="worker.ts"
import { expose } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"

const api = {
	async ping() {
		return "pong"
	}
}

export type WorkerAPI = typeof api

expose(api, workerSelfTransport())
```

Worker transports can advertise transferable support. Use `transfer(value, transferables)` only when the underlying platform supports ownership transfer.

### stdio

Use `nodeStdioTransport()`, `denoStdioTransport()`, `bunStdioTransport()`, or `stdioJsonTransport()` from `kkrpc/stdio`.

```ts title="child.ts"
import { expose } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"

expose(api, nodeStdioTransport({ readable: process.stdin, writable: process.stdout }))
```

```ts title="parent.ts"
import { spawn } from "node:child_process"
import { wrap } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"

const child = spawn("node", ["child.js"])
const api = wrap<ChildAPI>(nodeStdioTransport({ readable: child.stdout, writable: child.stdin }))
```

Stdio transports use newline-delimited JSON. Do not reuse old blocking `read()`/`write()` IO classes.

### HTTP

HTTP in 1.0 is unary request/response only. It is appropriate for normal client-initiated calls, but not server-initiated calls or callback arguments.

```ts title="server.ts"
import { createHttpHandler } from "kkrpc/http"

const handler = createHttpHandler(api)

Bun.serve({
	fetch(request) {
		return new URL(request.url).pathname === "/rpc"
			? handler(request)
			: new Response("Not found", { status: 404 })
	}
})
```

```ts title="client.ts"
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"

const api = wrap<API>(httpClientTransport({ url: "http://localhost:3000/rpc" }))
```

If old HTTP code depended on callbacks, subscriptions, streaming progress, or server pushes, migrate that boundary to WebSocket or another evented transport instead.

### WebSocket

Use `webSocketTransport(socket)` for accepted sockets and `webSocketClientTransport({ url })` for clients.

```ts
import { expose, wrap } from "kkrpc"
import { webSocketClientTransport, webSocketTransport } from "kkrpc/ws"
```

Framework helpers moved to dedicated subpaths:

- Hono: `createHonoWebSocketHandler()` and `honoWebSocketTransport()` from `kkrpc/ws/hono`.
- Elysia: `createElysiaWebSocketHandler()` and `elysiaWebSocketTransport()` from `kkrpc/ws/elysia`.

### iframe and Chrome extension

Use `iframeParentTransport()`, `iframeChildTransport()`, and readiness helpers from `kkrpc/iframe`. Use `chromePortTransport()` from `kkrpc/chrome-extension` for `chrome.runtime.Port` boundaries.

These transports use message events. Keep origin checks and extension permission boundaries in application code.

### Electron

Use `kkrpc/electron`, not `kkrpc/electron-ipc`.

Available helpers include:

- `electronIpcTransport()` for endpoint-like IPC messaging.
- `electronUtilityProcessTransport()` for parent-side utility process communication.
- `electronUtilityProcessChildTransport()` for child-side utility process communication.
- `createSecureIpcBridge()` for preload-safe bridge construction.

Do not import Electron-specific helpers from the main `kkrpc` entry.

### Tauri

Use `tauriShellStdioTransport()` from `kkrpc/tauri` for Tauri shell child process communication. Keep Tauri plugin dependencies behind this subpath.

### Socket.IO

Use `socketIoTransport(socket)` from `kkrpc/socketio`. Socket.IO remains separate from `kkrpc/ws` because it uses Socket.IO-specific event semantics and peer dependencies.

### Message buses

Use the native message-bus transports from their dedicated subpaths:

| System | 1.0 helper |
| --- | --- |
| RabbitMQ | `rabbitMqTransport()` from `kkrpc/rabbitmq` |
| Kafka | `kafkaTransport()` from `kkrpc/kafka` |
| Redis Streams | `redisStreamsTransport()` from `kkrpc/redis-streams` |
| NATS | `natsTransport()` from `kkrpc/nats` |

Message-bus transports use envelope metadata for peer identity and routing. They may provide at-least-once delivery depending on the broker. Do not assume exactly-once execution unless your application protocol handles idempotency.

## Validation Migration

Validation is now an explicit plugin. It accepts Standard Schema-compatible validators, including Zod, Valibot, and ArkType schemas.

```ts
import { expose } from "kkrpc"
import { defineAPI, defineMethod, extractValidators, validationPlugin } from "kkrpc/validation"
import { z } from "zod"

const api = defineAPI({
	add: defineMethod(
		{ input: z.tuple([z.number(), z.number()]), output: z.number() },
		async (a, b) => a + b
	)
})

expose(api, transport, {
	plugins: [validationPlugin(extractValidators(api))]
})
```

If old code passed `validators` directly to a classic channel, move those schemas into a validator map or define the API with `defineMethod()`.

## Middleware Migration

Middleware is also a plugin.

```ts
import { expose } from "kkrpc"
import { middlewarePlugin, type MiddlewareHandler } from "kkrpc/middleware"

const logger: MiddlewareHandler = async (ctx, next) => {
	console.log("rpc:start", ctx.method)
	const result = await next()
	console.log("rpc:end", ctx.method)
	return result
}

expose(api, transport, {
	plugins: [middlewarePlugin([logger])]
})
```

If old code used classic `interceptors`, migrate each interceptor to the new `MiddlewareHandler` context and install it with `middlewarePlugin()`.

## Metadata Migration

If your 0.7 code used `getMetadata` or interceptor `ctx.meta` for tracing, activity IDs, or logging correlation, keep that context as request metadata in 1.0. The option remains `getMetadata`, but it now belongs to the native `wrap()`, `expose()`, or `RPCChannel` options.

```ts
import { wrap } from "kkrpc"

const api = wrap<API>(transport, {
	getMetadata: () => ({
		traceparent: currentTraceparent(),
		requestId: currentRequestId(),
		sessionId: currentSessionId()
	})
})
```

Receive-side plugins and middleware read the metadata from `ctx.meta`.

```ts
import { middlewarePlugin, type MiddlewareHandler } from "kkrpc/middleware"

const logger: MiddlewareHandler = async (ctx, next) => {
	console.log("rpc", ctx.method, ctx.meta?.requestId)
	return await next()
}

const plugins = [middlewarePlugin([logger])]
```

See [Request Metadata](/guides/metadata/) for tracing, logging, and kunkun migration examples.

## SuperJSON Migration

SuperJSON is opt-in through `kkrpc/superjson` and transport composition.

```ts
import { createTransport } from "kkrpc/transport"
import { superJsonCodec } from "kkrpc/superjson"

const transport = createTransport({ platform, codec: superJsonCodec() })
```

Do not import SuperJSON helpers from `kkrpc`. This keeps the core bundle small and avoids pulling SuperJSON into applications that do not need it.

## Protocol and Interop Notes

The stable wire protocol uses compact JSON-compatible records:

```json
{ "t": "q", "id": "request-id", "op": "call", "p": ["math", "add"], "a": [1, 2] }
```

Responses use `t: "r"`; callback invocations use `t: "cb"`. Async iterable streams use `t: "sq"` credit/control requests and `t: "sr"` data/completion/error responses. Non-TypeScript implementations should use the language interop references and the `skills/interop` guide.

## Common Pitfalls

| Problem | Fix |
| --- | --- |
| Importing runtime transports from `kkrpc` | Import from runtime subpaths such as `kkrpc/ws` or `kkrpc/electron` |
| Leaving `kkrpc/next` imports in code | Replace them with `kkrpc` and stable subpaths |
| Migrating HTTP code that used callbacks | Use WebSocket or another evented transport |
| Assuming `wrap()` disposes automatically | Keep the proxy and call `dispose(proxy)` when the lifetime ends |
| Pulling SuperJSON into every bundle | Use `kkrpc/superjson` only at boundaries that need richer values |
| Preserving old `*IO` class names in wrappers | Rename wrappers around native `Transport<RPCMessage>` factories |
| Treating transferables as universal | Check transport capabilities and use `transfer()` only where supported |

## Verification

For this repository, run:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc test
pnpm --filter "./examples/*" check-types
```

For downstream projects, run the equivalent TypeScript type check, unit tests, and at least one integration test for each migrated transport boundary.

Search for old API remnants before finishing:

```bash
rg 'kkrpc/next|next/io|classic-compat|IoInterface|IoMessage|RPCValidators|kkrpc/browser-lite|kkrpc/browser-mini|kkrpc/electron-ipc'
rg '[A-Za-z0-9_]+IO\b'
```

The second search can produce false positives for application names. Review each match and remove old public kkrpc adapter usage.
