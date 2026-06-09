import type { RPCMessage } from "./core/protocol.ts"
import type { Transport } from "./core/transport.ts"

export interface RelayController {
	dispose(): void
}

export function relayTransport(
	left: Transport<RPCMessage>,
	right: Transport<RPCMessage>
): RelayController {
	const unsubscribeLeft = left.subscribe((message) => void right.send(message))
	const unsubscribeRight = right.subscribe((message) => void left.send(message))

	return {
		dispose() {
			unsubscribeLeft()
			unsubscribeRight()
		}
	}
}
