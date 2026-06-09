/** Chrome extension transports for stable kkrpc. */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

interface ChromePortLike {
	postMessage(message: RPCMessage): void
	onMessage: {
		addListener(listener: (message: RPCMessage) => void): void
		removeListener(listener: (message: RPCMessage) => void): void
	}
	onDisconnect?: {
		addListener(listener: () => void): void
		removeListener(listener: () => void): void
	}
	disconnect?(): void
}

/** Create a transport backed by a chrome.runtime.Port. */
export function chromePortTransport(port: ChromePortLike): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: false },
		send(message: RPCMessage) {
			port.postMessage(message)
		},
		subscribe(listener: (message: RPCMessage) => void) {
			port.onMessage.addListener(listener)
			return () => port.onMessage.removeListener(listener)
		},
		close() {
			port.disconnect?.()
		}
	}
}
