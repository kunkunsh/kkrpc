import type {
	IoInterface,
	IoMessage,
	IoCapabilities
} from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"

interface WebSocketClientOptions {
	url: string
	protocols?: string | string[]
}

/**
 * WebSocket Client implementation of IoInterface
 */
export class WebSocketClientIO implements IoInterface {
	name = "websocket-client-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private ws: WebSocket
	private connected: Promise<void>
	private connectResolve: (() => void) | null = null
 	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private options: WebSocketClientOptions) {
		this.ws = new WebSocket(options.url, options.protocols)
		this.connected = new Promise((resolve) => {
			this.connectResolve = resolve
		})

		this.ws.onopen = () => {
			this.connectResolve?.()
		}

		this.ws.onmessage = (event) => {
			// Convert Buffer to string if needed (for Node.js ws library)
			let message = event.data
			// if (message instanceof Buffer) {
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
			console.error("WebSocket error:", error)
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
			throw new Error("WebSocketClientIO only supports string messages")
		}
		await this.connected
		this.ws.send(message)
	}

	destroy(): void {
		// 解决 pending Promise，防止 listen loop 永久挂起
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}
		this.ws.close()
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}

/**
 * WebSocket Server implementation of IoInterface
 */
export class WebSocketServerIO implements IoInterface {
	name = "websocket-server-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
 	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private ws: WebSocket) {
		this.ws.onmessage = (event) => {
			// Convert Buffer to string if needed (for Node.js ws library)
			let message = event.data
			// if (message instanceof Buffer) {
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
			console.error("WebSocket error:", error)
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
			throw new Error("WebSocketServerIO only supports string messages")
		}
		this.ws.send(message)
	}

	destroy(): void {
		// 解决 pending Promise，防止 listen loop 永久挂起
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}
		this.ws.close()
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}
