import type { Channel, ChannelModel, ConsumeMessage } from "amqplib"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, parseBusEnvelope, shouldDeliverBusEnvelope } from "./bus-envelope.ts"

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

interface RabbitMqEnvelopeMessage {
	content: { toString(encoding?: BufferEncoding): string }
}

interface RabbitMqAckChannel<TMessage> {
	ack(message: TMessage): void
	nack(message: TMessage, allUpTo?: boolean, requeue?: boolean): void
}

export function handleRabbitMqBusEnvelope<TMessage extends RabbitMqEnvelopeMessage>(
	message: TMessage,
	channel: RabbitMqAckChannel<TMessage>,
	localPeerId: string,
	listeners: Set<(message: RPCMessage) => void>
): void {
	const envelope = parseBusEnvelope(message.content.toString("utf8"))
	if (!envelope) {
		channel.nack(message, false, false)
		return
	}

	if (!shouldDeliverBusEnvelope(envelope, { localPeerId })) {
		channel.ack(message)
		return
	}

	try {
		listeners.forEach((listener) => listener(envelope.message))
		channel.ack(message)
	} catch {
		channel.nack(message, false, false)
	}
}

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
			const nextConnection = await amqplib.connect(options.url || "amqp://localhost")
			const nextChannel = await nextConnection.createChannel()
			if (closed) {
				await nextChannel.close().catch(() => {})
				await nextConnection.close().catch(() => {})
				return
			}
			connection = nextConnection
			channel = nextChannel
			const durable = options.durable !== false
			await channel.assertExchange(exchange, options.exchangeType || "topic", { durable })
			if (closed) return
			const { queue } = await channel.assertQueue("", {
				durable: false,
				exclusive: true,
				autoDelete: true
			})
			if (closed) return
			await channel.bindQueue(queue, exchange, routingKey)
			if (closed) return
			await channel.consume(queue, (message: ConsumeMessage | null) => {
				if (!message || closed || !channel) return
				handleRabbitMqBusEnvelope(message, channel, options.localPeerId, listeners)
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
