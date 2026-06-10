/**
 * Browser-only WebSocket client transport.
 *
 * This entry creates a WebSocket from the ambient browser constructor and wraps
 * it as a bidirectional kkrpc transport. It supports callbacks and queued sends
 * before `open`, but not transferables.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Options for creating a browser WebSocket client transport. */
export interface WebSocketClientTransportOptions {
	url: string
	protocols?: string | string[]
}

/**
 * Create a browser WebSocket client transport.
 *
 * Closing the transport removes event listeners, clears pending messages, and
 * closes the underlying socket.
 */
export function webSocketClientTransport(
	options: WebSocketClientTransportOptions
): Transport<RPCMessage> {
	const socket = new WebSocket(options.url, options.protocols)
	const listeners = new Set<(message: RPCMessage) => void>()
	const pending: string[] = []
	let closed = false

	const flush = () => {
		// Calls made before the socket opens are serialized and sent once open fires.
		if (closed || socket.readyState !== WebSocket.OPEN) return
		while (pending.length > 0) socket.send(pending.shift() ?? "")
	}

	const messageListener = (event: MessageEvent) => {
		try {
			const message = JSON.parse(String(event.data)) as RPCMessage
			for (const listener of listeners) listener(message)
		} catch {
			// Ignore non-kkrpc messages sharing the same socket.
		}
	}

	socket.addEventListener("open", flush)
	socket.addEventListener("message", messageListener)

	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			const raw = JSON.stringify(message)
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(raw)
				return
			}
			if (socket.readyState !== WebSocket.CONNECTING) throw new Error("WebSocket is not open")
			pending.push(raw)
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		close() {
			closed = true
			pending.length = 0
			socket.removeEventListener("open", flush)
			socket.removeEventListener("message", messageListener)
			socket.close()
		}
	}
}
