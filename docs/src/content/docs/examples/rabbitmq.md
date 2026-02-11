---
title: RabbitMQ Adapter
description: Reliable message queue communication with RabbitMQ
---

# RabbitMQ Adapter

The RabbitMQ adapter provides reliable message queue communication using AMQP protocol with support for topic exchanges, durable messaging, and load balancing.

## Installation

First, install the required dependencies:

```bash
# npm
npm install amqplib

# yarn
yarn add amqplib

# pnpm
pnpm add amqplib
```

## Basic Usage

### Producer

```typescript
import { RabbitMQIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const rabbitmqIO = new RabbitMQIO({
	url: "amqp://localhost",
	exchange: "kkrpc-exchange",
	exchangeType: "topic",
	durable: true
})

const producerRPC = new RPCChannel<API, API>(rabbitmqIO, {
	expose: apiMethods
})

const api = producerRPC.getAPI()

// Test basic RPC calls
console.log(await api.add(5, 3)) // 8
console.log(await api.echo("Hello from RabbitMQ!")) // "Hello from RabbitMQ!"

rabbitmqIO.destroy()
```

### Consumer

```typescript
import { RabbitMQIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const rabbitmqIO = new RabbitMQIO({
	url: "amqp://localhost",
	exchange: "kkrpc-exchange",
	exchangeType: "topic",
	durable: true,
	sessionId: "consumer-session"
})

const consumerRPC = new RPCChannel<API, API>(rabbitmqIO, {
	expose: apiMethods
})

const api = consumerRPC.getAPI()

// Process messages from producer
console.log(await api.add(10, 20)) // 30
console.log(await api.echo("Hello from consumer!")) // "Hello from consumer!"

rabbitmqIO.destroy()
```

## Configuration Options

```typescript
interface RabbitMQOptions {
	url?: string // AMQP broker URL (default: "amqp://localhost")
	exchange?: string // Exchange name (default: "kkrpc-exchange")
	exchangeType?: "topic" | "direct" | "fanout" // Exchange type (default: "topic")
	durable?: boolean // Durable exchange and queues (default: true)
	sessionId?: string // Unique session identifier
	routingKeyPrefix?: string // Routing key prefix (default: "kkrpc")
}
```

## Features

### Topic Exchange Routing

The RabbitMQ adapter uses a topic exchange with routing keys to separate kkrpc traffic from other consumers:

```typescript
const rabbitmqIO = new RabbitMQIO({
	exchange: "my-exchange",
	exchangeType: "topic", // Use topic exchange for flexible routing
	routingKeyPrefix: "myapp.rpc" // Custom routing key prefix
})

// Get routing information
const routingKeys = rabbitmqIO.getRoutingKeys()
console.log(routingKeys) // { inbound: "myapp.rpc.messages", outbound: "myapp.rpc.messages" }
```

### Durable Messaging

Configure durable exchanges and queues to survive broker restarts:

```typescript
const rabbitmqIO = new RabbitMQIO({
	durable: true, // Messages survive broker restarts
	exchange: "durable-exchange"
})
```

### Session Management

Each adapter instance gets a unique session ID to prevent message conflicts:

```typescript
const rabbitmqIO = new RabbitMQIO({
	sessionId: "my-unique-session" // Optional custom session ID
})

console.log(rabbitmqIO.getSessionId()) // Get current session ID
console.log(rabbitmqIO.getExchange()) // Get exchange name
```

## Advanced Usage

### Custom Exchange Configuration

```typescript
const rabbitmqIO = new RabbitMQIO({
	url: "amqp://guest:guest@localhost:5672",
	exchange: "custom-exchange",
	exchangeType: "direct", // Direct exchange for point-to-point
	durable: false, // Non-durable for temporary queues
	routingKeyPrefix: "custom.rpc"
})
```

### Multiple Consumers

```typescript
// Consumer 1
const consumer1 = new RabbitMQIO({
	sessionId: "consumer-1",
	exchange: "load-balanced-exchange"
})

// Consumer 2
const consumer2 = new RabbitMQIO({
	sessionId: "consumer-2",
	exchange: "load-balanced-exchange"
})

// Both consumers will receive all messages (broadcast pattern)
```

## Error Handling

```typescript
const rabbitmqIO = new RabbitMQIO({
	url: "amqp://localhost"
})

try {
	const api = rabbitmqRPC.getAPI()
	await api.someMethod()
} catch (error) {
	if (error.message.includes("RabbitMQ adapter has been destroyed")) {
		console.log("Adapter was destroyed")
	} else if (error.message.includes("Failed to create RabbitMQ channel")) {
		console.log("Connection failed - check RabbitMQ server")
	}
}
```

## Connection Management

```typescript
const rabbitmqIO = new RabbitMQIO()

// Graceful cleanup
rabbitmqIO.destroy()

// Signal destroy to remote parties
await rabbitmqIO.signalDestroy()
```

## Best Practices

1. **Use unique session IDs** when running multiple instances
2. **Enable durable messaging** for production systems
3. **Monitor connection health** and implement reconnection logic
4. **Use appropriate exchange types** for your use case:
   - `topic`: Flexible routing with wildcards
   - `direct`: Point-to-point communication
   - `fanout`: Broadcast to all queues
5. **Clean up resources** with `destroy()` when shutting down

## Dependencies

- `amqplib`: AMQP client library for RabbitMQ
- RabbitMQ server running on accessible host
