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
	/** WebSocket URL to connect to. */
	url: string
	/** Optional protocols passed to the WebSocket constructor. */
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

	const closeListeners = new Set<(reason?: Error) => void>()
	let closeNotified = false
	let closeReason: Error | undefined

	const notifyClose = (reason?: Error) => {
		if (closeNotified) return
		closeNotified = true
		closeReason = reason
		pending.length = 0
		socket.removeEventListener("close", closeHandler)
		socket.removeEventListener("error", errorHandler)
		for (const listener of [...closeListeners]) listener(reason)
		closeListeners.clear()
	}

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

	const closeHandler = (event: CloseEvent) => {
		// Clean close (code 1000 or absent) reports no reason; abnormal codes report one.
		if (event.code === undefined || event.code === 1000) return notifyClose(undefined)
		notifyClose(new Error(`WebSocket closed (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`))
	}
	const errorHandler = () => notifyClose(new Error("WebSocket error"))

	socket.addEventListener("open", flush)
	socket.addEventListener("message", messageListener)
	socket.addEventListener("close", closeHandler)
	socket.addEventListener("error", errorHandler)

	return {
		capabilities: { objectMode: false, transfer: false, remoteRefs: true },
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
		onClose(listener) {
			if (closeNotified) {
				const reason = closeReason
				queueMicrotask(() => listener(reason))
				return () => {}
			}
			closeListeners.add(listener)
			return () => closeListeners.delete(listener)
		},
		close() {
			// Local close is intentional; do not fire onClose.
			closed = true
			closeNotified = true
			pending.length = 0
			socket.removeEventListener("open", flush)
			socket.removeEventListener("message", messageListener)
			socket.removeEventListener("close", closeHandler)
			socket.removeEventListener("error", errorHandler)
			closeListeners.clear()
			socket.close()
		}
	}
}
