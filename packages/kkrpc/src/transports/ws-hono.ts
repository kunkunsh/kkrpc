/**
 * Hono WebSocket adapter for stable kkrpc.
 *
 * Hono delivers accepted WebSocket messages through framework callbacks rather
 * than a standard socket event emitter. This module creates a feedable transport
 * that framework callbacks can push messages into while `RPCChannel` sends JSON
 * replies through Hono's `WSContext`.
 */

import type { WSContext, WSEvents } from "hono/ws"
import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Options for exposing a local API through a Hono WebSocket route. */
export interface HonoWebSocketOptions<LocalAPI extends object> {
	expose: LocalAPI
	timeout?: number
}

interface FeedableTransport extends Transport<RPCMessage> {
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
	ws: Pick<WSContext<unknown>, "send" | "close">
): FeedableTransport {
	const listeners = new Set<(message: RPCMessage) => void>()
	let closed = false

	return {
		capabilities: { objectMode: true, transfer: false },
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
): WSEvents<unknown> {
	let transport: FeedableTransport | undefined
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
