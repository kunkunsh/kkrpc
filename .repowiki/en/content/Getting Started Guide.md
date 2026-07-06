# Getting Started Guide

<cite>
**Referenced Files in This Document**
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json)
- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts)
- [packages/kkrpc/src/core/channel.ts](file://packages/kkrpc/src/core/channel.ts)
- [packages/kkrpc/src/transports/stdio.ts](file://packages/kkrpc/src/transports/stdio.ts)
- [packages/kkrpc/src/transports/ws.ts](file://packages/kkrpc/src/transports/ws.ts)
- [packages/kkrpc/src/entries/streaming.ts](file://packages/kkrpc/src/entries/streaming.ts)
- [packages/kkrpc/src/entries/remote-refs.ts](file://packages/kkrpc/src/entries/remote-refs.ts)
- [packages/kkrpc/src/features/validation.ts](file://packages/kkrpc/src/features/validation.ts)
- [package.json](file://package.json)
</cite>

## Table of Contents

1. [Installation](#installation)
2. [Basic Usage: Stdio Transport](#basic-usage-stdio-transport)
3. [WebSocket Client-Server](#websocket-client-server)
4. [Web Worker Communication](#web-worker-communication)
5. [Browser Usage](#browser-usage)
6. [HTTP Client-Server](#http-client-server)
7. [Next Steps](#next-steps)

## Installation

```bash
# npm
npm install kkrpc

# pnpm (used in this monorepo)
pnpm add kkrpc

# yarn
yarn add kkrpc
```

No additional dependencies are needed for the core `RPCChannel` and basic transports. Optional transports require their corresponding peer dependencies:

| Transport             | Peer Dependency                   |
| --------------------- | --------------------------------- |
| `kkrpc/ws/hono`       | `hono`                            |
| `kkrpc/ws/elysia`     | `elysia`                          |
| `kkrpc/socketio`      | `socket.io` or `socket.io-client` |
| `kkrpc/kafka`         | `kafkajs`                         |
| `kkrpc/rabbitmq`      | `amqplib`                         |
| `kkrpc/redis-streams` | `ioredis`                         |
| `kkrpc/nats`          | `nats`                            |
| `kkrpc/electron`      | `electron`                        |
| `kkrpc/tauri`         | `@tauri-apps/api`                 |
| `kkrpc/superjson`     | `superjson`                       |

**Section sources**

- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L2-L4)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L180-L240)

## Basic Usage: Stdio Transport

The simplest way to use kkrpc is between two processes over stdin/stdout:

### Server (child process)

```typescript
import { expose } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"

const api = {
	add: async (a: number, b: number) => a + b,
	ping: async () => "pong"
}

expose(api, nodeStdioTransport())
```

### Client (parent process)

```typescript
import { wrap } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"

const api = wrap<{ add(a: number, b: number): Promise<number> }>(nodeStdioTransport())

console.log(await api.add(1, 2)) // 3
```

**Section sources**

- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts#L59-L81)
- [packages/kkrpc/src/transports/stdio.ts](file://packages/kkrpc/src/transports/stdio.ts#L152-L160)

## WebSocket Client-Server

### Server (Bun)

```typescript
import { expose } from "kkrpc"
import { webSocketTransport } from "kkrpc/ws"

Bun.serve({
	port: 3000,
	fetch(req, server) {
		server.upgrade(req)
	},
	websocket: {
		open(ws) {
			const api = {
				echo: async (msg: string) => msg,
				add: async (a: number, b: number) => a + b
			}
			expose(api, webSocketTransport(ws))
		}
	}
})
```

### Client

```typescript
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<{
	echo(msg: string): Promise<string>
	add(a: number, b: number): Promise<number>
}>(webSocketClientTransport({ url: "ws://localhost:3000" }))

console.log(await api.echo("hello")) // "hello"
console.log(await api.add(3, 4)) // 7
```

**Section sources**

- [packages/kkrpc/src/transports/ws.ts](file://packages/kkrpc/src/transports/ws.ts#L55-L126)
- [packages/kkrpc/src/core/index.ts](file://packages/kkrpc/src/core/index.ts#L59-L81)

## Web Worker Communication

### Worker

```typescript
import { expose } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"

const api = {
	fibonacci: async (n: number): Promise<number> => {
		if (n <= 1) return n
		return (await api.fibonacci(n - 1)) + (await api.fibonacci(n - 2))
	}
}

expose(api, workerSelfTransport())
```

### Main Thread

```typescript
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const api = wrap<{ fibonacci(n: number): Promise<number> }>(workerTransport(worker))

console.log(await api.fibonacci(10)) // 55
```

**Section sources**

- [packages/kkrpc/src/transports/worker.ts](file://packages/kkrpc/src/transports/worker.ts)

## Browser Usage

For browser environments, use the `kkrpc/browser` entry point (which avoids Node-specific imports) with a WebSocket transport:

```typescript
import { wrap } from "kkrpc/browser"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<{ ping(): Promise<string> }>(
	webSocketClientTransport({ url: "ws://localhost:3000" })
)

await api.ping()
```

The browser entry is tree-shakeable and excludes stdio and other server-side dependencies.

**Section sources**

- [packages/kkrpc/src/entries/browser-mod.ts](file://packages/kkrpc/src/entries/browser-mod.ts)

## HTTP Client-Server

### Server

```typescript
import { expose } from "kkrpc"
import { createHttpHandler } from "kkrpc/http"

const api = { greet: async (name: string) => `Hello, ${name}!` }
const handler = createHttpHandler(api)

Bun.serve({
	port: 3000,
	async fetch(req) {
		const response = await handler(req)
		return response ?? new Response("Not Found", { status: 404 })
	}
})
```

### Client

```typescript
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"

const api = wrap<{ greet(name: string): Promise<string> }>(
	httpClientTransport({ url: "http://localhost:3000" })
)

console.log(await api.greet("World")) // "Hello, World!"
```

**Section sources**

- [packages/kkrpc/src/transports/http.ts](file://packages/kkrpc/src/transports/http.ts)

## Next Steps

- **Add validation** — See [kkrpc/validation](./Core/Core%20Features.md#runtime-validation) for Standard Schema v1 integration
- **Add middleware** — See [kkrpc/middleware](./Core/Core%20Features.md#middleware) for interceptors
- **Use remote references** — See `kkrpc/remote-refs` for Comlink-style `proxy()` references
- **Use streaming** — See `kkrpc/streaming` for async iterable support
- **Inspect traffic** — See [kkrpc/inspector](./Tooling/Inspector%20and%20Build%20Tooling.md#rpc-traffic-inspector) for observability
- **Build with HTTP/Hono/Elysia** — See `kkrpc/http`, `kkrpc/ws/hono`, `kkrpc/ws/elysia`
- **Message bus integrations** — See `kkrpc/kafka`, `kkrpc/rabbitmq`, `kkrpc/redis-streams`, `kkrpc/nats`

**Section sources**

- [packages/kkrpc/src/features/validation.ts](file://packages/kkrpc/src/features/validation.ts#L497-L508)
- [packages/kkrpc/src/features/middleware.ts](file://packages/kkrpc/src/features/middleware.ts#L79-L98)
- [packages/kkrpc/src/entries/streaming.ts](file://packages/kkrpc/src/entries/streaming.ts)
- [packages/kkrpc/src/entries/remote-refs.ts](file://packages/kkrpc/src/entries/remote-refs.ts)
