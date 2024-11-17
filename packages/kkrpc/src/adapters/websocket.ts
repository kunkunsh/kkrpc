import type { DestroyableIoInterface } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"

interface WebSocketClientOptions {
	url: string
	protocols?: string | string[]
}

/**
 * WebSocket Client implementation of IoInterface
 */
export class WebSocketClientIO implements DestroyableIoInterface {
	name = "websocket-client-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private ws: WebSocket
	private connected: Promise<void>
	private connectResolve: (() => void) | null = null

	constructor(private options: WebSocketClientOptions) {
		this.ws = new WebSocket(options.url, options.protocols)
		this.connected = new Promise((resolve) => {
			this.connectResolve = resolve
		})

		this.ws.onopen = () => {
			this.connectResolve?.()
		}

		this.ws.onmessage = (event) => {
			const message = event.data
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

	async write(data: string): Promise<void> {
		await this.connected
		this.ws.send(data)
	}

	destroy(): void {
		this.ws.close()
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}

/**
 * WebSocket Server implementation of IoInterface
 */
export class WebSocketServerIO implements DestroyableIoInterface {
	name = "websocket-server-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null

	constructor(private ws: WebSocket) {
		this.ws.onmessage = (event) => {
			const message = event.data
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

	async write(data: string): Promise<void> {
		this.ws.send(data)
	}

	destroy(): void {
		this.ws.close()
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}
