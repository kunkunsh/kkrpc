---
title: Redis Streams Adapter
description: High-performance stream-based messaging with Redis
---

# Redis Streams Adapter

The Redis Streams adapter provides high-performance stream-based messaging with persistence, consumer groups, and memory protection features.

## Installation

First, install the required dependencies:

```bash
# npm
npm install ioredis

# yarn
yarn add ioredis

# pnpm
pnpm add ioredis
```

## Basic Usage

### Publisher

```typescript
import { RedisStreamsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const redisIO = new RedisStreamsIO({
  url: "redis://localhost:6379",
  stream: "kkrpc-stream",
  maxLen: 10000, // Keep only last 10k messages
  maxQueueSize: 1000
})

const publisherRPC = new RPCChannel<API, API>(redisIO, {
  expose: apiMethods
})

const api = publisherRPC.getAPI()

// Test basic RPC calls
console.log(await api.add(7, 8)) // 15
console.log(await api.echo("Hello from Redis Streams!")) // "Hello from Redis Streams!"

// Get stream information
const streamInfo = await redisIO.getStreamInfo()
console.log("Stream length:", streamInfo.length)

redisIO.destroy()
```

### Subscriber (Pub/Sub Mode)

```typescript
import { RedisStreamsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const redisIO = new RedisStreamsIO({
  url: "redis://localhost:6379",
  stream: "kkrpc-stream",
  useConsumerGroup: false, // Default: all consumers receive all messages
  maxQueueSize: 1000
})

const subscriberRPC = new RPCChannel<API, API>(redisIO, {
  expose: apiMethods
})

const api = subscriberRPC.getAPI()

// Process all messages
console.log(await api.multiply(4, 6)) // 24
console.log(await api.echo("Hello from subscriber!")) // "Hello from subscriber!"

redisIO.destroy()
```

### Consumer Group Mode (Load Balancing)

```typescript
import { RedisStreamsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

// Worker 1
const worker1 = new RedisStreamsIO({
  url: "redis://localhost:6379",
  stream: "kkrpc-stream",
  consumerGroup: "kkrpc-group",
  consumerName: "worker-1",
  useConsumerGroup: true, // Enable load balancing
  maxQueueSize: 1000
})

const worker1RPC = new RPCChannel<API, API>(worker1, {
  expose: apiMethods
})

const api1 = worker1RPC.getAPI()

// Worker 2 (in another process)
const worker2 = new RedisStreamsIO({
  url: "redis://localhost:6379",
  stream: "kkrpc-stream",
  consumerGroup: "kkrpc-group",
  consumerName: "worker-2",
  useConsumerGroup: true,
  maxQueueSize: 1000
})

// Each message will be processed by only one worker
```

## Configuration Options

```typescript
interface RedisStreamsOptions {
  url?: string                    // Redis URL (default: "redis://localhost:6379")
  stream?: string                 // Stream name (default: "kkrpc-stream")
  consumerGroup?: string          // Consumer group name (default: "kkrpc-group")
  consumerName?: string           // Consumer name (default: "consumer-{sessionId}")
  blockTimeout?: number           // Block timeout in ms (default: 5000)
  maxLen?: number                 // Maximum stream length
  sessionId?: string              // Unique session identifier
  maxQueueSize?: number           // Max queue size (default: 1000)
  useConsumerGroup?: boolean      // Use consumer group mode (default: false)
}
```

## Two Messaging Modes

### 1. Pub/Sub Mode (Default)

All consumers receive all messages:

```typescript
const redisIO = new RedisStreamsIO({
  stream: "broadcast-stream",
  useConsumerGroup: false  // Pub/Sub mode
})

// Multiple subscribers all receive the same messages
const subscriber1 = new RedisStreamsIO({ stream: "broadcast-stream" })
const subscriber2 = new RedisStreamsIO({ stream: "broadcast-stream" })
```

### 2. Consumer Group Mode (Load Balancing)

Each message is processed by only one consumer:

```typescript
const redisIO = new RedisStreamsIO({
  stream: "work-queue",
  consumerGroup: "processors",
  consumerName: "worker-1",
  useConsumerGroup: true  // Load balancing mode
})

// Messages distributed across workers
const worker1 = new RedisStreamsIO({
  stream: "work-queue",
  consumerGroup: "processors",
  consumerName: "worker-1",
  useConsumerGroup: true
})

const worker2 = new RedisStreamsIO({
  stream: "work-queue",
  consumerGroup: "processors",
  consumerName: "worker-2",
  useConsumerGroup: true
})
```

## Memory Protection

Prevent memory issues with queue size limits:

```typescript
const redisIO = new RedisStreamsIO({
  maxQueueSize: 1000,  // Maximum messages in memory
  stream: "protected-stream"
})

// When queue is full, oldest messages are dropped with warning
// Queue full (1000 messages), dropping oldest message
```

## Stream Management

### Get Stream Information

```typescript
const redisIO = new RedisStreamsIO()

const streamInfo = await redisIO.getStreamInfo()
console.log(streamInfo)
// {
//   length: 1234,
//   groups: 2,
//   lastEntry: "1678901234567-0"
// }
```

### Trim Stream

```typescript
// Keep only last 1000 entries
await redisIO.trimStream(1000)
```

### Debug Stream Contents

```typescript
// Get all entries (for debugging)
const entries = await redisIO.getAllEntries()
console.log("All stream entries:", entries)
```

## Advanced Configuration

### Custom Stream Settings

```typescript
const redisIO = new RedisStreamsIO({
  url: "redis://user:pass@localhost:6379",
  stream: "my-app-stream",
  maxLen: 50000,        // Keep 50k messages
  blockTimeout: 1000,   // 1 second timeout
  maxQueueSize: 2000,   // Allow 2k messages in memory
  sessionId: "my-session"
})
```

### Consumer Group Configuration

```typescript
const redisIO = new RedisStreamsIO({
  stream: "task-queue",
  consumerGroup: "task-processors",
  consumerName: `processor-${process.pid}`,
  useConsumerGroup: true,
  blockTimeout: 10000  // Wait 10 seconds for messages
})
```

## Error Handling

```typescript
const redisIO = new RedisStreamsIO()

try {
  const api = redisRPC.getAPI()
  await api.someMethod()
} catch (error) {
  if (error.message.includes("Redis Streams adapter has been destroyed")) {
    console.log("Adapter was destroyed")
  } else if (error.message.includes("Redis Streams connection error")) {
    console.log("Redis connection failed - check Redis server")
  }
}
```

## Connection Management

```typescript
const redisIO = new RedisStreamsIO()

// Get adapter information
console.log(redisIO.getStream())      // Stream name
console.log(redisIO.getConsumerGroup()) // Consumer group name
console.log(redisIO.getConsumerName())  // Consumer name
console.log(redisIO.getSessionId())    // Session ID

// Graceful cleanup
redisIO.destroy()

// Signal destroy to remote parties
await redisIO.signalDestroy()
```

## Best Practices

1. **Choose the right mode**:
   - Use `useConsumerGroup: false` for broadcasting
   - Use `useConsumerGroup: true` for load balancing

2. **Set appropriate limits**:
   - `maxQueueSize` to prevent memory issues
   - `maxLen` to limit stream growth

3. **Monitor stream health**:
   ```typescript
   const info = await redisIO.getStreamInfo()
   if (info.length > 100000) {
     await redisIO.trimStream(50000)
   }
   ```

4. **Use unique consumer names** in consumer group mode
5. **Handle connection failures** gracefully with reconnection logic
6. **Clean up resources** with `destroy()` when shutting down

## Dependencies

- `ioredis`: Redis client library
- Redis server with Streams support (Redis 5.0+)

## Performance Considerations

- **Memory**: Use `maxQueueSize` to limit memory usage
- **Persistence**: Messages persist in Redis until trimmed
- **Throughput**: Consumer groups provide better throughput for high-volume workloads
- **Latency**: Adjust `blockTimeout` based on your latency requirements