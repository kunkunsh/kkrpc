---
name: kkrpc
description: Use when building TypeScript RPC with kkrpc stable APIs, choosing native Transport<RPCMessage> adapters, or integrating validation, middleware, transferables, streaming, remote references, relay, or inspector tooling.
version: 2.0.0
license: MIT
metadata:
  author: kkrpc
  domain: typescript-rpc
  tags:
    - rpc
    - typescript
    - bidirectional
    - ipc
    - websocket
    - http
    - workers
    - electron
    - tauri
    - chrome-extension
compatibility: Works in Node.js, Deno, Bun, browsers, Electron, Tauri, Chrome extensions, and queue-backed runtimes with the correct stable entry point and transport.
---

# kkrpc - TypeScript RPC Library

Use kkrpc to expose a local TypeScript object and call the remote side as a typed proxy. The stable API is native `Transport<RPCMessage>` based. Start with the small default `kkrpc` entry, then opt into `kkrpc/streaming` or `kkrpc/remote-refs` only when the API needs those features.

```typescript
import { expose, wrap } from "kkrpc"

const controller = expose(localAPI, serverTransport)
const remote = wrap<RemoteAPI>(clientTransport)

controller.dispose()
```

Use low-level `RPCChannel` when both sides expose APIs or when you need explicit channel ownership:

```typescript
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()
```

## First Decisions

1. Pick the stable entry point.
2. Pick the native transport factory.
3. Decide whether one side or both sides expose APIs.
4. Add plugins only when validation, middleware, logging, or custom behavior is required.

## Entry Points

| Runtime or feature | Import path                                                          | Notes                                                                                        |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Core               | `kkrpc`                                                              | Browser-safe `wrap`, `expose`, `RPCChannel`, protocol and transport types                    |
| Browser core       | `kkrpc/browser`                                                      | Explicit browser entry when package conditions are not enough                                |
| Worker             | `kkrpc/worker`                                                       | `workerTransport`, `workerSelfTransport`                                                     |
| stdio              | `kkrpc/stdio`                                                        | Native JSON-line stdio transports                                                            |
| HTTP               | `kkrpc/http`                                                         | HTTP client and handler helpers                                                              |
| WebSocket          | `kkrpc/ws`                                                           | WebSocket client/server transports                                                           |
| Hono WebSocket     | `kkrpc/ws/hono`                                                      | Optional `hono` peer                                                                         |
| Elysia WebSocket   | `kkrpc/ws/elysia`                                                    | Optional `elysia` peer                                                                       |
| iframe             | `kkrpc/iframe`                                                       | iframe postMessage transports                                                                |
| Chrome extension   | `kkrpc/chrome-extension`                                             | Chrome runtime port transports                                                               |
| Electron           | `kkrpc/electron`                                                     | Electron IPC and utility process transports                                                  |
| Tauri              | `kkrpc/tauri`                                                        | Tauri shell plugin transport                                                                 |
| Validation         | `kkrpc/validation`                                                   | Standard Schema validation plugin                                                            |
| Middleware         | `kkrpc/middleware`                                                   | Interceptor middleware plugin                                                                |
| SuperJSON          | `kkrpc/superjson`                                                    | SuperJSON codecs                                                                             |
| Streaming          | `kkrpc/streaming`                                                    | Async iterable arguments/results with pull-based backpressure                                |
| Remote refs        | `kkrpc/remote-refs`                                                  | Explicit `proxy(value)` references, callback return values, object handles, `releaseProxy()` |
| Relay              | `kkrpc/relay`                                                        | Transport-to-transport relay helper                                                          |
| Inspector          | `kkrpc/inspector`                                                    | Native plugin/event traffic logging                                                          |
| Queues             | `kkrpc/rabbitmq`, `kkrpc/kafka`, `kkrpc/redis-streams`, `kkrpc/nats` | Optional peer dependencies; set `remotePeerId` for point-to-point streaming or remote refs   |

## Core API Pattern

Prefer explicit local and remote API types. In bidirectional RPC, each side can expose its own API and call the other side.

```typescript
type ServerAPI = {
	math: {
		add(a: number, b: number): Promise<number>
	}
	version(): Promise<string>
}

type ClientAPI = {
	notify(message: string): Promise<void>
}

const clientAPI: ClientAPI = {
	async notify(message) {
		console.log(message)
	}
}

const channel = new RPCChannel<ClientAPI, ServerAPI>(transport, { expose: clientAPI })
const server = channel.getAPI()

console.log(await server.math.add(1, 2))
```

Remote property access is supported:

```typescript
const counter = await api.counter
const nested = await api.nested.deepObj.prop
```

Top-level callbacks can be passed as arguments for fire-and-forget progress notifications:

```typescript
await api.process("input", (progress) => {
	console.log("progress", progress)
})
```

Default callbacks do not propagate return values or thrown errors. Use `kkrpc/remote-refs` and `proxy(callback)` when the remote side must await the callback result.

`kkrpc/remote-refs` is explicit: unmarked function values are rejected rather than passed by raw object identity. Wrap each callback, returned function leaf, or object handle that should remain remote with `proxy(value)`.

Remote proxies are channel-scoped. Do not pass a remote proxy decoded from one `RPCChannel` through a different channel; expose an explicit bridge method if that is truly required.

## Streaming Example

```typescript
import { expose, wrap } from "kkrpc/streaming"

type LogAPI = {
	tail(service: string): AsyncIterable<string>
}

for await (const line of wrap<LogAPI>(transport).tail("api")) {
	console.log(line)
}
```

## Remote References Example

```typescript
import { proxy, releaseProxy, wrap } from "kkrpc/remote-refs"

const result = await wrap<RemoteAPI>(transport).useCallback(
	proxy(async (value) => `callback:${value}`)
)

const counter = await wrap<RemoteAPI>(transport).createCounter()
await releaseProxy(counter)
```

## Worker Example

Parent side:

```typescript
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const api = wrap<WorkerAPI>(workerTransport(worker))

console.log(await api.ping())
```

Worker side:

```typescript
import { expose } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"

expose(
	{
		async ping() {
			return "pong"
		}
	},
	workerSelfTransport()
)
```

## WebSocket Example

```typescript
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<RemoteAPI>(webSocketClientTransport("ws://localhost:3000/rpc"))
```

## Validation Example

```typescript
import { expose, wrap } from "kkrpc"
import { validationPlugin } from "kkrpc/validation"

const plugins = [validationPlugin(validators)]
const controller = expose(localAPI, serverTransport, { plugins })
const remote = wrap<RemoteAPI>(clientTransport, { plugins })
```

## Middleware Example

```typescript
import { middlewarePlugin } from "kkrpc/middleware"

const plugins = [
	middlewarePlugin([
		async (ctx, next) => {
			console.log(ctx.method)
			return next()
		}
	])
]
```

## SuperJSON Example

Use `kkrpc/superjson` only when the application needs SuperJSON value support. Do not import it from the main `kkrpc` entry.

```typescript
import { superJsonCodec } from "kkrpc/superjson"
import { createTransport } from "kkrpc/transport"

const transport = createTransport({ platform, codec: superJsonCodec() })
```

## Inspector Example

```typescript
import { createInspector, MemoryBackend } from "kkrpc/inspector"

const memory = new MemoryBackend()
const inspector = createInspector({ backends: [memory], options: { trackLatency: true } })
const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, {
	expose: localAPI,
	plugins: [inspector.plugin("server")]
})
```

## Relay Example

```typescript
import { relayTransport } from "kkrpc/relay"

const relay = relayTransport(leftTransport, rightTransport)
relay.dispose()
```

## Migration Rules

1. Use `kkrpc` instead of old experimental native entry paths.
2. Use native transport factories instead of blocking IO classes.
3. Keep optional peers behind their stable subpaths.
4. Do not import runtime-specific transports from the main `kkrpc` entry.
5. Do not use removed compatibility entries or browser-lite/browser-mini entries in new code.

## Common Pitfalls

| Pitfall                                                 | Fix                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Importing optional transport peers from `kkrpc`         | Import from the specific subpath, such as `kkrpc/ws` or `kkrpc/electron`                        |
| Pulling SuperJSON into every browser bundle             | Import codecs from `kkrpc/superjson` only where needed                                          |
| Expecting async iterables from `kkrpc`                  | Import `wrap`/`expose`/`RPCChannel` from `kkrpc/streaming` on both sides                        |
| Expecting callback return values from default callbacks | Import from `kkrpc/remote-refs` and pass `proxy(callback)`                                      |
| Returning unmarked nested functions as remote handles   | Wrap the function leaf with `proxy(fn)` in `kkrpc/remote-refs`; unmarked functions are rejected |
| Using remote refs over broadcast message buses          | Configure a point-to-point bus transport with `remotePeerId`                                    |
| Passing a remote proxy through another channel          | Keep remote proxies on the channel that decoded them, or build an explicit bridge               |
| Forgetting to dispose channels                          | Keep the controller/channel and call `dispose()` or `destroy()`                                 |
| Using old blocking IO adapter names                     | Use native transport factories that return `Transport<RPCMessage>`                              |
| Treating validation as core behavior                    | Add `validationPlugin()` explicitly through channel options                                     |
