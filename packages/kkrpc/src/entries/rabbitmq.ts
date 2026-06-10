/**
 * Published `kkrpc/rabbitmq` entry for RabbitMQ-backed transports.
 *
 * Import this entry in Node.js or compatible runtimes that have `amqplib`
 * installed and need kkrpc over a RabbitMQ exchange.
 * @module
 */
export {
	rabbitMqTransport,
	type RabbitMQTransport,
	type RabbitMQTransportOptions
} from "../transports/rabbitmq.ts"
