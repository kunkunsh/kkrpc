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
		void Promise.resolve(target.send(message)).catch((error) => reportRelayError(direction, error))
	} catch (error) {
		reportRelayError(direction, error)
	}
}

function reportRelayError(direction: "left-to-right" | "right-to-left", error: unknown): void {
	console.error(`[kkrpc relay] Failed to forward ${direction}`, error)
}
