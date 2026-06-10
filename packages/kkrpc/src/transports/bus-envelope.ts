/**
 * Shared envelope helpers for broadcast-oriented message bus transports.
 *
 * RabbitMQ, Kafka, Redis Streams, and NATS can deliver the same payload to
 * multiple peers, including the sender. These helpers wrap compact RPC messages
 * with peer metadata so transports can filter by sender, target, and protocol
 * version before forwarding a message into an `RPCChannel`.
 */

import type { RPCMessage } from "../core/protocol.ts"

/** RPC message plus routing metadata used by message-bus transports. */
export interface BusEnvelope {
	protocol: "kkrpc.bus.v1"
	transportId: string
	from: string
	to?: string
	correlationId?: string
	sequence?: number
	sentAt?: number
	message: RPCMessage
}

/** Metadata needed to wrap an outgoing RPC message for a bus transport. */
export interface CreateBusEnvelopeOptions {
	transportId: string
	from: string
	to?: string
	sequence?: number
}

/** Local delivery settings used to decide whether an envelope is for this peer. */
export interface BusEnvelopeDeliveryOptions {
	localPeerId: string
	allowSelfMessages?: boolean
}

/** Create a protocol-tagged bus envelope for an outgoing RPC message. */
export function createBusEnvelope(
	message: RPCMessage,
	options: CreateBusEnvelopeOptions
): BusEnvelope {
	return {
		protocol: "kkrpc.bus.v1",
		transportId: options.transportId,
		from: options.from,
		to: options.to,
		correlationId: "id" in message ? message.id : undefined,
		sequence: options.sequence,
		sentAt: Date.now(),
		message
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object"
}

function isRPCMessage(value: unknown): value is RPCMessage {
	if (!isRecord(value)) return false
	if (value.t === "q") {
		return (
			typeof value.id === "string" &&
			(value.op === "call" || value.op === "get" || value.op === "set" || value.op === "new") &&
			Array.isArray(value.p) &&
			value.p.every((part) => typeof part === "string")
		)
	}
	if (value.t === "r") return typeof value.id === "string"
	if (value.t === "cb") return typeof value.id === "string" && Array.isArray(value.a)
	return false
}

/** Check whether an unknown value is a structurally valid bus envelope. */
export function isBusEnvelope(value: unknown): value is BusEnvelope {
	return (
		isRecord(value) &&
		value.protocol === "kkrpc.bus.v1" &&
		typeof value.transportId === "string" &&
		typeof value.from === "string" &&
		(value.to === undefined || typeof value.to === "string") &&
		(value.correlationId === undefined || typeof value.correlationId === "string") &&
		(value.sequence === undefined || typeof value.sequence === "number") &&
		(value.sentAt === undefined || typeof value.sentAt === "number") &&
		isRPCMessage(value.message)
	)
}

/** Parse a JSON bus payload, returning `null` for invalid or non-kkrpc data. */
export function parseBusEnvelope(raw: string): BusEnvelope | null {
	try {
		const value = JSON.parse(raw) as unknown
		return isBusEnvelope(value) ? value : null
	} catch {
		return null
	}
}

/**
 * Decide whether this peer should receive an envelope.
 *
 * Session/source/target filtering prevents cross-talk when a bus topic, stream,
 * exchange, or subject is shared by several kkrpc transports.
 */
export function shouldDeliverBusEnvelope(
	envelope: BusEnvelope,
	options: BusEnvelopeDeliveryOptions
): boolean {
	if (envelope.protocol !== "kkrpc.bus.v1") return false
	if (!options.allowSelfMessages && envelope.from === options.localPeerId) return false
	if (envelope.to && envelope.to !== options.localPeerId) return false
	return true
}
