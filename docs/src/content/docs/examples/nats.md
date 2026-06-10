---
title: NATS Adapter
description: High-performance messaging with NATS
---

# NATS Adapter

The NATS transport provides high-performance publish/subscribe messaging for kkrpc. It uses the stable `Transport<RPCMessage>` interface and works with `RPCChannel`, `wrap()`, and `expose()`.

## Installation

```bash
npm install kkrpc
pnpm add kkrpc
yarn add kkrpc
```

## Basic Usage

Use two peer IDs so each side can ignore its own bus messages and route replies to the other side.

### Service

```typescript
import { RPCChannel } from "kkrpc"
import { natsTransport } from "kkrpc/nats"

interface API {
	add(a: number, b: number): number
	echo(message: string): string
}

const serviceApi: API = {
	add: (a, b) => a + b,
	echo: (message) => message
}

const transport = natsTransport({
	servers: "nats://localhost:4222",
	subject: "kkrpc.messages",
	localPeerId: "service",
	remotePeerId: "client"
})

const channel = new RPCChannel<API, object>(transport, { expose: serviceApi })

process.on("SIGINT", () => {
	channel.destroy()
	transport.close?.()
})
```

### Client

```typescript
import { RPCChannel } from "kkrpc"
import { natsTransport } from "kkrpc/nats"

const transport = natsTransport({
	servers: "nats://localhost:4222",
	subject: "kkrpc.messages",
	localPeerId: "client",
	remotePeerId: "service"
})

const channel = new RPCChannel<object, API>(transport)
const api = channel.getAPI()

console.log(await api.add(5, 3))
console.log(await api.echo("Hello from NATS"))

channel.destroy()
transport.close?.()
```

## Configuration Options

```typescript
interface NatsTransportOptions {
	servers?: string | string[]
	subject?: string
	queueGroup?: string
	timeout?: number
	localPeerId: string
	remotePeerId?: string
}
```

## Subject-Based Routing

NATS uses hierarchical subjects separated by dots.

```typescript
const transport = natsTransport({
	servers: "nats://localhost:4222",
	subject: "app.service.rpc",
	localPeerId: "client",
	remotePeerId: "service"
})
```

Use NATS wildcard subscriptions outside kkrpc when you need broader routing. kkrpc itself publishes all RPC envelopes to the configured subject.

## Queue Groups

Queue groups let multiple service instances share work.

```typescript
const workerA = natsTransport({
	servers: "nats://localhost:4222",
	subject: "tasks",
	queueGroup: "workers",
	localPeerId: "worker-a"
})

const workerB = natsTransport({
	servers: "nats://localhost:4222",
	subject: "tasks",
	queueGroup: "workers",
	localPeerId: "worker-b"
})
```

If `remotePeerId` is omitted, the transport advertises broadcast capability and accepts envelopes addressed to any peer. Use explicit peer IDs for request/reply RPC pairs.

## Multiple Servers

```typescript
const transport = natsTransport({
	servers: ["nats://server1:4222", "nats://server2:4222", "nats://server3:4222"],
	subject: "kkrpc.messages",
	localPeerId: "client",
	remotePeerId: "service"
})
```

## Error Handling

```typescript
try {
	await api.someMethod()
} catch (error) {
	if (error instanceof Error && error.message.includes("NATS connection")) {
		console.log("NATS connection failed")
	}
}
```

## Best Practices

1. Use stable, unique `localPeerId` values per process.
2. Set `remotePeerId` for direct request/reply peers.
3. Use hierarchical subjects like `app.service.rpc`.
4. Use queue groups only when any worker can handle a request.
5. Call `channel.destroy()` and `transport.close?.()` during shutdown.
