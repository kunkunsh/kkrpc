/**
 * Elysia WebSocket adapter for stable kkrpc.
 *
 * Elysia routes WebSocket lifecycle events through framework callbacks. This
 * module stores one feedable transport and channel per socket key, then feeds
 * parsed messages from `message()` into the matching transport.
 */

import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Options for exposing a local API through an Elysia WebSocket route. */
export interface ElysiaWebSocketOptions<LocalAPI extends object> {
	/** Local API object exposed to each WebSocket client. */
	expose: LocalAPI
	/** Per-channel RPC timeout in milliseconds. */
	timeout?: number
}

/** Minimal Elysia WebSocket shape used by the transport helper. */
export interface ElysiaSocketLike {
	/** Optional raw socket identity used as the WeakMap key. */
	raw?: object
	/** Optional data object used as the WeakMap key when `raw` is absent. */
	data?: object
	/** Send one JSON-encoded RPC message. */
	send(message: string): void
	/** Close the underlying socket. */
	close(): void
}

/** Transport that accepts Elysia framework message callbacks through `feed()`. */
export interface FeedableElysiaWebSocketTransport extends Transport<RPCMessage> {
	/** Feed one framework-delivered message into the transport. */
	feed(message: unknown): void
}

const transports = new WeakMap<object, FeedableElysiaWebSocketTransport>()
const channels = new WeakMap<object, RPCChannel<object, object>>()

/**
 * Wrap an Elysia socket-like object in a feedable kkrpc transport.
 *
 * The transport is bidirectional and callback-capable. Framework message events
 * must be passed to `feed()`; `close()` closes the Elysia socket.
 */
export function elysiaWebSocketTransport(ws: ElysiaSocketLike): FeedableElysiaWebSocketTransport {
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
			// Elysia owns receive callbacks, so route handlers feed raw payloads into this transport.
			if (closed) return
			const parsed = parseMessage(message)
			if (!parsed) return
			for (const listener of listeners) listener(parsed)
		}
	}
}

function parseMessage(message: unknown): RPCMessage | undefined {
	if (typeof message !== "string") return message as RPCMessage
	try {
		return JSON.parse(message) as RPCMessage
	} catch {
		return undefined
	}
}

/**
 * Create Elysia lifecycle handlers that expose a local API per WebSocket.
 *
 * The handler keeps per-socket channel state in weak maps and destroys the
 * channel when Elysia reports the socket closing.
 */
export function createElysiaWebSocketHandler<LocalAPI extends object>(
	options: ElysiaWebSocketOptions<LocalAPI>
): {
	open(ws: ElysiaSocketLike): void
	message(ws: ElysiaSocketLike, message: unknown): void
	close(ws: ElysiaSocketLike): void
} {
	return {
		open(ws) {
			const transport = elysiaWebSocketTransport(ws)
			const channel = new RPCChannel<LocalAPI, object>(transport, {
				expose: options.expose,
				timeout: options.timeout
			})
			const key = getSocketKey(ws)
			transports.set(key, transport)
			channels.set(key, channel as RPCChannel<object, object>)
		},
		message(ws, message) {
			transports.get(getSocketKey(ws))?.feed(message)
		},
		close(ws) {
			const key = getSocketKey(ws)
			channels.get(key)?.destroy()
			channels.delete(key)
			transports.delete(key)
		}
	}
}

function getSocketKey(ws: ElysiaSocketLike): object {
	return ws.raw ?? ws.data ?? ws
}
