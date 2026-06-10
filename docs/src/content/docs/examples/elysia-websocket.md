---
title: Elysia WebSocket
description: Make RPC calls over Elysia WebSocket routes
---

The Elysia integration exposes native kkrpc APIs over an Elysia WebSocket route.

```ts title="server.ts"
import { Elysia } from "elysia"
import { createElysiaWebSocketHandler } from "kkrpc/ws/elysia"

const api = {
	greet: (name: string) => `Hello, ${name}!`,
	add: (a: number, b: number) => a + b
}

new Elysia()
	.ws("/rpc", createElysiaWebSocketHandler({ expose: api }))
	.listen(3000)
```

```ts title="client.ts"
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

type API = typeof api

const remote = wrap<API>(webSocketClientTransport("ws://localhost:3000/rpc"))

console.log(await remote.greet("World"))
console.log(await remote.add(5, 3))
```

For lower-level framework integration, use `elysiaWebSocketTransport(ws)` and feed incoming route messages into the returned transport.
