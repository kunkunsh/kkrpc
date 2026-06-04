import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"
const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null

export interface ElysiaSocketData {
	__kkrpc_io?: ElysiaWebSocketServerIO
	remoteAddress?: string
	query?: Record<string, string>
	headers?: Record<string, unknown>
	url?: string | URL
	originalUrl?: string | URL
}

export interface ElysiaSocketReference {
	__kkrpc_io?: ElysiaWebSocketServerIO
	data?: object
	raw?: ElysiaSocketReference | null
	remoteAddress?: string
	onerror?: ((error: unknown) => void) | null
	addEventListener?(event: "message", listener: (event: unknown) => void): void
	removeEventListener?(event: "message", listener: (event: unknown) => void): void
	on?(event: "message", listener: (event: unknown) => void): void
	off?(event: "message", listener: (event: unknown) => void): void
	onmessage?: ((event: unknown) => void) | null
}

export interface ElysiaSocket extends ElysiaSocketReference {
	send(message: string): void
	close(): void
}

function getEventData(event: unknown): unknown {
	return typeof event === "object" && event !== null && "data" in event ? event.data : event
}

function getSocketData(target: ElysiaSocketReference | null | undefined): ElysiaSocketData | undefined {
	return target?.data && typeof target.data === "object" ? (target.data as ElysiaSocketData) : undefined
}

function getKkrpcReference(target: object): { __kkrpc_io?: ElysiaWebSocketServerIO } {
	return target as { __kkrpc_io?: ElysiaWebSocketServerIO }
}

/**
 * Elysia WebSocket server adapter for kkrpc
 *
 * This adapter provides WebSocket server functionality for Elysia applications.
 * It uses Elysia's built-in WebSocket support which is powered by uWebSocket.
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 * import { ElysiaWebSocketServerIO, RPCChannel } from 'kkrpc'
 *
 * const app = new Elysia()
 *   .ws('/rpc', {
 *     open(ws) {
 *       const io = new ElysiaWebSocketServerIO(ws)
 *       const rpc = new RPCChannel(io, {
 *         expose: {
 *           greet: (name: string) => `Hello, ${name}!`
 *         }
 *       })
 *     },
 *     message(ws, message) {
 *       // Handle raw messages if needed
 *     }
 *   })
 *   .listen(3000)
 * ```
 */
export class ElysiaWebSocketServerIO implements IoInterface {
	name = "elysia-websocket-server"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private ws: ElysiaSocket
	private rawWs: ElysiaSocketReference | null
	private detachListeners: Array<() => void> = []
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	constructor(ws: ElysiaSocket) {
		this.ws = ws
		this.rawWs = ws?.raw ?? null

		this.attachAutoListener(this.rawWs ?? this.ws)
		this.storeReference(this.ws)
		if (this.rawWs && this.rawWs !== this.ws) {
			this.storeReference(this.rawWs)
		}

		const targetForError = this.rawWs ?? this.ws
		if (targetForError && typeof targetForError.onerror !== "function") {
			targetForError.onerror = (error: unknown) => {
				console.error("Elysia WebSocket error:", error)
			}
		}
	}

	private attachAutoListener(source: ElysiaSocketReference | null | undefined): void {
		if (!source || typeof source !== "object") {
			return
		}

		const handler = (event: unknown) => this.processIncoming(getEventData(event))

		if (typeof source.addEventListener === "function") {
			source.addEventListener("message", handler)
			this.detachListeners.push(() => source.removeEventListener?.("message", handler))
			return
		}

		if (typeof source.on === "function") {
			const off = source.off?.bind(source)
			source.on("message", handler)
			this.detachListeners.push(() => {
				if (off) {
					off("message", handler)
				}
			})
			return
		}

		if ("onmessage" in source) {
			const previous = source.onmessage
			const wrapped =
				typeof previous === "function"
					? (event: unknown) => {
							this.processIncoming(getEventData(event))
							previous.call(source, event)
						}
					: (event: unknown) => {
							this.processIncoming(getEventData(event))
						}

			source.onmessage = wrapped
			this.detachListeners.push(() => {
				if (source.onmessage === wrapped) {
					source.onmessage = previous ?? null
				}
			})
		}
	}

	private storeReference(target: ElysiaSocketReference | null | undefined): void {
		if (!target || typeof target !== "object") {
			return
		}

		try {
			getKkrpcReference(target).__kkrpc_io = this
		} catch {}

		const dataContainer = getSocketData(target)
		if (dataContainer && typeof dataContainer === "object") {
			dataContainer.__kkrpc_io = this
		}
	}

	private clearReference(target: ElysiaSocketReference | null | undefined): void {
		if (!target || typeof target !== "object") {
			return
		}

		const reference = getKkrpcReference(target)
		if (reference.__kkrpc_io === this) {
			delete reference.__kkrpc_io
		}

		const dataContainer = getSocketData(target)
		if (dataContainer && typeof dataContainer === "object" && dataContainer.__kkrpc_io === this) {
			delete dataContainer.__kkrpc_io
		}
	}

	private processIncoming(raw: unknown): void {
		let message: string

		if (typeof raw === "string") {
			message = raw
		} else if (raw instanceof ArrayBuffer) {
			if (textDecoder) {
				message = textDecoder.decode(new Uint8Array(raw))
			} else {
				message = Buffer.from(new Uint8Array(raw)).toString("utf-8")
			}
		} else if (ArrayBuffer.isView(raw)) {
			const view = raw as ArrayBufferView
			const uint8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
			if (textDecoder) {
				message = textDecoder.decode(uint8)
			} else {
				message = Buffer.from(uint8).toString("utf-8")
			}
		} else if (typeof raw === "object" && raw !== null) {
			try {
				message = JSON.stringify(raw)
			} catch {
				message = String(raw)
			}
		} else {
			message = String(raw)
		}

		// Check for destroy signal before appending newline
		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (!message.endsWith("\n")) {
			message += "\n"
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	handleMessage(message: unknown): void {
		this.processIncoming(message)
	}

	static feedMessage(ws: ElysiaSocketReference | null | undefined, message: unknown): void {
		const data = getSocketData(ws)
		const rawData = getSocketData(ws?.raw)
		const candidate =
			data?.__kkrpc_io ?? ws?.__kkrpc_io ?? rawData?.__kkrpc_io ?? ws?.raw?.__kkrpc_io

		if (candidate) {
			candidate.handleMessage(message)
		}
	}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("ElysiaWebSocketServerIO only supports string messages")
		}
		this.ws.send(message)
	}

	destroy(): void {
		for (const detach of this.detachListeners) {
			try {
				detach()
			} catch {}
		}
		this.detachListeners = []
		this.clearReference(this.ws)
		if (this.rawWs && this.rawWs !== this.ws) {
			this.clearReference(this.rawWs)
		}
		this.ws.close()
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}

	/**
	 * Get the remote address of the connected client
	 */
	getRemoteAddress(): string | undefined {
		try {
			const data = getSocketData(this.ws)
			const rawData = getSocketData(this.rawWs)
			const remoteAddress =
				this.ws.remoteAddress ||
				this.rawWs?.remoteAddress ||
				data?.remoteAddress ||
				data?.query?.remoteAddress ||
				rawData?.remoteAddress ||
				rawData?.query?.remoteAddress

			return remoteAddress ?? "unknown"
		} catch {
			return undefined
		}
	}

	/**
	 * Get the WebSocket URL from the request
	 */
	getUrl(): URL | undefined {
		try {
			const data = getSocketData(this.ws)
			const rawData = getSocketData(this.rawWs)
			const url =
				data?.url || data?.originalUrl || rawData?.url || rawData?.originalUrl
			return url ? new URL(url) : undefined
		} catch {
			return undefined
		}
	}

	/**
	 * Get query parameters from the WebSocket connection
	 */
	getQuery(): Record<string, string> {
		try {
			return getSocketData(this.ws)?.query || getSocketData(this.rawWs)?.query || {}
		} catch {
			return {}
		}
	}

	/**
	 * Get headers from the WebSocket upgrade request
	 */
	getHeaders(): Record<string, string> {
		try {
			const headers = getSocketData(this.ws)?.headers || getSocketData(this.rawWs)?.headers || {}
			const result: Record<string, string> = {}

			if (typeof headers === "object" && headers !== null) {
				for (const [key, value] of Object.entries(headers)) {
					result[key] = String(value)
				}
			}

			return result
		} catch {
			return {}
		}
	}
}

/**
 * Elysia WebSocket client adapter for kkrpc
 *
 * This adapter provides WebSocket client functionality for connecting to Elysia WebSocket servers.
 * It uses the standard WebSocket API to connect to Elysia WebSocket endpoints.
 *
 * @example
 * ```typescript
 * import { ElysiaWebSocketClientIO, RPCChannel } from 'kkrpc'
 *
 * const io = new ElysiaWebSocketClientIO('ws://localhost:3000/rpc')
 * const rpc = new RPCChannel(io, {
 *   expose: {
 *     getName: () => 'Client'
 *   }
 * })
 *
 * const api = rpc.getAPI<{
 *   greet: (name: string) => Promise<string>
 * }>()
 *
 * console.log(await api.greet('World')) // "Hello, World!"
 * ```
 */
export class ElysiaWebSocketClientIO implements IoInterface {
	name = "elysia-websocket-client"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private ws: WebSocket
	private connected: Promise<void>
	private connectResolve: (() => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	constructor(url: string | URL, protocols?: string | string[]) {
		// Use standard WebSocket to connect to Elysia server
		this.ws = new globalThis.WebSocket(url, protocols)

		this.connected = new Promise((resolve) => {
			this.connectResolve = resolve
		})

		this.ws.onopen = () => {
			this.connectResolve?.()
		}

		this.ws.onmessage = (event) => {
			// Convert Buffer to string if needed
			let message = event.data
			if (typeof message === "object" && message !== null && "toString" in message) {
				message = message.toString("utf-8")
			}

			if (message === DESTROY_SIGNAL) {
				this.destroy()
				return
			}

			if (this.resolveRead) {
				this.resolveRead(message)
				this.resolveRead = null
			} else {
				this.messageQueue.push(message)
			}
		}

		this.ws.onerror = (error) => {
			console.error("Elysia WebSocket client error:", error)
		}
	}

	async read(): Promise<string | null> {
		await this.connected

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("ElysiaWebSocketClientIO only supports string messages")
		}
		await this.connected
		this.ws.send(message)
	}

	destroy(): void {
		this.ws.close()
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}

/**
 * Type alias for Elysia WebSocket server adapter
 */
export type ElysiaWebSocketIO = ElysiaWebSocketServerIO

/**
 * Create a new Elysia WebSocket server IO instance
 *
 * @param ws - Elysia WebSocket instance from the ws/open callback
 * @returns A new ElysiaWebSocketServerIO instance
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 * import { createElysiaWebSocketIO } from 'kkrpc/elysia-websocket'
 *
 * new Elysia()
 *   .ws('/rpc', {
 *     open(ws) {
 *       const io = createElysiaWebSocketIO(ws)
 *       // Use io with RPCChannel...
 *     }
 *   })
 * ```
 */
export function createElysiaWebSocketIO(ws: ElysiaSocket): ElysiaWebSocketServerIO {
	return new ElysiaWebSocketServerIO(ws)
}

/**
 * Create a new Elysia WebSocket client IO instance
 *
 * @param url - WebSocket URL to connect to
 * @param protocols - Optional WebSocket subprotocols
 * @returns A new ElysiaWebSocketClientIO instance
 *
 * @example
 * ```typescript
 * import { createElysiaWebSocketClientIO } from 'kkrpc/elysia-websocket'
 *
 * const io = createElysiaWebSocketClientIO('ws://localhost:3000/rpc')
 * // Use io with RPCChannel...
 * ```
 */
export function createElysiaWebSocketClientIO(
	url: string | URL,
	protocols?: string | string[]
): ElysiaWebSocketClientIO {
	return new ElysiaWebSocketClientIO(url, protocols)
}
