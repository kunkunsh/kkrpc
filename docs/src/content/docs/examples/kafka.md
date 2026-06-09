---
title: Kafka
description: Make RPC calls over Kafka
---

Kafka support uses the native `kafkaTransport()` factory. Each process needs a unique `localPeerId`; set `remotePeerId` to direct requests at a specific service process.

## Request/Response Pair

```ts title="server.ts"
import { RPCChannel } from "kkrpc"
import { kafkaTransport } from "kkrpc/kafka"

const api = {
	processOrder: async (order: { id: string; total: number }) => ({
		...order,
		status: "processed" as const
	})
}

const transport = kafkaTransport({
	brokers: ["localhost:9092"],
	clientId: "order-service",
	topic: "orders-rpc",
	groupId: "order-service-group",
	localPeerId: "order-service"
})

const channel = new RPCChannel(transport, { expose: api })

process.on("SIGINT", async () => {
	channel.destroy()
	await transport.close?.()
})
```

```ts title="client.ts"
import { RPCChannel } from "kkrpc"
import { kafkaTransport } from "kkrpc/kafka"
import type { api } from "./server"

const transport = kafkaTransport({
	brokers: ["localhost:9092"],
	clientId: "order-client",
	topic: "orders-rpc",
	groupId: "order-client-group",
	localPeerId: "order-client",
	remotePeerId: "order-service"
})

const channel = new RPCChannel<object, typeof api>(transport)
const remote = channel.getAPI()

console.log(await remote.processOrder({ id: "order-1", total: 42 }))
```

## Options

```ts
kafkaTransport({
	brokers: ["localhost:9092"],
	clientId: "kkrpc-client",
	topic: "kkrpc-topic",
	groupId: "kkrpc-client-group",
	fromBeginning: false,
	numPartitions: 3,
	replicationFactor: 1,
	localPeerId: "client",
	remotePeerId: "server"
})
```

Kafka delivery is asynchronous and broker-backed. Keep API methods idempotent when callers may retry after timeouts.
