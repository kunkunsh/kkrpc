import type { default as Redis } from "ioredis"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, shouldDeliverBusEnvelope, type BusEnvelope } from "./bus-envelope.ts"

export interface RedisStreamsTransportOptions {
	url?: string
	stream?: string
	blockTimeout?: number
	maxLen?: number
	localPeerId: string
	remotePeerId?: string
}

export type RedisStreamsTransport = Transport<RPCMessage>

export function redisStreamsTransport(
	options: RedisStreamsTransportOptions
): RedisStreamsTransport {
	const stream = options.stream || "kkrpc-stream"
	const listeners = new Set<(message: RPCMessage) => void>()
	let publisher: Redis | undefined
	let subscriber: Redis | undefined
	let connectionPromise: Promise<void> | undefined
	let lastId = "$"
	let closed = false

	async function listen(): Promise<void> {
		while (!closed && subscriber) {
			const results = await subscriber.xread(
				"BLOCK",
				options.blockTimeout || 5000,
				"STREAMS",
				stream,
				lastId
			)
			if (!results) continue
			for (const [, messages] of results) {
				for (const [messageId, fields] of messages) {
					lastId = messageId
					const dataIndex = fields.indexOf("data")
					const data = dataIndex >= 0 ? fields[dataIndex + 1] : undefined
					if (!data) continue
					const envelope = JSON.parse(data) as BusEnvelope
					if (shouldDeliverBusEnvelope(envelope, { localPeerId: options.localPeerId })) {
						listeners.forEach((listener) => listener(envelope.message))
					}
				}
			}
		}
	}

	async function connect(): Promise<void> {
		if (connectionPromise) return connectionPromise
		connectionPromise = (async () => {
			const { default: IORedis } = await import("ioredis")
			const url = options.url || "redis://localhost:6379"
			publisher = new IORedis(url)
			subscriber = new IORedis(url)
			await publisher.ping()
			await subscriber.ping()
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
