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

	return {
		capabilities: { objectMode: true, transfer: false },
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
		close() {
			closed = true
			pending.length = 0
			detachNativeListeners()
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

function parseMessage(data: unknown): RPCMessage | undefined {
	try {
		return JSON.parse(toText(data)) as RPCMessage
	} catch {
		return undefined
	}
}

function removeEventListener(
	socket: WebSocketLike,
	event: "message" | "open",
	listener: (event: unknown) => void
): void {
	if (typeof socket.removeEventListener !== "function") return
	const remove = socket.removeEventListener as (
		event: "message" | "open",
		listener: (event: unknown) => void
	) => void
	remove.call(socket, event, listener)
}

function removeNodeListener(
	socket: WebSocketLike,
	event: "message" | "open",
	listener: (event: unknown) => void
): void {
	const remove = typeof socket.off === "function" ? socket.off : socket.removeListener
	if (typeof remove !== "function") return
	;(remove as (event: "message" | "open", listener: (event: unknown) => void) => void).call(
		socket,
		event,
		listener
	)
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
