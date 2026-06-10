/**
 * NATS subject transport for stable kkrpc.
 *
 * NATS subjects can deliver the same message to multiple subscribers. This
 * transport wraps RPC messages in bus envelopes, filters self-delivery and
 * explicit targets, and consumes messages from an async subscription loop.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, parseBusEnvelope, shouldDeliverBusEnvelope } from "./bus-envelope.ts"

interface NatsMessageLike {
	string(): string
}

interface NatsSubscriptionLike extends AsyncIterable<NatsMessageLike> {
	unsubscribe(): void
}

interface NatsConnectionLike {
	publish(subject: string, payload: string): void
	subscribe(subject: string, options?: { queue?: string }): NatsSubscriptionLike
	close(): Promise<void>
}

/** Options for connecting a kkrpc transport to NATS. */
export interface NatsTransportOptions {
	servers?: string | string[]
	subject?: string
	queueGroup?: string
	timeout?: number
	localPeerId: string
	remotePeerId?: string
	/** @internal Test seam for close/connect race coverage. */
	__connect?: () => Promise<NatsConnectionLike>
}

/** Message-level NATS transport type. */
export type NatsTransport = Transport<RPCMessage>

/** Parse, filter, and deliver one NATS bus payload. */
export function handleNatsBusMessage(
	raw: string,
	localPeerId: string,
	listeners: Set<(message: RPCMessage) => void>
): void {
	const envelope = parseBusEnvelope(raw)
	if (!envelope) return
	// Ignore self-delivered messages and envelopes addressed to another peer.
	if (!shouldDeliverBusEnvelope(envelope, { localPeerId })) return
	try {
		listeners.forEach((listener) => listener(envelope.message))
	} catch (error) {
		console.error("NATS transport delivery error:", error)
	}
}

/**
 * Create a NATS-backed kkrpc transport.
 *
 * The transport lazily connects, subscribes to a subject, publishes bus
 * envelopes, and closes the subscription/connection on `close()`. It is
 * bidirectional through NATS, callback-capable, and does not support transferables.
 */
export function natsTransport(options: NatsTransportOptions): NatsTransport {
	const subject = options.subject || "kkrpc.messages"
	const listeners = new Set<(message: RPCMessage) => void>()
	let connection: NatsConnectionLike | undefined
	let subscription: NatsSubscriptionLike | undefined
	let connectionPromise: Promise<void> | undefined
	let closed = false

	async function consume(): Promise<void> {
		if (!subscription) return
		for await (const message of subscription) {
			if (closed) break
			handleNatsBusMessage(message.string(), options.localPeerId, listeners)
		}
	}

	async function connectNats(): Promise<void> {
		if (connectionPromise) return connectionPromise
		connectionPromise = (async () => {
			const servers = options.servers || "nats://localhost:4222"
			const nextConnection = options.__connect
				? await options.__connect()
				: ((await (
						await import("@nats-io/transport-node")
					).connect({
						servers: Array.isArray(servers) ? servers : [servers],
						timeout: options.timeout || 10000,
						reconnectTimeWait: 1000,
						noEcho: false
					})) as NatsConnectionLike)
			if (closed) {
				await nextConnection.close().catch(() => {})
				return
			}
			connection = nextConnection
			subscription = nextConnection.subscribe(subject, { queue: options.queueGroup })
			if (closed) {
				subscription.unsubscribe()
				await nextConnection.close().catch(() => {})
				return
			}
			void consume().catch((error) => {
				if (!closed) console.error("NATS transport consume error:", error)
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
			if (closed) throw new Error("NATS transport has been closed")
			await connectNats()
			if (!connection) throw new Error("NATS connection is not initialized")
			const envelope = createBusEnvelope(message, {
				transportId: "nats",
				from: options.localPeerId,
				to: options.remotePeerId
			})
			connection.publish(subject, JSON.stringify(envelope))
		},
		subscribe(listener) {
			listeners.add(listener)
			void connectNats()
			return () => listeners.delete(listener)
		},
		close() {
			closed = true
			listeners.clear()
			subscription?.unsubscribe()
			void connection?.close().catch(() => {})
			subscription = undefined
			connection = undefined
		}
	}
}
