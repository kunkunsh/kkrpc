import type { Channel, ChannelModel, ConsumeMessage } from "amqplib"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, shouldDeliverBusEnvelope, type BusEnvelope } from "./bus-envelope.ts"

export interface RabbitMQTransportOptions {
	url?: string
	exchange?: string
	exchangeType?: "topic" | "direct" | "fanout"
	durable?: boolean
	routingKeyPrefix?: string
	localPeerId: string
	remotePeerId?: string
}

export type RabbitMQTransport = Transport<RPCMessage>

export function rabbitMqTransport(options: RabbitMQTransportOptions): RabbitMQTransport {
	const exchange = options.exchange || "kkrpc-exchange"
	const routingKey = `${options.routingKeyPrefix || "kkrpc"}.messages`
	const listeners = new Set<(message: RPCMessage) => void>()
	let connection: ChannelModel | undefined
	let channel: Channel | undefined
	let connectionPromise: Promise<void> | undefined
	let closed = false

	async function connect(): Promise<void> {
		if (connectionPromise) return connectionPromise
		connectionPromise = (async () => {
			const amqplib = await import("amqplib")
			connection = await amqplib.connect(options.url || "amqp://localhost")
			channel = await connection.createChannel()
			const durable = options.durable !== false
			await channel.assertExchange(exchange, options.exchangeType || "topic", { durable })
			const { queue } = await channel.assertQueue("", {
				durable: false,
				exclusive: true,
				autoDelete: true
			})
			await channel.bindQueue(queue, exchange, routingKey)
			await channel.consume(queue, (message: ConsumeMessage | null) => {
				if (!message || closed || !channel) return
				try {
					const envelope = JSON.parse(message.content.toString("utf8")) as BusEnvelope
					if (shouldDeliverBusEnvelope(envelope, { localPeerId: options.localPeerId })) {
						listeners.forEach((listener) => listener(envelope.message))
					}
				} finally {
					channel.ack(message)
				}
			})
		})()
		return connectionPromise
	}

	return {
		capabilities: {
			objectMode: true,
			transfer: false,
			broadcast: options.remotePeerId === undefined
		},
		async send(message) {
			if (closed) throw new Error("RabbitMQ transport has been closed")
			await connect()
			if (!channel) throw new Error("RabbitMQ channel is not initialized")
			const envelope = createBusEnvelope(message, {
				transportId: "rabbitmq",
				from: options.localPeerId,
				to: options.remotePeerId
			})
			channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
				persistent: options.durable !== false
			})
		},
		subscribe(listener) {
			listeners.add(listener)
			void connect()
			return () => listeners.delete(listener)
		},
		close() {
			closed = true
			listeners.clear()
			if (channel) void channel.close().catch(() => {})
			if (connection) void connection.close().catch(() => {})
			channel = undefined
			connection = undefined
		}
	}
}
