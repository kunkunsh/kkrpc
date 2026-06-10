/**
 * Chrome extension Port transport for stable kkrpc.
 *
 * `chromePortTransport()` wraps a `chrome.runtime.Port`-like object. The port is
 * bidirectional and supports callbacks, but Chrome extension messaging does not
 * provide kkrpc transferables through this helper.
 */

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

/**
 * Create a transport backed by a `chrome.runtime.Port`.
 *
 * The returned transport posts object-mode RPC messages, subscribes through
 * `port.onMessage`, cleans listeners on disconnect, and calls `disconnect()`
 * when the transport closes.
 */
export function chromePortTransport(port: ChromePortLike): Transport<RPCMessage> {
	const messageListeners = new Set<(message: RPCMessage) => void>()
	let closed = false

	const cleanup = () => {
		if (closed) return
		closed = true
		for (const listener of messageListeners) port.onMessage.removeListener(listener)
		messageListeners.clear()
		port.onDisconnect?.removeListener(cleanup)
	}

	port.onDisconnect?.addListener(cleanup)

	return {
		capabilities: { objectMode: true, transfer: false },
		send(message: RPCMessage) {
			if (closed) return
			port.postMessage(message)
		},
		subscribe(listener: (message: RPCMessage) => void) {
			if (closed) return () => {}
			messageListeners.add(listener)
			port.onMessage.addListener(listener)
			return () => {
				messageListeners.delete(listener)
				port.onMessage.removeListener(listener)
			}
		},
		close() {
			cleanup()
			port.disconnect?.()
		}
	}
}
