/**
 * Redis Streams transport for stable kkrpc.
 *
 * Redis Streams can be consumed directly or through a consumer group. This
 * transport stores bus envelopes in a stream, filters messages from this peer or
 * other targets, and acknowledges processed entries when consumer groups are used.
 */

import type { default as Redis } from "ioredis"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, parseBusEnvelope, shouldDeliverBusEnvelope } from "./bus-envelope.ts"

/** Options for connecting a kkrpc transport to Redis Streams. */
export interface RedisStreamsTransportOptions {
	/** Redis connection URL. Defaults to `redis://localhost:6379`. */
	url?: string
	/** Stream name used to exchange kkrpc bus envelopes. */
	stream?: string
	/** Consumer group used for acknowledged stream consumption. */
	consumerGroup?: string
	/** Consumer name used within the consumer group. */
	consumerName?: string
	/** Set false to use plain XREAD; plain stream reads have no acknowledgement primitive. */
	useConsumerGroup?: boolean
	/** Blocking read timeout in milliseconds. */
	blockTimeout?: number
	/** Approximate maximum stream length to keep while publishing. */
	maxLen?: number
	/** Stable id for this endpoint; used to filter self-delivered messages. */
	localPeerId: string
	/** Optional target endpoint id for point-to-point delivery. */
	remotePeerId?: string
}

/** Message-level Redis Streams transport type. */
export type RedisStreamsTransport = Transport<RPCMessage>

type RedisStreamFields = string[]
type RedisStreamMessage = [id: string, fields: RedisStreamFields]
type RedisStreamReadResult = Array<[stream: string, messages: RedisStreamMessage[]]>

interface RedisAckClient {
	xack(stream: string, group: string, id: string): Promise<unknown>
}

/** Inputs for parsing and acknowledging a batch of Redis stream messages. */
export interface ProcessRedisStreamMessagesOptions {
	/** Stream that produced the messages. */
	stream: string
	/** Consumer group to acknowledge against, if consumer groups are enabled. */
	consumerGroup?: string
	/** Stable id for this endpoint; used to filter self-delivered messages. */
	localPeerId: string
	/** Redis-like client used to acknowledge processed messages. */
	subscriber: RedisAckClient
	/** Raw Redis stream messages to parse and deliver. */
	messages: RedisStreamMessage[]
	/** Active RPC message listeners. */
	listeners: Set<(message: RPCMessage) => void>
}

function extractRedisField(fields: RedisStreamFields, name: string): string | undefined {
	const index = fields.indexOf(name)
	return index >= 0 ? fields[index + 1] : undefined
}

/**
 * Parse, filter, optionally acknowledge, and deliver Redis stream messages.
 *
 * Invalid envelopes and messages for other peers are acknowledged when using a
 * consumer group so they do not remain pending indefinitely.
 */
export async function processRedisStreamMessages({
	stream,
	consumerGroup,
	localPeerId,
	subscriber,
	messages,
	listeners
}: ProcessRedisStreamMessagesOptions): Promise<string | undefined> {
	let lastId: string | undefined
	for (const [messageId, fields] of messages) {
		lastId = messageId
		const data = extractRedisField(fields, "data")
		if (!data) {
			if (consumerGroup) await subscriber.xack(stream, consumerGroup, messageId)
			continue
		}
		const envelope = parseBusEnvelope(data)
		if (!envelope) {
			if (consumerGroup) await subscriber.xack(stream, consumerGroup, messageId)
			continue
		}
		if (!shouldDeliverBusEnvelope(envelope, { localPeerId })) {
			if (consumerGroup) await subscriber.xack(stream, consumerGroup, messageId)
			continue
		}

		listeners.forEach((listener) => listener(envelope.message))
		if (consumerGroup) await subscriber.xack(stream, consumerGroup, messageId)
	}
	return lastId
}

/**
 * Create a Redis Streams-backed kkrpc transport.
 *
 * The transport lazily opens publisher/subscriber clients, reads continuously in
 * the background, and disconnects clients on close. It is bidirectional through
 * the stream, callback-capable, and does not support transferables.
 */
export function redisStreamsTransport(
	options: RedisStreamsTransportOptions
): RedisStreamsTransport {
	const stream = options.stream || "kkrpc-stream"
	const consumerGroup =
		options.useConsumerGroup === false
			? undefined
			: options.consumerGroup || `kkrpc-group-${stream}-${options.localPeerId}`
	const consumerName = options.consumerName || `consumer-${options.localPeerId}`
	const listeners = new Set<(message: RPCMessage) => void>()
	let publisher: Redis | undefined
	let subscriber: Redis | undefined
	let connectionPromise: Promise<void> | undefined
	let lastId = "$"
	let closed = false

	async function listen(): Promise<void> {
		while (!closed && subscriber) {
			const results = (
				consumerGroup
					? await subscriber.xreadgroup(
							"GROUP",
							consumerGroup,
							consumerName,
							"BLOCK",
							options.blockTimeout || 5000,
							"STREAMS",
							stream,
							">"
						)
					: await subscriber.xread("BLOCK", options.blockTimeout || 5000, "STREAMS", stream, lastId)
			) as RedisStreamReadResult | null
			if (!results) continue
			for (const [, messages] of results) {
				try {
					const processedLastId = await processRedisStreamMessages({
						stream,
						consumerGroup,
						localPeerId: options.localPeerId,
						subscriber,
						messages,
						listeners
					})
					if (processedLastId) lastId = processedLastId
				} catch (error) {
					if (!closed) console.error("Redis Streams transport delivery error:", error)
				}
			}
		}
	}

	async function connect(): Promise<void> {
		if (connectionPromise) return connectionPromise
		connectionPromise = (async () => {
			const { default: IORedis } = await import("ioredis")
			const url = options.url || "redis://localhost:6379"
			const nextPublisher = new IORedis(url)
			publisher = nextPublisher

			const cleanup = () => {
				nextPublisher.disconnect()
				subscriber?.disconnect()
				if (publisher === nextPublisher) publisher = undefined
				subscriber = undefined
			}

			if (closed) {
				cleanup()
				return
			}

			const nextSubscriber = new IORedis(url)
			subscriber = nextSubscriber
			if (closed) {
				cleanup()
				return
			}

			try {
				await nextPublisher.ping()
				if (closed) {
					cleanup()
					return
				}
				await nextSubscriber.ping()
			} catch (error) {
				cleanup()
				throw error
			}
			if (closed) {
				cleanup()
				return
			}
			if (consumerGroup) {
				try {
					await nextSubscriber.xgroup("CREATE", stream, consumerGroup, "0", "MKSTREAM")
				} catch (error) {
					if (!(error instanceof Error && error.message.includes("BUSYGROUP"))) {
						cleanup()
						throw error
					}
				}
			}
			if (closed) {
				cleanup()
				return
			}
			void listen().catch((error) => {
				if (!closed) console.error("Redis Streams transport read error:", error)
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
			if (closed) throw new Error("Redis Streams transport has been closed")
			await connect()
			if (!publisher) throw new Error("Redis publisher is not initialized")
			const envelope = createBusEnvelope(message, {
				transportId: "redis-streams",
				from: options.localPeerId,
				to: options.remotePeerId
			})
			const payload = JSON.stringify(envelope)
			if (options.maxLen) {
				await publisher.xadd(stream, "MAXLEN", "~", options.maxLen, "*", "data", payload)
				return
			}
			await publisher.xadd(stream, "*", "data", payload)
		},
		subscribe(listener) {
			listeners.add(listener)
			void connect()
			return () => listeners.delete(listener)
		},
		close() {
			closed = true
			listeners.clear()
			publisher?.disconnect()
			subscriber?.disconnect()
			publisher = undefined
			subscriber = undefined
		}
	}
}
