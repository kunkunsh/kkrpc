# kkrpc

TypeScript-first bidirectional RPC for Node.js, Deno, Bun, browsers, Electron, Tauri, Chrome extensions, and message-queue-backed runtimes.

The stable API uses native `Transport<RPCMessage>` objects. The main `kkrpc` entry is browser-safe and feature-light; runtime transports and optional peer dependencies live behind subpath exports.

## Install

```bash
pnpm add kkrpc
```

Install optional peer dependencies only for the transports you use, such as `ws`, `hono`, `elysia`, `socket.io`, `amqplib`, `kafkajs`, `ioredis`, or `@nats-io/transport-node`.

## Core Usage

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

## Worker Transport

Main thread:

```ts
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const api = wrap<WorkerAPI>(workerTransport(worker))
```

Worker:

```ts
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

## WebSocket Transport

```ts
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<RemoteAPI>(webSocketClientTransport({ url: "ws://localhost:3000/rpc" }))
```

Server-side WebSocket adapters are available from `kkrpc/ws`, `kkrpc/ws/hono`, and `kkrpc/ws/elysia`.

## HTTP Transport

```ts
import { createHttpClient } from "kkrpc/http"

const { api, channel } = createHttpClient<RemoteAPI>("http://localhost:3000/rpc")
await api.ping()
channel.destroy()
```

## Validation And Middleware

Validation and middleware are plugin features and are not imported by the main entry.

```ts
import { expose } from "kkrpc"
import { middlewarePlugin } from "kkrpc/middleware"
import { validationPlugin } from "kkrpc/validation"

expose(api, transport, {
	plugins: [validationPlugin(validators), middlewarePlugin(interceptors)]
})
```

## SuperJSON

```ts
import { createTransport } from "kkrpc/transport"
import { superJsonCodec } from "kkrpc/superjson"

const transport = createTransport({ platform, codec: superJsonCodec() })
```

## Relay And Inspector

```ts
import { createInspector, MemoryBackend } from "kkrpc/inspector"
import { relayTransport } from "kkrpc/relay"

const relay = relayTransport(leftTransport, rightTransport)

const backend = new MemoryBackend()
const inspector = createInspector({ backends: [backend] })
const channel = new RPCChannel(transport, { expose: api, plugins: [inspector.plugin("server")] })
```

## Entry Points

| Entry | Purpose |
| --- | --- |
| `kkrpc` | Stable browser-safe core |
| `kkrpc/browser` | Explicit browser-safe core entry |
| `kkrpc/transport` | Transport composition primitives |
| `kkrpc/codecs` | Built-in JSON/object codecs |
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
| `kkrpc/superjson` | SuperJSON codecs |
| `kkrpc/relay` | Transport relay helper |
| `kkrpc/inspector` | Native inspector helpers |

## Migration

See `BREAKING_MIGRATION.md` for removed classic entries and migration notes.
