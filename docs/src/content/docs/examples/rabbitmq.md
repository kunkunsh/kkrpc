---
title: RabbitMQ
description: Make RPC calls over RabbitMQ
---

RabbitMQ support uses the native `rabbitMqTransport()` factory. Each peer identifies itself with `localPeerId`; clients can target one service by setting `remotePeerId`.

## Request/Response Pair

```ts title="server.ts"
import { RPCChannel } from "kkrpc"
import { rabbitMqTransport } from "kkrpc/rabbitmq"

const api = {
	fibonacci: async (n: number): Promise<number> => {
		if (n <= 1) return n
		return (await api.fibonacci(n - 1)) + (await api.fibonacci(n - 2))
	}
}

const transport = rabbitMqTransport({
	url: "amqp://localhost",
	exchange: "math-service",
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
import { rabbitMqTransport } from "kkrpc/rabbitmq"
import type { api } from "./server"

const transport = rabbitMqTransport({
	url: "amqp://localhost",
	exchange: "math-service",
	localPeerId: "client",
	remotePeerId: "server"
})

const channel = new RPCChannel<object, typeof api>(transport)
const remote = channel.getAPI()

console.log(await remote.fibonacci(10))
```

## Options

```ts
rabbitMqTransport({
	url: "amqp://localhost",
	exchange: "kkrpc-exchange",
	exchangeType: "topic",
	routingKeyPrefix: "kkrpc",
	durable: false,
	localPeerId: "client",
	remotePeerId: "server"
})
```

Omit `remotePeerId` when you intentionally want all peers on the exchange to receive a message.
