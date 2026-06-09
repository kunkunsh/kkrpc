import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface WebSocketLike {
	readyState?: number
	send(data: string): void
	close(): void
	onmessage?: unknown
	onopen?: unknown
	addEventListener?: unknown
	on?: unknown
}

export interface WebSocketClientTransportOptions {
	url: string
	protocols?: string | string[]
}

const OPEN_READY_STATE = 1
const textDecoder = new TextDecoder()

export function webSocketTransport(socket: WebSocketLike): Transport<RPCMessage> {
	const listeners = new Set<(message: RPCMessage) => void>()
	const pending: string[] = []
	let closed = false

	const flush = () => {
		if (closed || (socket.readyState !== undefined && socket.readyState !== OPEN_READY_STATE))
			return
		while (pending.length > 0) socket.send(pending.shift() ?? "")
	}

	const onMessage = (data: unknown) => {
		const message = JSON.parse(toText(data)) as RPCMessage
		for (const listener of listeners) listener(message)
	}

	attachMessageListener(socket, onMessage)
	attachOpenListener(socket, flush)

	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			const raw = JSON.stringify(message)
			if (socket.readyState === undefined || socket.readyState === OPEN_READY_STATE) {
				socket.send(raw)
				return
			}
			pending.push(raw)
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		close() {
			closed = true
			pending.length = 0
			socket.close()
		}
	}
}

export function webSocketClientTransport(
	options: WebSocketClientTransportOptions
): Transport<RPCMessage> {
	return webSocketTransport(new WebSocket(options.url, options.protocols))
}

function attachMessageListener(socket: WebSocketLike, listener: (data: unknown) => void): void {
	if (typeof socket.addEventListener === "function") {
		const addEventListener = socket.addEventListener as (
			event: "message",
			listener: (event: unknown) => void
		) => void
		addEventListener.call(socket, "message", (event) => listener(getEventData(event)))
		return
	}

	if (typeof socket.on === "function") {
		const on = socket.on as (event: "message", listener: (data: unknown) => void) => void
		on.call(socket, "message", listener)
		return
	}

	socket.onmessage = (event: unknown) => listener(getEventData(event))
}

function attachOpenListener(socket: WebSocketLike, listener: () => void): void {
	if (socket.readyState === undefined || socket.readyState === OPEN_READY_STATE) {
		queueMicrotask(listener)
		return
	}

	if (typeof socket.addEventListener === "function") {
		const addEventListener = socket.addEventListener as (
			event: "open",
			listener: (event: unknown) => void
		) => void
		addEventListener.call(socket, "open", listener)
		return
	}

	if (typeof socket.on === "function") {
		const on = socket.on as (event: "open", listener: () => void) => void
		on.call(socket, "open", listener)
		return
	}

	const previous = socket.onopen
	socket.onopen = (event: unknown) => {
		listener()
		if (typeof previous === "function") previous(event)
	}
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
