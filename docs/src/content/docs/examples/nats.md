---
title: NATS Adapter
description: High-performance messaging with NATS
---

# NATS Adapter

The NATS adapter provides high-performance messaging using the NATS messaging system with publish/subscribe patterns and optional queue groups for load balancing.

## Installation

First, install the required dependencies. The NATS client is already included as a dependency of kkrpc:

```bash
# npm
npm install kkrpc

# yarn
yarn add kkrpc

# pnpm
pnpm add kkrpc
```

## Basic Usage

### Publisher

```typescript
import { NatsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const natsIO = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "kkrpc-messages"
})

const publisherRPC = new RPCChannel<API, API>(natsIO, {
	expose: apiMethods
})

const api = publisherRPC.getAPI()

// Test basic RPC calls
console.log(await api.add(5, 3)) // 8
console.log(await api.echo("Hello from NATS!")) // "Hello from NATS!"

console.log("Subject:", natsIO.getSubject())
console.log("Session ID:", natsIO.getSessionId())

natsIO.destroy()
```

### Subscriber

```typescript
import { NatsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const natsIO = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "kkrpc-messages",
	sessionId: "subscriber-session"
})

const subscriberRPC = new RPCChannel<API, API>(natsIO, {
	expose: apiMethods
})

const api = subscriberRPC.getAPI()

// Process messages from publisher
console.log(await api.add(10, 20)) // 30
console.log(await api.echo("Hello from subscriber!")) // "Hello from subscriber!"

natsIO.destroy()
```

## Configuration Options

```typescript
interface NatsIOOptions {
	servers?: string | string[]     // NATS server URLs (default: "nats://localhost:4222")
	subject?: string                // Subject for RPC traffic (default: "kkrpc.messages")
	queueGroup?: string             // Queue group for load balancing (optional)
	sessionId?: string              // Unique session identifier
	timeout?: number                // Connection timeout in ms (default: 10000)
}
```

## Features

### Subject-Based Routing

NATS uses subjects for message routing. Subjects are hierarchical strings separated by dots:

```typescript
const natsIO = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "app.service.rpc"  // Hierarchical subject
})

// You can use wildcards for subscriptions
// "app.>" matches all subjects starting with "app."
// "*.service" matches "foo.service" but not "foo.other.service"
```

### Queue Groups for Load Balancing

Queue groups enable load balancing across multiple subscribers:

```typescript
// All subscribers with the same queue group name
// will share messages (only one receives each message)

const subscriber1 = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "tasks",
	queueGroup: "workers"  // Same group name for load balancing
})

const subscriber2 = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "tasks",
	queueGroup: "workers"  // Same group name
})

// Messages to "tasks" subject will be distributed
// to only one of the subscribers in the "workers" group
```

### Broadcasting (No Queue Group)

Without a queue group, all subscribers receive all messages:

```typescript
// Publisher broadcasts to all subscribers
const publisher = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "notifications"
})

// All subscribers receive all messages
const subscriber1 = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "notifications"
})

const subscriber2 = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "notifications"
})
```

## Advanced Usage

### Multiple Servers

Connect to a NATS cluster with multiple servers:

```typescript
const natsIO = new NatsIO({
	servers: [
		"nats://server1:4222",
		"nats://server2:4222",
		"nats://server3:4222"
	],
	subject: "kkrpc-messages"
})
```

### Custom Session Management

```typescript
const natsIO = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "custom-rpc",
	sessionId: "my-unique-session-id"  // Custom session ID
})

console.log(natsIO.getSessionId())     // "my-unique-session-id"
console.log(natsIO.getSubject())       // "custom-rpc"
console.log(natsIO.getQueueGroup())    // undefined or queue group name
console.log(natsIO.isConnected())      // true/false
```

### Connection Timeout

```typescript
const natsIO = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "rpc-messages",
	timeout: 15000  // 15 second connection timeout
})
```

## Error Handling

```typescript
const natsIO = new NatsIO({
	servers: "nats://localhost:4222",
	subject: "rpc-messages"
})

try {
	const api = natsRPC.getAPI()
	await api.someMethod()
} catch (error) {
	if (error.message.includes("NATS adapter has been destroyed")) {
		console.log("Adapter was destroyed")
	} else if (error.message.includes("NATS connection error")) {
		console.log("NATS connection failed - check servers")
	}
}
```

## Connection Management

```typescript
const natsIO = new NatsIO()

// Check connection status
console.log(natsIO.isConnected())  // true/false

// Get adapter information
console.log(natsIO.getSubject())   // Subject name
console.log(natsIO.getQueueGroup()) // Queue group (if set)
console.log(natsIO.getSessionId()) // Session ID

// Graceful cleanup
natsIO.destroy()

// Signal destroy to remote parties
await natsIO.signalDestroy()
```

## Best Practices

1. **Subject Naming**:
   - Use hierarchical subjects like `app.service.operation`
   - Avoid overly generic subjects to prevent conflicts
   - Use consistent naming conventions across services

2. **Queue Groups**:
   - Use queue groups for load balancing
   - Omit queue group for broadcast pattern
   - All subscribers in a queue group share messages

3. **Connection Handling**:
   - Implement reconnection logic for production
   - Set appropriate timeouts
   - Monitor connection health

4. **Resource Management**:
   - Always call `destroy()` when shutting down
   - Use `signalDestroy()` to notify remote parties
   - Handle connection errors gracefully

5. **Cluster Usage**:
   - Specify multiple servers for redundancy
   - NATS will automatically reconnect to available servers
   - Consider server proximity for latency optimization

## Performance Tips

1. **Subject Hierarchy**: Well-designed subjects minimize wildcard usage
2. **Queue Groups**: Use for horizontal scaling
3. **Connection Pooling**: One connection per service is usually sufficient
4. **Message Size**: Keep messages under 1MB for optimal performance
5. **Inbox Pattern**: Use request/reply for synchronous RPC calls

## Dependencies

- `@nats-io/transport-node`: NATS client for Node.js
- `@nats-io/transport-deno`: NATS client for Deno
- NATS server (version 2.0+)

## Running NATS Server

```bash
# Using Docker
docker run -p 4222:4222 -p 8222:8222 nats:latest

# Or install and run locally
# https://docs.nats.io/running-nats

# Verify with monitoring
curl http://localhost:8222/healthz
```

## Comparison with Other Adapters

| Feature          | NATS       | RabbitMQ   | Kafka        | Redis Streams |
|------------------|------------|------------|--------------|---------------|
| **Latency**      | Ultra-low  | Low        | Medium       | Low           |
| **Persistence**  | Optional   | Yes        | Yes          | Yes           |
| **Load Balancing**| Queue groups| Queues    | Consumer groups| Consumer groups|
| **Complexity**   | Low        | Medium     | High         | Medium        |
| **Schema**       | None       | Optional   | Optional     | None          |
| **Clustering**   | Built-in   | Supported  | Built-in     | Supported     |

## Production Considerations

### Monitoring

Monitor key metrics:
- Connection health and reconnection attempts
- Message throughput per subject
- Queue group distribution
- Server cluster status

### Scaling

- **Horizontal Scaling**: Add more subscribers with queue groups
- **Subject Design**: Well-designed subjects prevent bottlenecks
- **Cluster**: Use NATS clustering for high availability

### Reliability

- Use multiple servers for redundancy
- Implement proper error handling and reconnection
- Consider message acknowledgment requirements
- Monitor server health and network connectivity
