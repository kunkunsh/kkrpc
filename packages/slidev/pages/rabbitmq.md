---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---

# RabbitMQ RPC

## Client Side

> From Callback Hell to Type-Safe Functions

::left::

### Traditional RabbitMQ RPC

```js {*}{maxHeight:'340px'}
// rpc_client.js - Complex setup
var correlationId = generateUuid()

channel.assertQueue("", { exclusive: true }, function (error2, q) {
	// Consume response queue
	channel.consume(
		q.queue,
		function (msg) {
			// Manual correlation matching!
			if (msg.properties.correlationId === correlationId) {
				console.log("Got %s", msg.content.toString())
				// No types
			}
		},
		{ noAck: true }
	)

	// Send request
	channel.sendToQueue("rpc_queue", Buffer.from(num.toString()), {
		correlationId: correlationId,
		replyTo: q.queue
	})
})
```

::right::

### With kkRPC

```ts
// client.ts - Just call the function
import { RabbitMQIO, RPCChannel } from "kkrpc"
import type { MathAPI } from "./types"

const io = new RabbitMQIO({
	url: "amqp://localhost",
	exchange: "math-service"
})

const rpc = new RPCChannel<{}, MathAPI>(io)
const math = rpc.getAPI()

// Direct function call with full type safety!
const result = await math.fibonacci(30)
// TypeScript knows result is a number ✨
```

---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---

# RabbitMQ RPC

## Server Side

::left::

### Traditional RPC Server

```js
// rpc_server.js - Manual response
channel.consume("rpc_queue", function reply(msg) {
	var n = parseInt(msg.content.toString())
	var r = fibonacci(n)

	// Manual reply with correlation
	channel.sendToQueue(msg.properties.replyTo, 
						Buffer.from(r.toString()), {
		correlationId: msg.properties.correlationId
	})
	channel.ack(msg)
})
```

::right::

### With kkRPC

```ts
// server.ts - Expose your API
import { RabbitMQIO, RPCChannel } from "kkrpc"

const io = new RabbitMQIO({ url: "amqp://localhost" })

new RPCChannel(io, {
	expose: {
		fibonacci: (n: number): number => {
			if (n === 0 || n === 1) return n
			return fibonacci(n - 1) + fibonacci(n - 2)
		}
	}
})
```

<v-click>
<div class="mt-4 p-4 bg-blue-900/30 rounded-lg">
  <strong>Benefits:</strong> No correlation IDs, no manual queue management, automatic serialization, full TypeScript type safety
</div>
</v-click>

<!--
RabbitMQ tutorial 6 shows the official RPC pattern - it's verbose and callback-heavy. You need to:
- Generate correlation IDs
- Create exclusive reply queues
- Manually match responses by correlation ID
- Handle everything as strings

With kkRPC:
- Client just calls await math.fibonacci(30) with full type safety
- Server just exposes functions in a clean object
- Automatic correlation ID management
- Automatic queue/exchange setup
- Bidirectional communication - both sides can call each other
-->
