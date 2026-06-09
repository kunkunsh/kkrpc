import type { NatsConnection, Subscription } from "@nats-io/transport-node"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, shouldDeliverBusEnvelope, type BusEnvelope } from "./bus-envelope.ts"

export interface NatsTransportOptions {
	servers?: string | string[]
	subject?: string
	queueGroup?: string
	timeout?: number
	localPeerId: string
	remotePeerId?: string
}

export type NatsTransport = Transport<RPCMessage>

export function natsTransport(options: NatsTransportOptions): NatsTransport {
	const subject = options.subject || "kkrpc.messages"
	const listeners = new Set<(message: RPCMessage) => void>()
	let connection: NatsConnection | undefined
	let subscription: Subscription | undefined
	let connectionPromise: Promise<void> | undefined
	let closed = false

	async function consume(): Promise<void> {
		if (!subscription) return
		for await (const message of subscription) {
			if (closed) break
			const envelope = JSON.parse(message.string()) as BusEnvelope
			if (shouldDeliverBusEnvelope(envelope, { localPeerId: options.localPeerId })) {
				listeners.forEach((listener) => listener(envelope.message))
			}
		}
	}

	async function connectNats(): Promise<void> {
		if (connectionPromise) return connectionPromise
		connectionPromise = (async () => {
			const { connect } = await import("@nats-io/transport-node")
			const servers = options.servers || "nats://localhost:4222"
			connection = await connect({
				servers: Array.isArray(servers) ? servers : [servers],
				timeout: options.timeout || 10000,
				reconnectTimeWait: 1000,
				noEcho: false
			})
			subscription = connection.subscribe(subject, { queue: options.queueGroup })
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
