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

export function shouldDeliverBusEnvelope(
	envelope: BusEnvelope,
	options: BusEnvelopeDeliveryOptions
): boolean {
	if (envelope.protocol !== "kkrpc.bus.v1") return false
	if (!options.allowSelfMessages && envelope.from === options.localPeerId) return false
	if (envelope.to && envelope.to !== options.localPeerId) return false
	return true
}
