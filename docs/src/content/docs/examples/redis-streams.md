---
title: Redis Streams
description: Make RPC calls over Redis Streams
---

Redis Streams support kkrpc through the native `redisStreamsTransport()` factory. Each peer needs a stable `localPeerId`; set `remotePeerId` when a client should target a specific service peer.

## Request/Response Pair

```ts title="server.ts"
import { RPCChannel } from "kkrpc"
import { redisStreamsTransport } from "kkrpc/redis-streams"

const api = {
	add: async (a: number, b: number) => a + b,
	greet: async (name: string) => `Hello, ${name}!`
}

const transport = redisStreamsTransport({
	url: "redis://localhost:6379",
	stream: "math-rpc",
	localPeerId: "server"
})

const channel = new RPCChannel(transport, { expose: api })

process.on("SIGINT", async () => {
	channel.destroy()
	await transport.close?.()
})
```

```ts title="client.ts"
import { RPCChannel } from "kkrpc"
import { redisStreamsTransport } from "kkrpc/redis-streams"
import type { api } from "./server"

const transport = redisStreamsTransport({
	url: "redis://localhost:6379",
	stream: "math-rpc",
	localPeerId: "client",
	remotePeerId: "server"
})

const channel = new RPCChannel<object, typeof api>(transport)
const remote = channel.getAPI()

console.log(await remote.add(2, 3))
console.log(await remote.greet("Redis"))
```

## Options

```ts
redisStreamsTransport({
	url: "redis://localhost:6379",
	stream: "kkrpc-stream",
	consumerGroup: "kkrpc-workers",
	consumerName: "worker-1",
	localPeerId: "worker-1",
	remotePeerId: "api-server",
	blockTimeout: 5000,
	maxLen: 10_000
})
```

Use different `localPeerId` values for every process. Omit `remotePeerId` for broadcast-style delivery to all peers reading the stream.
