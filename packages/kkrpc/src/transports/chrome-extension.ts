/**
 * Chrome extension Port transport for stable kkrpc.
 *
 * `chromePortTransport()` wraps a `chrome.runtime.Port`-like object. The port is
 * bidirectional and supports callbacks, but Chrome extension messaging does not
 * provide kkrpc transferables through this helper.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Minimal Chrome extension Port shape used by `chromePortTransport()`. */
export interface ChromePortLike {
	/** Post one object-mode RPC message to the port. */
	postMessage(message: RPCMessage): void
	/** Chrome message listener registry. */
	onMessage: {
		/** Attach an incoming message listener. */
		addListener(listener: (message: RPCMessage) => void): void
		/** Remove an incoming message listener. */
		removeListener(listener: (message: RPCMessage) => void): void
	}
	/** Optional disconnect listener registry. */
	onDisconnect?: {
		/** Attach a disconnect listener. */
		addListener(listener: () => void): void
		/** Remove a disconnect listener. */
		removeListener(listener: () => void): void
	}
	/** Optionally disconnect the port when the transport closes. */
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
