/**
 * WebSocket transports for stable bidirectional kkrpc channels.
 *
 * WebSockets provide a persistent full-duplex channel, so they support regular
 * calls, server-initiated calls, and callback arguments. Messages are encoded as
 * JSON strings; transferables are not supported by this transport.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Minimal browser, Bun, Deno, or Node WebSocket shape used by `webSocketTransport()`. */
export interface WebSocketLike {
	/** WebSocket ready state when exposed by the host implementation. */
	readyState?: number
	/** Send one JSON-encoded RPC message. */
	send(data: string): void
	/** Close the underlying socket. */
	close(): void
	/** Browser-style message handler slot. */
	onmessage?: unknown
	/** Browser-style open handler slot. */
	onopen?: unknown
	/** Browser-style close handler slot. */
	onclose?: unknown
	/** Browser-style error handler slot. */
	onerror?: unknown
	/** Browser-style event listener registration. */
	addEventListener?: unknown
	/** Browser-style event listener removal. */
	removeEventListener?: unknown
	/** Node-style event listener registration. */
	on?: unknown
	/** Node-style event listener removal. */
	off?: unknown
	/** Legacy Node-style listener removal. */
	removeListener?: unknown
}

/** Options for creating a client WebSocket from the ambient `WebSocket` constructor. */
export interface WebSocketClientTransportOptions {
	/** WebSocket URL to connect to. */
	url: string
	/** Optional protocols passed to the WebSocket constructor. */
	protocols?: string | string[]
}

const CONNECTING_READY_STATE = 0
const OPEN_READY_STATE = 1
const textDecoder = new TextDecoder()

/**
 * Wrap an accepted or pre-created WebSocket-like object as a kkrpc transport.
 *
 * The transport is bidirectional and supports callback arguments. Sends before
 * the socket reaches the open state are queued and flushed on `open`; `close()`
 * clears queued data, detaches listeners, and closes the socket.
 */
export function webSocketTransport(socket: WebSocketLike): Transport<RPCMessage> {
	const listeners = new Set<(message: RPCMessage) => void>()
	const pending: string[] = []
	let detachMessageListener: (() => void) | undefined
	let detachOpenListener: (() => void) | undefined
	let closed = false

	// Connection-close notification, independent of message-listener churn so it can
	// still fire after `subscribe` unsubscribes. One-shot; the first reason wins.
	const closeListeners = new Set<(reason?: Error) => void>()
	let closeNotified = false
	let closeReason: Error | undefined
	let detachCloseListener: (() => void) | undefined
	let detachErrorListener: (() => void) | undefined

	const notifyClose = (reason?: Error) => {
		if (closeNotified) return
		closeNotified = true
		closeReason = reason
		pending.length = 0
		detachCloseListener?.()
		detachErrorListener?.()
		detachCloseListener = undefined
		detachErrorListener = undefined
		for (const listener of [...closeListeners]) listener(reason)
		closeListeners.clear()
	}

	const flush = () => {
		// Queueing lets callers create the channel before the socket has fully opened.
		if (closed || (socket.readyState !== undefined && socket.readyState !== OPEN_READY_STATE))
			return
		while (pending.length > 0) socket.send(pending.shift() ?? "")
	}

	const onMessage = (data: unknown) => {
		const message = parseMessage(data)
		if (!message) return
		for (const listener of listeners) listener(message)
	}

	const attachNativeListeners = () => {
		detachMessageListener ??= attachMessageListener(socket, onMessage)
		detachOpenListener ??= attachOpenListener(socket, flush)
	}
	const detachNativeListeners = () => {
		detachMessageListener?.()
		detachOpenListener?.()
		detachMessageListener = undefined
		detachOpenListener = undefined
	}

	attachNativeListeners()
	// A network error (which may precede a close) carries the reason; a clean close
	// with code 1000 or no code reports `undefined`.
	detachErrorListener = attachErrorListener(socket, (error) => notifyClose(error))
	detachCloseListener = attachCloseListener(socket, (reason) => notifyClose(reason))

	return {
		capabilities: { objectMode: false, transfer: false, remoteRefs: true },
		send(message) {
			const raw = JSON.stringify(message)
			if (socket.readyState === undefined || socket.readyState === OPEN_READY_STATE) {
				socket.send(raw)
				return
			}
			if (socket.readyState !== CONNECTING_READY_STATE) throw new Error("WebSocket is not open")
			pending.push(raw)
		},
		subscribe(listener) {
			attachNativeListeners()
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
				if (listeners.size === 0) detachNativeListeners()
			}
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
			// A local close is intentional teardown: suppress onClose so app reconnect
			// logic does not treat it as a dropped connection.
			closed = true
			closeNotified = true
			pending.length = 0
			detachNativeListeners()
			detachCloseListener?.()
			detachErrorListener?.()
			detachCloseListener = undefined
			detachErrorListener = undefined
			closeListeners.clear()
			socket.close()
		}
	}
}

/**
 * Create a client WebSocket transport from a URL and optional protocols.
 *
 * This is bidirectional, supports callback arguments, does not support
 * transferables, and closes the underlying socket when the transport closes.
 */
export function webSocketClientTransport(
	options: WebSocketClientTransportOptions
): Transport<RPCMessage> {
	return webSocketTransport(new WebSocket(options.url, options.protocols))
}

function attachMessageListener(
	socket: WebSocketLike,
	listener: (data: unknown) => void
): () => void {
	if (typeof socket.addEventListener === "function") {
		const addEventListener = socket.addEventListener as (
			event: "message",
			listener: (event: unknown) => void
		) => void
		const handler = (event: unknown) => listener(getEventData(event))
		addEventListener.call(socket, "message", handler)
		return () => removeEventListener(socket, "message", handler)
	}

	if (typeof socket.on === "function") {
		const on = socket.on as (event: "message", listener: (data: unknown) => void) => void
		on.call(socket, "message", listener)
		return () => removeNodeListener(socket, "message", listener)
	}

	const previous = socket.onmessage
	socket.onmessage = (event: unknown) => listener(getEventData(event))
	return () => {
		socket.onmessage = previous
	}
}

function attachOpenListener(socket: WebSocketLike, listener: () => void): () => void {
	if (socket.readyState === undefined || socket.readyState === OPEN_READY_STATE) {
		queueMicrotask(listener)
		return () => {}
	}

	if (typeof socket.addEventListener === "function") {
		const addEventListener = socket.addEventListener as (
			event: "open",
			listener: (event: unknown) => void
		) => void
		addEventListener.call(socket, "open", listener)
		return () => removeEventListener(socket, "open", listener)
	}

	if (typeof socket.on === "function") {
		const on = socket.on as (event: "open", listener: () => void) => void
		on.call(socket, "open", listener)
		return () => removeNodeListener(socket, "open", listener)
	}

	const previous = socket.onopen
	socket.onopen = (event: unknown) => {
		listener()
		if (typeof previous === "function") previous(event)
	}
	return () => {
		socket.onopen = previous
	}
}

// Normalize a close signal to a reason: clean closes (code 1000 or absent) report
// undefined; abnormal codes report an Error. Handles both the browser CloseEvent
// shape and Node `ws`'s (code, reason) argument style.
function closeEventReason(codeOrEvent: unknown, maybeReason?: unknown): Error | undefined {
	let code: number | undefined
	let reason: string | undefined
	if (typeof codeOrEvent === "number") {
		code = codeOrEvent
		reason = typeof maybeReason === "string" ? maybeReason : maybeReason?.toString?.()
	} else if (typeof codeOrEvent === "object" && codeOrEvent !== null) {
		const event = codeOrEvent as { code?: number; reason?: string }
		code = event.code
		reason = event.reason
	}
	if (code === undefined || code === 1000) return undefined
	return new Error(`WebSocket closed (code ${code}${reason ? `: ${reason}` : ""})`)
}

function attachCloseListener(
	socket: WebSocketLike,
	listener: (reason?: Error) => void
): () => void {
	if (typeof socket.addEventListener === "function") {
		const addEventListener = socket.addEventListener as (
			event: "close",
			listener: (event: unknown) => void
		) => void
		const handler = (event: unknown) => listener(closeEventReason(event))
		addEventListener.call(socket, "close", handler)
		return () => removeEventListener(socket, "close", handler)
	}

	if (typeof socket.on === "function") {
		const on = socket.on as (event: "close", listener: (...args: unknown[]) => void) => void
		const handler = (code: unknown, reason: unknown) => listener(closeEventReason(code, reason))
		on.call(socket, "close", handler)
		return () => removeNodeListener(socket, "close", handler as (event: unknown) => void)
	}

	const previous = socket.onclose
	socket.onclose = (event: unknown) => {
		listener(closeEventReason(event))
		if (typeof previous === "function") previous(event)
	}
	return () => {
		socket.onclose = previous
	}
}

function attachErrorListener(
	socket: WebSocketLike,
	listener: (reason: Error) => void
): () => void {
	if (typeof socket.addEventListener === "function") {
		const addEventListener = socket.addEventListener as (
			event: "error",
			listener: (event: unknown) => void
		) => void
		// Browser error events carry no Error object.
		const handler = () => listener(new Error("WebSocket error"))
		addEventListener.call(socket, "error", handler)
		return () => removeEventListener(socket, "error", handler)
	}

	if (typeof socket.on === "function") {
		const on = socket.on as (event: "error", listener: (...args: unknown[]) => void) => void
		const handler = (error: unknown) =>
			listener(error instanceof Error ? error : new Error(String(error ?? "WebSocket error")))
		on.call(socket, "error", handler)
		return () => removeNodeListener(socket, "error", handler as (event: unknown) => void)
	}

	const previous = socket.onerror
	socket.onerror = (event: unknown) => {
		listener(event instanceof Error ? event : new Error("WebSocket error"))
		if (typeof previous === "function") previous(event)
	}
	return () => {
		socket.onerror = previous
	}
}

function parseMessage(data: unknown): RPCMessage | undefined {
	try {
		return JSON.parse(toText(data)) as RPCMessage
	} catch {
		return undefined
	}
}

function removeEventListener(
	socket: WebSocketLike,
	event: "message" | "open" | "close" | "error",
	listener: (event: unknown) => void
): void {
	if (typeof socket.removeEventListener !== "function") return
	const remove = socket.removeEventListener as (
		event: "message" | "open" | "close" | "error",
		listener: (event: unknown) => void
	) => void
	remove.call(socket, event, listener)
}

function removeNodeListener(
	socket: WebSocketLike,
	event: "message" | "open" | "close" | "error",
	listener: (event: unknown) => void
): void {
	const remove = typeof socket.off === "function" ? socket.off : socket.removeListener
	if (typeof remove !== "function") return
	;(
		remove as (
			event: "message" | "open" | "close" | "error",
			listener: (event: unknown) => void
		) => void
	).call(socket, event, listener)
}

function getEventData(event: unknown): unknown {
	return typeof event === "object" && event !== null && "data" in event ? event.data : event
}

function toText(data: unknown): string {
	if (typeof data === "string") return data
	if (data instanceof ArrayBuffer) return textDecoder.decode(data)
	if (ArrayBuffer.isView(data)) {
		return textDecoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
	}
	return String(data)
}
