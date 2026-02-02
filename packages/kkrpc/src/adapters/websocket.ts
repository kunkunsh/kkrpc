import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

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
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()
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
			let message = event.data
			if (typeof message === "object" && message !== null && "toString" in message) {
				message = message.toString("utf-8")
			}

			if (message === DESTROY_SIGNAL) {
				this.destroy()
				return
			}

			if (this.messageListeners.size > 0) {
				this.messageListeners.forEach((listener) => listener(message))
			} else {
				if (this.resolveRead) {
					this.resolveRead(message)
					this.resolveRead = null
				} else {
					this.messageQueue.push(message)
				}
			}
		}

		this.ws.onerror = (error) => {
			this.errorListeners.forEach((listener) => listener(new Error(String(error))))
		}
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.add(listener as (error: Error) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.delete(listener as (error: Error) => void)
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
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private errorListeners: Set<(error: Error) => void> = new Set()
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private ws: WebSocket) {
		this.ws.onmessage = (event) => {
			let message = event.data
			if (typeof message === "object" && message !== null && "toString" in message) {
				message = message.toString("utf-8")
			}

			if (message === DESTROY_SIGNAL) {
				this.destroy()
				return
			}

			if (this.messageListeners.size > 0) {
				this.messageListeners.forEach((listener) => listener(message))
			} else {
				if (this.resolveRead) {
					this.resolveRead(message)
					this.resolveRead = null
				} else {
					this.messageQueue.push(message)
				}
			}
		}

		this.ws.onerror = (error) => {
			this.errorListeners.forEach((listener) => listener(new Error(String(error))))
		}
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.add(listener as (error: Error) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			this.errorListeners.delete(listener as (error: Error) => void)
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
