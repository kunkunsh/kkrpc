---
title: Hono Websocket
---

The Hono WebSocket transport integrates kkrpc with Hono's WebSocket support. It uses the stable compact protocol and exposes a `createHonoWebSocketHandler()` helper from `kkrpc/ws/hono`.

## Features

- High-performance Hono WebSocket integration
- Cross-runtime support across Bun, Deno, Node.js, and Cloudflare Workers where Hono WebSocket upgrades are available
- Type-safe bidirectional RPC
- Automatic connection lifecycle handling

## Installation

```bash
npm install kkrpc hono
pnpm add kkrpc hono
bun add kkrpc hono
```

## Basic Example

### Server Setup

```typescript
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { createHonoWebSocketHandler } from "kkrpc/ws/hono"

const app = new Hono()

const api = {
	greet: (name: string) => `Hello, ${name}!`,
	add: (a: number, b: number) => a + b,
	math: {
		multiply: (a: number, b: number) => a * b
	}
}

export type API = typeof api

app.get(
	"/ws",
	upgradeWebSocket(() =>
		createHonoWebSocketHandler({
			expose: api
		})
	)
)

const server = Bun.serve({
	port: 3000,
	fetch: app.fetch,
	websocket
})

console.log(`Server running on port ${server.port}`)
```

### Client Connection

```typescript
import { RPCChannel } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { API } from "./server"

const transport = webSocketClientTransport({
	url: "ws://localhost:3000/ws"
})

const channel = new RPCChannel(transport, {
	expose: {
		getClientInfo: () => ({ type: "web-client", version: "1.0.0" })
	}
})

const api = channel.getAPI<API>()

console.log(await api.greet("World"))
console.log(await api.add(5, 3))
console.log(await api.math.multiply(4, 6))

channel.destroy()
transport.close?.()
```

## Custom API Types

```typescript
import { createHonoWebSocketHandler } from "kkrpc/ws/hono"

interface User {
	id: string
	name: string
}

interface ServerAPI {
	getUsers(): Promise<User[]>
	createUser(userData: Omit<User, "id">): Promise<User>
	updateUser(id: string, updates: Partial<User>): Promise<User>
}

const serverAPI: ServerAPI = {
	async getUsers() {
		return await db.users.findMany()
	},
	async createUser(userData) {
		return await db.users.create({ data: userData })
	},
	async updateUser(id, updates) {
		return await db.users.update({ where: { id }, data: updates })
	}
}

app.get(
	"/ws",
	upgradeWebSocket(() =>
		createHonoWebSocketHandler<ServerAPI>({
			expose: serverAPI,
			timeout: 10_000
		})
	)
)
```

## With Middleware

```typescript
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { createHonoWebSocketHandler } from "kkrpc/ws/hono"

const app = new Hono()

app.use("*", cors())
app.use("*", logger())

app.get(
	"/ws",
	upgradeWebSocket(() =>
		createHonoWebSocketHandler({
			expose: api
		})
	)
)
```

## Runtime Notes

Use the Hono WebSocket upgrade helper for your runtime, then return `createHonoWebSocketHandler({ expose })` from the upgrade callback.

```text
// Bun
import { upgradeWebSocket, websocket } from "hono/bun"

// Deno
import { upgradeWebSocket } from "hono/deno"

// Node.js
import { upgradeWebSocket } from "hono/node"
```

## Cleanup

The Hono helper destroys its per-connection channel when the socket closes or errors. Client code should call `channel.destroy()` and `transport.close?.()` when it no longer needs the connection.
