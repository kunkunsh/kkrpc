# kkrpc

<div align="center">

[![npm version](https://img.shields.io/npm/v/kkrpc?style=flat-square&logo=npm)](https://www.npmjs.com/package/kkrpc)
[![JSR](https://jsr.io/badges/@kunkun/kkrpc)](https://jsr.io/@kunkun/kkrpc)
[![License](https://img.shields.io/npm/l/kkrpc?style=flat-square)](https://github.com/kunkunsh/kkrpc/blob/main/LICENSE)
[![GitHub](https://img.shields.io/badge/github-kunkunsh%2Fkkrpc-black?style=flat-square&logo=github)](https://github.com/kunkunsh/kkrpc)
[![Docs](https://img.shields.io/badge/docs-kkrpc.kunkun.sh-blue?style=flat-square)](https://docs.kkrpc.kunkun.sh/)
[![Typedoc](https://img.shields.io/badge/api-typedoc-blue?style=flat-square&logo=typescript)](https://kunkunsh.github.io/kkrpc/)

![kkRPC Banner](https://imgur.com/19XswxO.jpg)

TypeScript-first RPC for runtimes, processes, windows, workers, desktop IPC, and message buses.

</div>

`kkrpc` lets two endpoints call each other through type-safe proxy objects. Expose an API on one side, wrap a transport on the other side, and call remote functions, nested methods, properties, constructors, and callback arguments like local code.

The stable API is built on native `Transport<RPCMessage>` objects. The main `kkrpc` entry is browser-safe and feature-light; runtime transports and optional peer dependencies live behind subpath exports.

## Why kkrpc

| Feature | kkrpc | tRPC | Comlink |
| --- | --- | --- | --- |
| Type-safe remote calls | Yes | Yes | Yes |
| Bidirectional APIs | Yes | No | Yes |
| Browser-safe core entry | Yes | Mostly HTTP app focused | Browser focused |
| Node.js, Deno, Bun stdio | Yes | No | No |
| WebSocket and HTTP | Yes | HTTP focused | No |
| Workers and iframes | Yes | No | Yes |
| Electron, Tauri, Chrome extension | Yes | No | No |
| Message buses | RabbitMQ, Kafka, Redis Streams, NATS | No | No |
| Callback arguments | Evented transports | No | Yes |
| Optional runtime validation | Standard Schema | Zod-oriented | No |
| Middleware/interceptors | Yes | Yes | No |
| Transferable objects | Where supported | No | Yes |
| Code generation required | No | No | No |

Choose `kkrpc` when the hard part is not just an HTTP API. It is designed for cross-runtime systems: browser to worker, renderer to main process, app to plugin host, web server to child process, or one service connected to another through a message bus.

## Install

```bash
npm install kkrpc
```

```bash
pnpm add kkrpc
```

```bash
bun add kkrpc
```

For Deno and JSR:

```bash
deno add jsr:@kunkun/kkrpc
```

Install optional peer dependencies only for the transports you use, such as `ws`, `hono`, `elysia`, `socket.io`, `amqplib`, `kafkajs`, `ioredis`, or `@nats-io/transport-node`.

## Quick Start

```ts
import { expose, wrap } from "kkrpc"

const controller = expose(localAPI, serverTransport)
const remote = wrap<RemoteAPI>(clientTransport)

await remote.ping()
controller.dispose()
```

Use `RPCChannel` when both sides expose APIs or when explicit channel ownership is useful:

```ts
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()

await remote.math.add(1, 2)
channel.destroy()
```

`RPCChannel.getAPI()` is typed from the channel generic. For one-way clients, `wrap<RemoteAPI>(transport)` is the shortest path.

## WebSocket Example

```ts title="server.ts"
import { expose } from "kkrpc"
import { webSocketTransport } from "kkrpc/ws"
import { WebSocketServer } from "ws"

const api = {
	math: {
		add(a: number, b: number) {
			return a + b
		}
	},
	async greet(name: string) {
		return `Hello, ${name}`
	}
}

export type API = typeof api

const wss = new WebSocketServer({ port: 3000 })

wss.on("connection", (socket) => {
	expose(api, webSocketTransport(socket))
})
```

```ts title="client.ts"
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { API } from "./server"

const api = wrap<API>(webSocketClientTransport({ url: "ws://localhost:3000" }))

console.log(await api.greet("World"))
console.log(await api.math.add(1, 2))
```

## Worker Example

Main thread:

```ts
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"
import type { WorkerAPI } from "./worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const api = wrap<WorkerAPI>(workerTransport(worker))

console.log(await api.ping())
```

Worker:

```ts
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

## HTTP Example

HTTP is unary request/response. It is useful for normal web APIs, but it cannot carry callback arguments and the server cannot initiate calls back to the client.

```ts title="server.ts"
import { createHttpHandler } from "kkrpc/http"

const api = {
	async add(a: number, b: number) {
		return a + b
	}
}

export type API = typeof api

const handler = createHttpHandler(api)

Bun.serve({
	port: 3000,
	fetch(request) {
		const url = new URL(request.url)
		if (url.pathname === "/rpc") return handler(request)
		return new Response("Not found", { status: 404 })
	}
})
```

```ts title="client.ts"
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"
import type { API } from "./server"

const api = wrap<API>(httpClientTransport({ url: "http://localhost:3000/rpc" }))

console.log(await api.add(2, 3))
```

## Stdio Example

Stdio transports are useful for plugin hosts, subprocess workers, command-line tools, and language interop tests.

```ts title="child.ts"
import { expose } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"

const api = {
	async version() {
		return process.version
	}
}

export type ChildAPI = typeof api

expose(api, nodeStdioTransport({ readable: process.stdin, writable: process.stdout }))
```

```ts title="parent.ts"
import { spawn } from "node:child_process"
import { wrap } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import type { ChildAPI } from "./child"

const child = spawn("node", ["child.js"])
const api = wrap<ChildAPI>(nodeStdioTransport({ readable: child.stdout, writable: child.stdin }))

console.log(await api.version())
```

## Property Access

Remote proxies can read and write exposed properties. Remote reads are asynchronous.

```ts
interface SettingsAPI {
	counter: number
	settings: {
		theme: string
	}
}

const api = wrap<SettingsAPI>(transport)

console.log(await api.counter)
console.log(await api.settings.theme)

api.counter = 42
api.settings.theme = "dark"
```

## Callback Arguments

Evented transports can pass callback arguments by reference. The channel stores the callback locally and sends a callback marker to the remote endpoint.

```ts
type RemoteAPI = {
	onProgress(taskId: string, callback: (percent: number) => void): Promise<void>
}

const api = wrap<RemoteAPI>(transport)

await api.onProgress("build", (percent) => {
	console.log(`Progress: ${percent}%`)
})
```

## Transferable Objects

Use `transfer()` when a transport supports zero-copy ownership transfer, such as Web Workers.

```ts
import { transfer } from "kkrpc"

const buffer = new ArrayBuffer(1024 * 1024)
await api.processBuffer(transfer(buffer, [buffer]))
```

The transport advertises support through its capabilities. Unsupported transports fall back to normal serialization behavior.

## Validation

Runtime validation is opt-in and uses Standard Schema compatible validators such as Zod, Valibot, and ArkType.

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

export type API = typeof api

expose(api, transport, {
	plugins: [validationPlugin(extractValidators(api))]
})
```

## Middleware

Middleware wraps local handler execution with an onion-style interceptor chain.

```ts
import { expose } from "kkrpc"
import { middlewarePlugin, type RPCInterceptor } from "kkrpc/middleware"

const logger: RPCInterceptor = async (ctx, next) => {
	console.log("rpc:start", ctx.method, ctx.args)
	const result = await next()
	console.log("rpc:end", ctx.method)
	return result
}

expose(api, transport, {
	plugins: [middlewarePlugin([logger])]
})
```

## SuperJSON

The core protocol is JSON-compatible. Use the SuperJSON codec when you need richer values such as `Date`, `Map`, `Set`, or `BigInt` on transports created through `createTransport()`.

```ts
import { createTransport } from "kkrpc/transport"
import { superJsonCodec } from "kkrpc/superjson"

const transport = createTransport({ platform, codec: superJsonCodec() })
```

## Relay

`relayTransport()` forwards messages between two native transports without knowing either side's API. This is useful when a process is only a bridge.

```ts
import { relayTransport } from "kkrpc/relay"

const relay = relayTransport(rendererTransport, workerTransport)

relay.dispose()
```

## Inspector

Inspector plugins observe requests, responses, and errors without changing the API implementation.

```ts
import { RPCChannel } from "kkrpc"
import { createInspector, MemoryBackend } from "kkrpc/inspector"

const backend = new MemoryBackend()
const inspector = createInspector({ backends: [backend] })
const channel = new RPCChannel(transport, { expose: api, plugins: [inspector.plugin("server")] })
```

## Supported Transports

| Transport | Entry | Notes |
| --- | --- | --- |
| Web Worker | `kkrpc/worker` | Main-thread and worker-global helpers |
| stdio | `kkrpc/stdio` | Node.js, Deno, and Bun process pipes |
| HTTP | `kkrpc/http` | Unary request/response only |
| WebSocket | `kkrpc/ws` | Bidirectional socket transport |
| Hono WebSocket | `kkrpc/ws/hono` | Framework handler for Hono |
| Elysia WebSocket | `kkrpc/ws/elysia` | Framework handler for Elysia |
| iframe | `kkrpc/iframe` | Parent/child `postMessage` transport |
| Chrome extension | `kkrpc/chrome-extension` | `chrome.runtime.Port` transport |
| Electron | `kkrpc/electron` | IPC endpoint and utility process transports |
| Tauri | `kkrpc/tauri` | Tauri event and shell process transports |
| Socket.IO | `kkrpc/socketio` | Socket.IO-backed event transport |
| RabbitMQ | `kkrpc/rabbitmq` | AMQP transport |
| Kafka | `kkrpc/kafka` | Kafka topic transport |
| Redis Streams | `kkrpc/redis-streams` | Redis stream transport |
| NATS | `kkrpc/nats` | NATS subject transport |

## Entry Points

| Entry | Purpose |
| --- | --- |
| `kkrpc` | Stable browser-safe core |
| `kkrpc/browser` | Explicit browser-safe core entry |
| `kkrpc/deno` | Deno-friendly core entry |
| `kkrpc/transport` | Transport composition primitives |
| `kkrpc/codecs` | Built-in JSON/object codecs |
| `kkrpc/plugins` | Plugin types and helpers |
| `kkrpc/worker` | Web Worker transports |
| `kkrpc/stdio` | Node/Deno/Bun stdio transports |
| `kkrpc/http` | HTTP client and handler helpers |
| `kkrpc/ws` | WebSocket transports |
| `kkrpc/ws/hono` | Hono WebSocket integration |
| `kkrpc/ws/elysia` | Elysia WebSocket integration |
| `kkrpc/iframe` | iframe transports |
| `kkrpc/chrome-extension` | Chrome extension port transports |
| `kkrpc/electron` | Electron transports |
| `kkrpc/tauri` | Tauri transports |
| `kkrpc/socketio` | Socket.IO transports |
| `kkrpc/rabbitmq` | RabbitMQ transports |
| `kkrpc/kafka` | Kafka transports |
| `kkrpc/redis-streams` | Redis Streams transports |
| `kkrpc/nats` | NATS transports |
| `kkrpc/validation` | Standard Schema validation plugin |
| `kkrpc/middleware` | Middleware plugin |
| `kkrpc/superjson` | SuperJSON codec |
| `kkrpc/relay` | Transport relay helper |
| `kkrpc/inspector` | Native inspector helpers |

## Package Links

| Platform | Package | Link |
| --- | --- | --- |
| npm | `kkrpc` | <https://www.npmjs.com/package/kkrpc> |
| JSR | `@kunkun/kkrpc` | <https://jsr.io/@kunkun/kkrpc> |
| Documentation | Starlight docs | <https://docs.kkrpc.kunkun.sh/> |
| API reference | Typedoc | <https://kunkunsh.github.io/kkrpc/> |
| Examples | Source examples | <https://github.com/kunkunsh/kkrpc/tree/main/examples> |

## Migration

The stable native API removed the classic `IoInterface` adapter model and the temporary `next` entries. Use native `Transport<RPCMessage>` factories from the subpath exports listed above.

See [`BREAKING_MIGRATION.md`](./BREAKING_MIGRATION.md) for migration notes.

## License

MIT © kunkunsh
