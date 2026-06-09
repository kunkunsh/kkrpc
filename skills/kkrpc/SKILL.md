---
name: kkrpc
description: Build bidirectional RPC systems in TypeScript with kkrpc. Use this skill when wiring kkrpc/next wrap/expose/RPCChannel, choosing native next transports, migrating classic RPCChannel code, integrating adapters, transferables, middleware, validation, or inspector tooling.
version: 1.1.0
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
compatibility: Works in Node.js, Deno, Bun, browsers, Electron, Tauri, Chrome extensions, and queue-backed runtimes with the correct entry point and adapter.
---

# kkrpc - TypeScript RPC Library

Use kkrpc to expose a local TypeScript object and call the remote side as a typed proxy.

For new code and migrated repo examples, prefer the native vNext API:

```typescript
import { expose, wrap } from "kkrpc/next"

const controller = expose(localAPI, serverTransport)
const remote = wrap<RemoteAPI>(clientTransport)
```

Use low-level `RPCChannel` when both sides expose APIs or when you need explicit channel ownership:

```typescript
import { RPCChannel } from "kkrpc/next"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()
```

The stable classic API remains available for existing adapter integrations:

```typescript
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(io, {
	expose: localAPI
})
const remote = channel.getAPI()
```

## First Decisions

1. Pick the entry point.
2. Pick the transport adapter.
3. Decide whether both sides expose APIs.
4. Use the examples below as the source of truth for framework integration shape.

## Next-First Migration Rules

| Situation | Use |
| --- | --- |
| New code or repo examples with native Worker/stdio/custom transport | `kkrpc/next` native API |
| Bidirectional vNext APIs | `RPCChannel` from `kkrpc/next` |
| Existing classic code with `validators` or `interceptors` options | `kkrpc/next/classic-compat` temporarily |
| Existing user-owned classic `IoInterface` adapter with no native next transport | `kkrpc/next/io` temporarily |
| Repo tests/examples for classic-only adapters | Keep classic or add a native vNext transport first |

Do not use `classic-compat` or `next/io` as the default path for new repo examples. They are migration helpers, not native vNext transports.

## Entry Points

| Runtime or adapter | Import path | Notes |
| --- | --- | --- |
| Native vNext core | `kkrpc/next` | Preferred for new code: `wrap`, `expose`, `RPCChannel` |
| Native vNext Worker | `kkrpc/next/worker` | Native Worker transports |
| Native vNext stdio | `kkrpc/next/stdio` | Native JSON-line stdio transports |
| Native vNext codecs/transports | `kkrpc/next/codecs`, `kkrpc/next/transport` | Custom native transports |
| vNext migration helpers | `kkrpc/next/classic-compat`, `kkrpc/next/io` | Temporary migration only |
| Node.js, Bun, most server adapters | `kkrpc` | Core, stdio, HTTP, WebSocket, Worker, Hono WebSocket, Elysia WebSocket |
| Browser, Web Worker, iframe, Tauri frontend | `kkrpc/browser` | Avoid Node-specific imports in browser bundles |
| Deno stdio package entry | `kkrpc/deno` or `jsr:@kunkun/kkrpc` | Use `DenoIo` |
| HTTP helpers | `kkrpc/http` | `createHttpClient`, `createHttpHandler`, plus HTTP IO classes |
| Chrome extension | `kkrpc/chrome-extension` | `ChromePortIO` |
| Electron utility process | `kkrpc/electron` | `ElectronUtilityProcessIO`, `ElectronUtilityProcessChildIO` |
| Electron ipcMain/ipcRenderer | `kkrpc/electron-ipc` | `ElectronIpcMainIO`, `ElectronIpcRendererIO`, preload bridge helpers |
| Socket.IO | `kkrpc/socketio` | Optional peer dependency |
| RabbitMQ | `kkrpc/rabbitmq` | Optional peer dependency |
| Kafka | `kkrpc/kafka` | Optional peer dependency |
| Redis Streams | `kkrpc/redis-streams` | Optional peer dependency |
| NATS | `kkrpc/nats` | Optional peer dependency |
| Inspector | `kkrpc/inspector` | Traffic logging and analysis |

## Adapter Map

| Use case | Adapter/helper | Reference examples |
| --- | --- | --- |
| Node child process stdio | `NodeIo` | `examples/electron-demo/stdio-worker.ts`, tests in `__tests__/stdio-rpc.test.ts` |
| Bun stdio | `BunIo` | `examples/tauri-demo/src/backend/bun.ts` |
| Deno stdio | `DenoIo` | `examples/deno-backend/main.ts`, `examples/tauri-demo/sample-script/deno.ts` |
| Plain HTTP POST | `HTTPServerIO`, `HTTPClientIO` | `examples/http-demo/src/http.ts`, `examples/http-demo/client.ts` |
| HTTP helper style | `createHttpHandler`, `createHttpClient` | `examples/http-demo/src/hono.ts`, `examples/http-demo/client.ts` |
| Express HTTP | `HTTPServerIO` | `examples/http-demo/src/express.ts` |
| Fastify HTTP | `HTTPServerIO` | `examples/http-demo/src/fastify.ts` |
| Bun HTTP server | `HTTPServerIO` | `examples/http-demo/src/bun.ts` |
| Deno HTTP server | `HTTPServerIO` | `examples/http-demo/src/deno.ts` |
| Standard WebSocket / `ws` | `WebSocketClientIO`, `WebSocketServerIO` | `examples/streaming-middleware-demo/` |
| Hono WebSocket | `createHonoWebSocketHandler` | `__tests__/hono-websocket.test.ts` |
| Elysia WebSocket | `ElysiaWebSocketServerIO`, `ElysiaWebSocketClientIO` | `__tests__/elysia-websocket.test.ts` |
| Socket.IO | `SocketIOServerIO`, `SocketIOClientIO` | `__tests__/socketio.test.ts` |
| Browser/Deno Worker | `WorkerParentIO`, `WorkerChildIO` | `examples/deno-webworker-demo/`, `examples/transferable-browser/` |
| iframe postMessage | `IframeParentIO`, `IframeChildIO` | `examples/iframe-worker-demo/` |
| Tauri shell plugin stdio | `TauriShellStdio` | `examples/tauri-demo/src/routes/examples/math/+page.svelte` |
| Electron utility process | `ElectronUtilityProcessIO`, `ElectronUtilityProcessChildIO` | `examples/electron-demo/electron/main.ts`, `examples/electron-demo/worker.ts` |
| Electron IPC main/renderer | `ElectronIpcMainIO`, `ElectronIpcRendererIO` | `examples/electron-demo/electron/main.ts`, `examples/electron-demo/src/App.tsx` |
| Chrome runtime port | `ChromePortIO` | `examples/chrome-extension/AGENTS.md` |
| RabbitMQ/Kafka/Redis/NATS | `RabbitMQIO`, `KafkaIO`, `RedisStreamsIO`, `NatsIO` | adapter tests under `packages/kkrpc/__tests__/` |

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

const channel = new RPCChannel<ClientAPI, ServerAPI>(io, { expose: clientAPI })
const server = channel.getAPI()

console.log(await server.math.add(1, 2))
```

Remote property access is supported:

```typescript
const counter = await api.counter
const nested = await api.nested.deepObj.prop
```

Callbacks can be passed as arguments:

```typescript
await api.process("input", (progress) => {
	console.log("progress", progress)
})
```

## HTTP Integrations

HTTP is request/response. Use raw request text and send raw response text with `Content-Type: application/json`.

### Recommended HTTP Helpers

Use helpers when the framework can give you the raw POST body.

```typescript
import { Hono } from "hono"
import { createHttpHandler } from "kkrpc/http"

const handler = createHttpHandler(apiImplementation)
const app = new Hono()

app.post("/rpc", async (c) => {
	return c.text(await handler.handleRequest(await c.req.text()))
})

export default {
	port: 3000,
	fetch: app.fetch
}
```

Client:

```typescript
import { createHttpClient } from "kkrpc/http"

const { api, channel } = createHttpClient<RemoteAPI>("http://localhost:3000/rpc")
console.log(await api.math.grade1.add(5, 3))
```

### Plain Node HTTP

```typescript
import { createServer } from "node:http"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
new RPCChannel<ServerAPI, ServerAPI>(serverIO, { expose: apiImplementation })

createServer(async (req, res) => {
	if (req.url === "/rpc" && req.method === "POST") {
		const chunks: Buffer[] = []
		for await (const chunk of req) chunks.push(Buffer.from(chunk))
		const response = await serverIO.handleRequest(Buffer.concat(chunks).toString("utf-8"))
		res.setHeader("Content-Type", "application/json")
		res.end(response)
		return
	}
	res.writeHead(404).end("Not found")
}).listen(3000)
```

### Express

Important: parse the body as text, not as JSON.

```typescript
import express from "express"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const app = express()
const serverIO = new HTTPServerIO()
new RPCChannel<ServerAPI, ServerAPI>(serverIO, { expose: apiImplementation })

app.use(express.text({ type: "application/json" }))
app.post("/rpc", async (req, res) => {
	const response = await serverIO.handleRequest(req.body)
	res.type("application/json").send(response)
})
```

### Fastify

Important: register a string parser for `application/json`.

```typescript
import Fastify from "fastify"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const app = Fastify()
const serverIO = new HTTPServerIO()
new RPCChannel<ServerAPI, ServerAPI>(serverIO, { expose: apiImplementation })

app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
	done(null, body)
})

app.post("/rpc", async (request, reply) => {
	const response = await serverIO.handleRequest(request.body as string)
	reply.type("application/json").send(response)
})
```

### Bun HTTP

```typescript
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
new RPCChannel<ServerAPI, ServerAPI>(serverIO, { expose: apiImplementation })

Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname === "/rpc" && req.method === "POST") {
			const response = await serverIO.handleRequest(await req.text())
			return new Response(response, { headers: { "Content-Type": "application/json" } })
		}
		return new Response("Not found", { status: 404 })
	}
})
```

### Deno HTTP

```typescript
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
new RPCChannel<ServerAPI, ServerAPI>(serverIO, { expose: apiImplementation })

Deno.serve({ port: 3000 }, async (request) => {
	const url = new URL(request.url)
	if (url.pathname === "/rpc" && request.method === "POST") {
		const response = await serverIO.handleRequest(await request.text())
		return new Response(response, { headers: { "Content-Type": "application/json" } })
	}
	return new Response("Not found", { status: 404 })
})
```

## WebSocket Integrations

### Standard WebSocket or `ws`

Server:

```typescript
import { RPCChannel, WebSocketServerIO } from "kkrpc"
import { WebSocketServer } from "ws"

const wss = new WebSocketServer({ port: 3100 })

wss.on("connection", (ws) => {
	const io = new WebSocketServerIO(ws)
	new RPCChannel<ServerAPI, ClientAPI>(io, { expose: serverAPI })
})
```

Client:

```typescript
import { RPCChannel, WebSocketClientIO } from "kkrpc"

const io = new WebSocketClientIO({ url: "ws://localhost:3100" })
const rpc = new RPCChannel<ClientAPI, ServerAPI>(io, { expose: clientAPI })
const api = rpc.getAPI()
```

### Hono WebSocket

Use the helper with Hono's `upgradeWebSocket`. For Bun, pass Hono's `websocket` object to `Bun.serve`.

```typescript
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { createHonoWebSocketHandler } from "kkrpc"

const app = new Hono()

app.get(
	"/ws",
	upgradeWebSocket(() =>
		createHonoWebSocketHandler<ServerAPI>({
			expose: serverAPI
		})
	)
)

Bun.serve({
	port: 3000,
	fetch: app.fetch,
	websocket
})
```

Client:

```typescript
import { RPCChannel, WebSocketClientIO } from "kkrpc"

const io = new WebSocketClientIO({ url: "ws://localhost:3000/ws" })
const rpc = new RPCChannel<ClientAPI, ServerAPI>(io, { expose: clientAPI })
const api = rpc.getAPI()
```

### Elysia WebSocket

Use `ElysiaWebSocketServerIO` in `open`, then feed messages from Elysia's `message` callback.

```typescript
import { Elysia } from "elysia"
import { ElysiaWebSocketServerIO, RPCChannel } from "kkrpc"

new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)
			new RPCChannel<ServerAPI, ClientAPI>(io, { expose: serverAPI })
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)
```

Client:

```typescript
import { ElysiaWebSocketClientIO, RPCChannel } from "kkrpc"

const io = new ElysiaWebSocketClientIO("ws://localhost:3000/rpc")
const rpc = new RPCChannel<ClientAPI, ServerAPI>(io, { expose: clientAPI })
const api = rpc.getAPI()
```

`ElysiaWebSocketServerIO` can also read connection metadata:

```typescript
const info = {
	remoteAddress: io.getRemoteAddress(),
	query: io.getQuery(),
	headers: io.getHeaders()
}
```

### Socket.IO

```typescript
import { createServer } from "node:http"
import { Server as SocketIOServer } from "socket.io"
import { RPCChannel } from "kkrpc"
import { SocketIOClientIO, SocketIOServerIO } from "kkrpc/socketio"

const httpServer = createServer()
const socketServer = new SocketIOServer(httpServer, {
	cors: { origin: "*", methods: ["GET", "POST"] }
})

socketServer.on("connection", (socket) => {
	const io = new SocketIOServerIO(socket)
	new RPCChannel<ServerAPI, ClientAPI>(io, { expose: serverAPI })
})

httpServer.listen(3000)

const clientIO = new SocketIOClientIO({
	url: "http://localhost:3000",
	opts: { transports: ["websocket"], timeout: 5000 }
})
const api = new RPCChannel<ClientAPI, ServerAPI>(clientIO, { expose: clientAPI }).getAPI()
```

Namespace client:

```typescript
const io = new SocketIOClientIO({
	url: "http://localhost:3000",
	namespace: "test"
})
```

## Worker and Browser Contexts

### Browser or Deno Worker

Main thread:

```typescript
import { RPCChannel, WorkerParentIO } from "kkrpc/browser"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<MainAPI, WorkerAPI>(io, { expose: mainAPI })
const workerAPI = rpc.getAPI()
```

Worker:

```typescript
import { RPCChannel, WorkerChildIO } from "kkrpc/browser"

const io = new WorkerChildIO()
const rpc = new RPCChannel<WorkerAPI, MainAPI>(io, { expose: workerAPI })
const mainAPI = rpc.getAPI()
```

Deno native Worker examples can import from `kkrpc` if the import map points to `packages/kkrpc/mod.ts`.

### Transferable Objects

Use transferables only on adapters whose capabilities support structured clone and transfer, such as Worker adapters. Enable transfer unless intentionally disabling it.

Main:

```typescript
import { RPCChannel, WorkerParentIO, transfer } from "kkrpc/browser"

const rpc = new RPCChannel<MainAPI, WorkerAPI>(new WorkerParentIO(worker), {
	expose: mainAPI,
	enableTransfer: true
})
const api = rpc.getAPI()

const buffer = new ArrayBuffer(1024 * 1024)
const result = await api.processBuffer(transfer(buffer, [buffer]))
console.log(buffer.byteLength) // 0 when actually transferred
```

Worker returning a transferred buffer:

```typescript
import { RPCChannel, WorkerChildIO, transfer } from "kkrpc/browser"

const workerAPI: WorkerAPI = {
	async provideBuffer(size) {
		const buffer = new ArrayBuffer(size)
		return {
			buffer: transfer(buffer, [buffer]),
			checksum: checksum(buffer)
		}
	}
}

new RPCChannel<WorkerAPI, MainAPI>(new WorkerChildIO(), { expose: workerAPI })
```

### iframe postMessage

Parent page:

```typescript
import { IframeParentIO, RPCChannel } from "kkrpc/browser"

const iframe = document.querySelector("iframe")
if (!iframe?.contentWindow) throw new Error("iframe not ready")

const io = new IframeParentIO(iframe.contentWindow)
const rpc = new RPCChannel<ParentAPI, IframeAPI>(io, { expose: parentAPI })
const iframeAPI = rpc.getAPI()
```

Iframe page:

```typescript
import { IframeChildIO, RPCChannel } from "kkrpc/browser"

const io = new IframeChildIO()
const rpc = new RPCChannel<IframeAPI, ParentAPI>(io, { expose: iframeAPI })
const parentAPI = rpc.getAPI()
```

Destroy iframe/worker IO on component unmount:

```typescript
io.destroy()
```

## Stdio and Process RPC

### Node child process

Parent:

```typescript
import { spawn } from "node:child_process"
import { NodeIo, RPCChannel } from "kkrpc"

const child = spawn("node", ["worker.js"])
const io = new NodeIo(child.stdout, child.stdin)
const rpc = new RPCChannel<ParentAPI, WorkerAPI>(io, { expose: parentAPI })
const workerAPI = rpc.getAPI()
```

Worker:

```typescript
import { NodeIo, RPCChannel } from "kkrpc"

const io = new NodeIo(process.stdin, process.stdout)
new RPCChannel<WorkerAPI, ParentAPI>(io, { expose: workerAPI })
```

Write logs to stderr in stdio workers so stdout remains available for RPC frames:

```typescript
console.error("worker ready")
```

### Bun and Deno stdio

```typescript
import { BunIo, RPCChannel } from "kkrpc"

new RPCChannel<API, RemoteAPI>(new BunIo(), { expose: api })
```

```typescript
import { DenoIo, RPCChannel } from "kkrpc/deno"

new RPCChannel<API, RemoteAPI>(new DenoIo(), { expose: api })
```

## Tauri

Use `TauriShellStdio` from the browser entry with `@tauri-apps/plugin-shell`.

```typescript
import { Command } from "@tauri-apps/plugin-shell"
import { RPCChannel, TauriShellStdio } from "kkrpc/browser"

const cmd = Command.create("deno", ["run", "-A", scriptPath])
const child = await cmd.spawn()

const io = new TauriShellStdio(cmd.stdout, child)
const rpc = new RPCChannel<FrontendAPI, ScriptAPI>(io, { expose: frontendAPI })
const scriptAPI = rpc.getAPI()

console.log(await scriptAPI.fibonacci(10))
```

The script side uses the matching runtime stdio adapter:

```typescript
import { DenoIo, RPCChannel } from "kkrpc"

new RPCChannel<ScriptAPI, FrontendAPI>(new DenoIo(), { expose: scriptAPI })
```

## Electron

### Renderer to Main via ipcMain/ipcRenderer

Main process:

```typescript
import { BrowserWindow, ipcMain } from "electron"
import { RPCChannel } from "kkrpc/electron-ipc"
import { ElectronIpcMainIO } from "kkrpc/electron-ipc"

const win = new BrowserWindow({
	webPreferences: {
		preload: "preload.mjs",
		contextIsolation: true,
		nodeIntegration: false
	}
})

const io = new ElectronIpcMainIO(ipcMain, win.webContents)
const rpc = new RPCChannel<MainAPI, RendererAPI>(io, { expose: mainAPI })
const rendererAPI = rpc.getAPI()
```

Renderer:

```typescript
import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"

const io = new ElectronIpcRendererIO()
const rpc = new RPCChannel<RendererAPI, MainAPI>(io, { expose: rendererAPI })
const mainAPI = rpc.getAPI()
```

Use a custom channel when relaying another transport:

```typescript
const io = new ElectronIpcRendererIO("kkrpc-stdio-relay")
```

### Electron utility process

Main:

```typescript
import { utilityProcess } from "electron"
import { ElectronUtilityProcessIO, RPCChannel } from "kkrpc/electron"

const child = utilityProcess.fork("./worker.js")
const io = new ElectronUtilityProcessIO(child)
const rpc = new RPCChannel<MainAPI, WorkerAPI>(io, { expose: mainAPI })
const workerAPI = rpc.getAPI()
```

Utility child:

```typescript
import { ElectronUtilityProcessChildIO, RPCChannel } from "kkrpc/electron"

const io = new ElectronUtilityProcessChildIO()
const rpc = new RPCChannel<WorkerAPI, MainAPI>(io, { expose: workerAPI })
const mainAPI = rpc.getAPI()
```

### Relay two transports

Use `createRelay` to bridge transports, for example Electron IPC renderer <-> main <-> stdio worker.

```typescript
import { createRelay, NodeIo } from "kkrpc"
import { ElectronIpcMainIO } from "kkrpc/electron-ipc"

const stdioIO = new NodeIo(child.stdout, child.stdin)
const ipcIO = new ElectronIpcMainIO(ipcMain, win.webContents, "kkrpc-stdio-relay")
const relay = createRelay(ipcIO, stdioIO)

// later
relay.destroy()
```

## Chrome Extension

Use `ChromePortIO` for long-lived `chrome.runtime.Port` connections.

Content script or UI page:

```typescript
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"

const port = chrome.runtime.connect({ name: "content-to-popup" })
const io = new ChromePortIO(port)
const rpc = new RPCChannel<ContentAPI, PopupAPI>(io, { expose: contentAPI })
const popupAPI = rpc.getAPI()
```

Background/service worker or receiver:

```typescript
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"

chrome.runtime.onConnect.addListener((port) => {
	const io = new ChromePortIO(port)
	new RPCChannel<PopupAPI, ContentAPI>(io, { expose: popupAPI })
})
```

## Message Queues

Queue adapters are optional peer dependencies and all implement `IoInterface`. They are useful when both peers share the same broker topic/stream/exchange.

### RabbitMQ

```typescript
import { RPCChannel } from "kkrpc"
import { RabbitMQIO } from "kkrpc/rabbitmq"

const io = new RabbitMQIO({
	url: "amqp://localhost",
	exchange: "kkrpc-exchange",
	routingKeyPrefix: "kkrpc",
	sessionId: "service-a"
})

const rpc = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localAPI })
const api = rpc.getAPI()
```

### Kafka

```typescript
import { RPCChannel } from "kkrpc"
import { KafkaIO } from "kkrpc/kafka"

const io = new KafkaIO({
	brokers: ["localhost:9092"],
	topic: "kkrpc-topic",
	groupId: "service-a",
	sessionId: "service-a"
})

const api = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localAPI }).getAPI()
```

### Redis Streams

```typescript
import { RPCChannel } from "kkrpc"
import { RedisStreamsIO } from "kkrpc/redis-streams"

const io = new RedisStreamsIO({
	url: "redis://localhost:6379",
	stream: "kkrpc-stream",
	useConsumerGroup: false,
	sessionId: "service-a"
})

const api = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localAPI }).getAPI()
```

Set `useConsumerGroup: true` only when you intentionally want load balancing semantics.

### NATS

```typescript
import { RPCChannel } from "kkrpc"
import { NatsIO } from "kkrpc/nats"

const io = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "kkrpc.messages",
	sessionId: "service-a"
})

const api = new RPCChannel<LocalAPI, RemoteAPI>(io, { expose: localAPI }).getAPI()
```

## Streaming and Middleware

Server methods can return `AsyncIterable` values. The client receives an async iterable and consumes it with `for await`.

```typescript
type API = {
	countdown(n: number): Promise<AsyncIterable<number>>
}

const api: API = {
	async countdown(n) {
		return (async function* () {
			for (let i = n; i >= 0; i--) {
				yield i
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
		})()
	}
}

const stream = await remote.countdown(5)
for await (const value of stream) {
	console.log(value)
	if (value === 2) break
}
```

Interceptors run on the receiving side after input validation and before output validation.

```typescript
import type { RPCInterceptor } from "kkrpc"

const logger: RPCInterceptor = async (ctx, next) => {
	console.log(ctx.method, ctx.args)
	return next()
}

const auth: RPCInterceptor = async (ctx, next) => {
	if (ctx.method === "getSecretData" && !ctx.state.authenticated) {
		throw new Error("Unauthorized")
	}
	return next()
}

new RPCChannel<ServerAPI, ClientAPI>(io, {
	expose: serverAPI,
	interceptors: [logger, auth]
})
```

For per-connection state, create interceptor instances inside the connection callback and close over a session object.

## Validation

kkrpc supports Standard Schema-compatible validators such as Zod, Valibot, and ArkType. Validators apply to the locally exposed API.

```typescript
import { RPCChannel, type RPCValidators } from "kkrpc"
import { z } from "zod"

type MathAPI = {
	add(a: number, b: number): Promise<number>
}

const validators: RPCValidators<MathAPI> = {
	add: {
		input: z.tuple([z.number(), z.number()]),
		output: z.number()
	}
}

new RPCChannel<MathAPI, RemoteAPI>(io, {
	expose: mathAPI,
	validators
})
```

Schema-first helpers are also available:

```typescript
import { defineAPI, defineMethod, extractValidators } from "kkrpc"
import { z } from "zod"

const api = defineAPI({
	add: defineMethod({
		input: z.tuple([z.number(), z.number()]),
		output: z.number(),
		handler: async (a, b) => a + b
	})
})

new RPCChannel(io, {
	expose: api,
	validators: extractValidators(api)
})
```

Validation errors are `RPCValidationError` and include phase, method path, and issues.

## Timeouts and Errors

Set outgoing call timeout on the channel:

```typescript
const rpc = new RPCChannel<LocalAPI, RemoteAPI>(io, {
	expose: localAPI,
	timeout: 5000
})
```

Timeouts throw `RPCTimeoutError`; use `isRPCTimeoutError(error)` instead of `instanceof` across process boundaries.

```typescript
import { isRPCTimeoutError } from "kkrpc"

try {
	await api.slowMethod()
} catch (error) {
	if (isRPCTimeoutError(error)) {
		console.log(error.method, error.timeoutMs)
	}
}
```

Thrown errors preserve name, message, stack, and custom properties through serialization.

## Serialization

Default serialization is SuperJSON, which supports Date, Map, Set, BigInt, Uint8Array, and richer JavaScript values.

Use JSON for cross-language interop:

```typescript
new RPCChannel<LocalAPI, RemoteAPI>(io, {
	expose: localAPI,
	serialization: { version: "json" }
})
```

Receiver auto-detects the message format.

## Inspector

Use the inspector when you need traffic visibility, file logs, or in-memory analysis. See `examples/inspector-demo/`.

```typescript
import { consolePrettyBackend, createInspector, FileBackend, MemoryBackend } from "kkrpc/inspector"

const memory = new MemoryBackend()
const inspector = createInspector({
	backends: [consolePrettyBackend, new FileBackend({ path: "./inspector.log" }), memory],
	options: {
		trackLatency: true
	}
})

const io = inspector.wrap(rawIo, "client-session")
```

Wrap the transport IO before passing it to `RPCChannel`.

## Cleanup

Destroy IO/channel objects when the owning process, socket, worker, iframe, component, or window closes.

```typescript
io.destroy()
channel.destroy()
```

For WebSocket-like adapters, `signalDestroy()` can notify the peer before local close.

```typescript
await io.signalDestroy()
```

## Project Conventions

- Do not edit `dist/` or generated `docs/`.
- Browser code should import from `kkrpc/browser`; do not pull Node-specific modules into browser bundles.
- HTTP framework adapters must receive raw request text; do not parse the RPC body as JSON first.
- In stdio workers, write diagnostics to stderr, not stdout.
- Prefer explicit `LocalAPI` and `RemoteAPI` types over untyped channels.
- Avoid type suppression such as `@ts-ignore`, `@ts-expect-error`, and `as any`.
- Use real client/server/worker setups in tests; this project generally avoids mocks.
- For adapter details, inspect `packages/kkrpc/src/adapters/<adapter>.ts` and matching tests under `packages/kkrpc/__tests__/`.
