import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface ElysiaWebSocketOptions<LocalAPI extends object> {
	expose: LocalAPI
	timeout?: number
}

export interface ElysiaSocketLike {
	raw?: object
	data?: object
	send(message: string): void
	close(): void
}

interface FeedableTransport extends Transport<RPCMessage> {
	feed(message: unknown): void
}

const transports = new WeakMap<object, FeedableTransport>()
const channels = new WeakMap<object, RPCChannel<object, object>>()

export function elysiaWebSocketTransport(ws: ElysiaSocketLike): FeedableTransport {
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
			const parsed =
				typeof message === "string" ? (JSON.parse(message) as RPCMessage) : (message as RPCMessage)
			for (const listener of listeners) listener(parsed)
		}
	}
}

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
