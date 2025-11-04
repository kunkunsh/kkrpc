/**
 * RabbitMQ adapter for kkrpc
 * Provides topic-based message routing with RabbitMQ exchanges
 */

export * from "./src/interface.ts"
export * from "./src/channel.ts"
export * from "./src/serialization.ts"
export * from "./src/utils.ts"
export { RabbitMQIO } from "./src/adapters/rabbitmq.ts"