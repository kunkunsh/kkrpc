/**
 * RabbitMQ exchange transport for stable kkrpc.
 *
 * RabbitMQ exchanges may fan messages out to multiple consumers. This transport
 * wraps RPC messages in bus envelopes, filters self-delivery and targeted peers,
 * and acknowledges or rejects consumed deliveries based on parse/delivery state.
 */

import type { Channel, ChannelModel, ConsumeMessage } from "amqplib"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, parseBusEnvelope, shouldDeliverBusEnvelope } from "./bus-envelope.ts"

/** Options for connecting a kkrpc transport to RabbitMQ. */
export interface RabbitMQTransportOptions {
	/** AMQP connection URL. Defaults to `amqp://localhost`. */
	url?: string
	/** Exchange used to publish and consume kkrpc bus envelopes. */
	exchange?: string
	/** RabbitMQ exchange type to assert. */
	exchangeType?: "topic" | "direct" | "fanout"
	/** Whether the exchange should be durable. Defaults to true. */
	durable?: boolean
	/** Prefix for routing keys used by this transport. */
	routingKeyPrefix?: string
	/** Stable id for this endpoint; used to filter self-delivered messages. */
	localPeerId: string
	/** Optional target endpoint id for point-to-point delivery. */
	remotePeerId?: string
}

/** Message-level RabbitMQ transport type. */
export type RabbitMQTransport = Transport<RPCMessage>

interface RabbitMqEnvelopeMessage {
	content: { toString(encoding?: BufferEncoding): string }
}

interface RabbitMqAckChannel<TMessage> {
	ack(message: TMessage): void
	nack(message: TMessage, allUpTo?: boolean, requeue?: boolean): void
}

/** Parse, filter, acknowledge, and deliver one RabbitMQ envelope message. */
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
		// Ack filtered envelopes so self-delivery and other-peer traffic does not redeliver forever.
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

/**
 * Create a RabbitMQ-backed kkrpc transport.
 *
 * The transport lazily connects, declares an exchange and exclusive queue,
 * publishes bus envelopes, and closes channel/connection best-effort. It is
 * bidirectional through RabbitMQ, callback-capable, and does not support transferables.
 */
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
			connection = nextConnection

			const cleanup = async () => {
				await channel?.close().catch(() => {})
				await nextConnection.close().catch(() => {})
				channel = undefined
				if (connection === nextConnection) connection = undefined
			}

			if (closed) {
				await cleanup()
				return
			}

			let nextChannel: Channel | undefined
			try {
				nextChannel = await nextConnection.createChannel()
				channel = nextChannel
			} catch (error) {
				await cleanup()
				throw error
			}
			if (closed) {
				await cleanup()
				return
			}

			try {
				const durable = options.durable !== false
				await nextChannel.assertExchange(exchange, options.exchangeType || "topic", { durable })
				if (closed) {
					await cleanup()
					return
				}
				const { queue } = await nextChannel.assertQueue("", {
					durable: false,
					exclusive: true,
					autoDelete: true
				})
				if (closed) {
					await cleanup()
					return
				}
				await nextChannel.bindQueue(queue, exchange, routingKey)
				if (closed) {
					await cleanup()
					return
				}
				await nextChannel.consume(queue, (message: ConsumeMessage | null) => {
					if (!message || closed || !channel) return
					handleRabbitMqBusEnvelope(message, channel, options.localPeerId, listeners)
				})
			} catch (error) {
				await cleanup()
				throw error
			}
		})()
		return connectionPromise
	}

	return {
		capabilities: {
			objectMode: true,
			transfer: false,
			remoteRefs: true,
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
