---
title: Kafka Adapter
description: Distributed streaming with Apache Kafka
---

# Kafka Adapter

The Kafka adapter provides distributed streaming with high throughput and fault tolerance for large-scale systems using Apache Kafka.

## Installation

First, install the required dependencies:

```bash
# npm
npm install kafkajs

# yarn
yarn add kafkajs

# pnpm
pnpm add kafkajs
```

## Basic Usage

### Producer

```typescript
import { KafkaIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const kafkaIO = new KafkaIO({
  brokers: ["localhost:9092"],
  topic: "kkrpc-topic",
  clientId: "kkrpc-producer",
  numPartitions: 3,
  replicationFactor: 1,
  maxQueueSize: 1000
})

const producerRPC = new RPCChannel<API, API>(kafkaIO, {
  expose: apiMethods
})

const api = producerRPC.getAPI()

// Test basic RPC calls
console.log(await api.add(12, 18)) // 30
console.log(await api.echo("Hello from Kafka!")) // "Hello from Kafka!"

console.log("Topic:", kafkaIO.getTopic())
console.log("Session ID:", kafkaIO.getSessionId())

kafkaIO.destroy()
```

### Consumer

```typescript
import { KafkaIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const kafkaIO = new KafkaIO({
  brokers: ["localhost:9092"],
  topic: "kkrpc-topic",
  clientId: "kkrpc-consumer",
  groupId: "kkrpc-consumer-group",
  fromBeginning: false, // Only read new messages
  maxQueueSize: 1000
})

const consumerRPC = new RPCChannel<API, API>(kafkaIO, {
  expose: apiMethods
})

const api = consumerRPC.getAPI()

// Process messages from Kafka
console.log(await api.divide(100, 4)) // 25
console.log(await api.echo("Hello from Kafka consumer!")) // "Hello from Kafka consumer!"

console.log("Topic:", kafkaIO.getTopic())
console.log("Group ID:", kafkaIO.getGroupId())

kafkaIO.destroy()
```

## Configuration Options

```typescript
interface KafkaAdapterOptions {
  brokers?: string[]              // Kafka broker addresses (default: ["localhost:9092"])
  clientId?: string               // Client identifier
  topic?: string                  // Topic name (default: "kkrpc-topic")
  groupId?: string                // Consumer group ID
  fromBeginning?: boolean         // Read from beginning (default: false)
  producerConfig?: ProducerConfig // Custom producer configuration
  consumerConfig?: ConsumerConfig // Custom consumer configuration
  ssl?: KafkaConfig["ssl"]        // SSL configuration
  sasl?: KafkaConfig["sasl"]      // SASL configuration
  numPartitions?: number          // Number of partitions for auto-created topics
  replicationFactor?: number      // Replication factor for auto-created topics
  maxQueueSize?: number           // Max queue size (default: 1000)
  sessionId?: string              // Override session ID
  retry?: KafkaConfig["retry"]    // Retry configuration
}
```

## Advanced Configuration

### Custom Broker Configuration

```typescript
const kafkaIO = new KafkaIO({
  brokers: ["broker1:9092", "broker2:9092", "broker3:9092"],
  clientId: "my-kkrpc-service",
  topic: "my-service-rpc",
  numPartitions: 6,
  replicationFactor: 3,
  maxQueueSize: 2000
})
```

### SSL Configuration

```typescript
const kafkaIO = new KafkaIO({
  brokers: ["secure-broker:9093"],
  ssl: {
    rejectUnauthorized: false,
    ca: [fs.readFileSync("/path/to/ca.crt")],
    key: fs.readFileSync("/path/to/client.key"),
    cert: fs.readFileSync("/path/to/client.crt")
  },
  topic: "secure-rpc"
})
```

### SASL Authentication

```typescript
const kafkaIO = new KafkaIO({
  brokers: ["sasl-broker:9092"],
  sasl: {
    mechanism: "plain",
    username: "my-user",
    password: "my-password"
  },
  topic: "authenticated-rpc"
})
```

### Custom Producer/Consumer Configuration

```typescript
const kafkaIO = new KafkaIO({
  brokers: ["localhost:9092"],
  topic: "custom-rpc",
  producerConfig: {
    maxBatchSize: 100,
    lingerMs: 10,
    compression: "gzip"
  },
  consumerConfig: {
    sessionTimeoutMs: 30000,
    heartbeatIntervalMs: 3000,
    maxWaitTimeInMs: 5000
  }
})
```

## Consumer Groups

### Load Balancing with Consumer Groups

```typescript
// Producer
const producer = new KafkaIO({
  topic: "load-balanced-topic",
  numPartitions: 4
})

// Multiple consumers for load balancing
const consumer1 = new KafkaIO({
  topic: "load-balanced-topic",
  groupId: "processor-group",
  clientId: "worker-1"
})

const consumer2 = new KafkaIO({
  topic: "load-balanced-topic",
  groupId: "processor-group",
  clientId: "worker-2"
})

// Messages distributed across consumers in the group
```

### Reading from Beginning

```typescript
const consumer = new KafkaIO({
  topic: "historical-topic",
  groupId: "history-reader",
  fromBeginning: true  // Read all messages from the beginning
})
```

## Topic Management

The adapter automatically creates topics if they don't exist:

```typescript
const kafkaIO = new KafkaIO({
  topic: "auto-created-topic",
  numPartitions: 3,      // Number of partitions
  replicationFactor: 2   // Replication factor
})

// Topic will be created with specified settings
```

## Error Handling

```typescript
const kafkaIO = new KafkaIO()

try {
  const api = kafkaRPC.getAPI()
  await api.someMethod()
} catch (error) {
  if (error.message.includes("Kafka adapter has been destroyed")) {
    console.log("Adapter was destroyed")
  } else if (error.message.includes("Kafka connection error")) {
    console.log("Kafka connection failed - check brokers")
  }
}
```

## Connection Management

```typescript
const kafkaIO = new KafkaIO()

// Get adapter information
console.log(kafkaIO.getTopic())     // Topic name
console.log(kafkaIO.getGroupId())   // Consumer group ID
console.log(kafkaIO.getSessionId()) // Session ID

// Graceful cleanup
kafkaIO.destroy()

// Signal destroy to remote parties
await kafkaIO.signalDestroy()
```

## Memory Protection

Prevent memory issues with queue size limits:

```typescript
const kafkaIO = new KafkaIO({
  maxQueueSize: 1000  // Maximum messages in memory
})

// When queue is full, oldest messages are dropped with warning
// KafkaIO queue full (1000 messages), dropping oldest message to protect memory
```

## Retry Configuration

```typescript
const kafkaIO = new KafkaIO({
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
})
```

## Best Practices

1. **Partition Strategy**:
   - More partitions = higher parallelism
   - Consider message ordering requirements
   - Start with 3-6 partitions for most use cases

2. **Consumer Groups**:
   - Use unique `groupId` for different consumer applications
   - Same `groupId` for load balancing across instances
   - Different `groupId` for broadcasting to multiple applications

3. **Replication**:
   - Use `replicationFactor: 3` for production
   - Ensure you have enough brokers for the replication factor

4. **Memory Management**:
   - Set appropriate `maxQueueSize` limits
   - Monitor consumer lag in production

5. **Error Handling**:
   - Implement proper error handling and reconnection logic
   - Use retry configurations for resilience

6. **Security**:
   - Use SSL/TLS for production environments
   - Configure SASL for authentication
   - Use network policies to restrict access

## Production Considerations

### Monitoring

Monitor key metrics:
- Consumer lag
- Throughput per partition
- Error rates
- Connection health

### Scaling

- **Horizontal Scaling**: Add more consumers with the same `groupId`
- **Vertical Scaling**: Increase `numPartitions` for more parallelism
- **Throughput**: Adjust batch sizes and compression settings

### Reliability

- Use at least 3 brokers for production
- Set `replicationFactor: 3` for durability
- Monitor broker health and network connectivity

## Dependencies

- `kafkajs`: Kafka client library for Node.js
- Apache Kafka cluster (version 0.10+)

## Performance Tips

1. **Batch Size**: Increase `maxBatchSize` for higher throughput
2. **Compression**: Use `gzip` or `snappy` for large messages
3. **Partitions**: More partitions = higher concurrency
4. **Consumer Polling**: Adjust `maxWaitTimeInMs` for latency vs throughput
5. **Memory**: Monitor `maxQueueSize` to prevent memory issues