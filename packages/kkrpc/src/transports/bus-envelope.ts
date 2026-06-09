import type { RPCMessage } from "../core/protocol.ts"

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

export interface CreateBusEnvelopeOptions {
	transportId: string
	from: string
	to?: string
	sequence?: number
}

export interface BusEnvelopeDeliveryOptions {
	localPeerId: string
	allowSelfMessages?: boolean
}

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

export function parseBusEnvelope(raw: string): BusEnvelope | null {
	try {
		const value = JSON.parse(raw) as unknown
		return isBusEnvelope(value) ? value : null
	} catch {
		return null
	}
}

export function shouldDeliverBusEnvelope(
	envelope: BusEnvelope,
	options: BusEnvelopeDeliveryOptions
): boolean {
	if (envelope.protocol !== "kkrpc.bus.v1") return false
	if (!options.allowSelfMessages && envelope.from === options.localPeerId) return false
	if (envelope.to && envelope.to !== options.localPeerId) return false
	return true
}
