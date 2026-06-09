import type { WSContext, WSEvents } from "hono/ws"
import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface HonoWebSocketOptions<LocalAPI extends object> {
	expose: LocalAPI
	timeout?: number
}

interface FeedableTransport extends Transport<RPCMessage> {
	feed(message: unknown): void
}

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
			if (closed) return
			const raw = typeof message === "string" ? message : String(message)
			const parsed = JSON.parse(raw) as RPCMessage
			for (const listener of listeners) listener(parsed)
		}
	}
}

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
