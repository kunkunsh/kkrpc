/**
 * Hono WebSocket adapter for stable kkrpc.
 *
 * Hono delivers accepted WebSocket messages through framework callbacks rather
 * than a standard socket event emitter. This module creates a feedable transport
 * that framework callbacks can push messages into while `RPCChannel` sends JSON
 * replies through Hono's `WSContext`.
 */

import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Minimal Hono WebSocket context shape used by kkrpc helpers. */
export interface HonoWebSocketContextLike {
	/** Send one JSON-encoded RPC message. */
	send(message: string): void
	/** Close the underlying WebSocket connection. */
	close(): void
}

/** Hono-style WebSocket event callbacks returned by `createHonoWebSocketHandler()`. */
export interface HonoWebSocketHandlerEvents {
	/** Initialize a channel for an opened socket. */
	onOpen(_event: Event, ws: HonoWebSocketContextLike): void
	/** Feed one incoming WebSocket message into the channel. */
	onMessage(event: { data: unknown }): void
	/** Destroy the channel when the socket closes. */
	onClose(): void
	/** Destroy the channel when the socket reports an error. */
	onError(): void
}

/** Options for exposing a local API through a Hono WebSocket route. */
export interface HonoWebSocketOptions<LocalAPI extends object> {
	/** Local API object exposed to each WebSocket client. */
	expose: LocalAPI
	/** Per-channel RPC timeout in milliseconds. */
	timeout?: number
}

/** Transport that accepts Hono framework message callbacks through `feed()`. */
export interface FeedableHonoWebSocketTransport extends Transport<RPCMessage> {
	/** Feed one framework-delivered message into the transport. */
	feed(message: unknown): void
}

/**
 * Wrap a Hono WebSocket context in a feedable kkrpc transport.
 *
 * The transport is bidirectional and callback-capable. Incoming framework
 * message events must be passed to `feed()`; `close()` marks the transport
 * closed and closes the Hono socket.
 */
export function honoWebSocketTransport(
	ws: HonoWebSocketContextLike
): FeedableHonoWebSocketTransport {
	const listeners = new Set<(message: RPCMessage) => void>()
	let closed = false

	return {
		capabilities: { objectMode: false, transfer: false, remoteRefs: true },
		send(message) {
			if (!closed) ws.send(JSON.stringify(message))
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		close() {
			closed = true
			ws.close()
		},
		feed(message) {
			// Hono owns receive callbacks, so the route handler feeds raw events into the transport.
			if (closed) return
			const raw = typeof message === "string" ? message : String(message)
			const parsed = parseMessage(raw)
			if (!parsed) return
			for (const listener of listeners) listener(parsed)
		}
	}
}

function parseMessage(raw: string): RPCMessage | undefined {
	try {
		return JSON.parse(raw) as RPCMessage
	} catch {
		return undefined
	}
}

/**
 * Create Hono `WSEvents` that expose a local API over each WebSocket connection.
 *
 * Each open connection gets its own `RPCChannel`; close and error callbacks
 * destroy that channel to remove pending requests and subscriptions.
 */
export function createHonoWebSocketHandler<LocalAPI extends object>(
	options: HonoWebSocketOptions<LocalAPI>
): HonoWebSocketHandlerEvents {
	let transport: FeedableHonoWebSocketTransport | undefined
	let channel: RPCChannel<LocalAPI, object> | undefined

	return {
		onOpen(_event, ws) {
			transport = honoWebSocketTransport(ws)
			channel = new RPCChannel<LocalAPI, object>(transport, {
				expose: options.expose,
				timeout: options.timeout
			})
		},
		onMessage(event) {
			transport?.feed(event.data)
		},
		onClose() {
			channel?.destroy()
			channel = undefined
			transport = undefined
		},
		onError() {
			channel?.destroy()
			channel = undefined
			transport = undefined
		}
	}
}
