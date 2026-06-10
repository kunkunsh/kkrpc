import type { RPCMessage } from "./core/protocol.ts"
import type { Transport } from "./core/transport.ts"

export interface RelayController {
	dispose(): void
}

export function relayTransport(
	left: Transport<RPCMessage>,
	right: Transport<RPCMessage>
): RelayController {
	const unsubscribeLeft = left.subscribe((message) => forwardMessage("left-to-right", right, message))
	const unsubscribeRight = right.subscribe((message) => forwardMessage("right-to-left", left, message))

	return {
		dispose() {
			unsubscribeLeft()
			unsubscribeRight()
		}
	}
}

function forwardMessage(
	direction: "left-to-right" | "right-to-left",
	target: Transport<RPCMessage>,
	message: RPCMessage
): void {
	try {
		const transfers = target.capabilities?.transfer === true ? collectTransferables(message) : []
		void Promise.resolve(target.send(message, transfers)).catch((error) =>
			reportRelayError(direction, error)
		)
	} catch (error) {
		reportRelayError(direction, error)
	}
}

function collectTransferables(value: unknown): Transferable[] {
	const transfers: Transferable[] = []
	const seen = new WeakSet<object>()
	visitTransferables(value, transfers, seen)
	return transfers
}

function visitTransferables(
	value: unknown,
	transfers: Transferable[],
	seen: WeakSet<object>
): void {
	if (typeof value !== "object" || value === null) return
	if (seen.has(value)) return
	seen.add(value)

	if (Array.isArray(value)) {
		for (const item of value) visitTransferables(item, transfers, seen)
		return
	}

	if (isTransferable(value)) {
		transfers.push(value)
		return
	}

	for (const item of Object.values(value as Record<string, unknown>)) {
		visitTransferables(item, transfers, seen)
	}
}

function isTransferable(value: object): value is Transferable {
	return (
		value instanceof ArrayBuffer ||
		(typeof MessagePort !== "undefined" && value instanceof MessagePort) ||
		(typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) ||
		(typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas) ||
		(typeof ReadableStream !== "undefined" && value instanceof ReadableStream) ||
		(typeof WritableStream !== "undefined" && value instanceof WritableStream) ||
		(typeof TransformStream !== "undefined" && value instanceof TransformStream)
	)
}

function reportRelayError(direction: "left-to-right" | "right-to-left", error: unknown): void {
	console.error(`[kkrpc relay] Failed to forward ${direction}`, error)
}
