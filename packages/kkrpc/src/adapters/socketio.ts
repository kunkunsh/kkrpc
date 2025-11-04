import { io } from "socket.io-client"
import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"

interface SocketIOClientOptions {
	url: string
	namespace?: string
	opts?: any // Socket.IO options
}

/**
 * Socket.IO Client implementation of IoInterface
 */
export class SocketIOClientIO implements IoInterface {
	name = "socketio-client-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private socket: any // Socket.IO client socket
	private connected: Promise<void>
	private connectResolve: (() => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private options: SocketIOClientOptions) {
		const url = this.options.namespace
			? `${this.options.url}/${this.options.namespace}`
			: this.options.url

		this.socket = io(url, this.options.opts)
		this.connected = new Promise((resolve) => {
			this.connectResolve = resolve
		})

		this.socket.on("connect", () => {
			this.connectResolve?.()
		})

		this.socket.on("message", (message: string) => {
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
		})

		this.socket.on("disconnect", () => {
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		})

		this.socket.on("error", (error: any) => {
			console.error("Socket.IO error:", error)
		})
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
			throw new Error("SocketIOClientIO only supports string messages")
		}
		await this.connected
		this.socket.emit("message", message)
	}

	destroy(): void {
		if (this.socket) {
			this.socket.disconnect()
		}
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}

/**
 * Socket.IO Server implementation of IoInterface
 */
export class SocketIOServerIO implements IoInterface {
	name = "socketio-server-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private socket: any // Socket.IO server socket
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(socket: any) {
		this.socket = socket

		this.socket.on("message", (message: string) => {
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
		})

		this.socket.on("disconnect", () => {
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		})

		this.socket.on("error", (error: any) => {
			console.error("Socket.IO error:", error)
		})
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
			throw new Error("SocketIOServerIO only supports string messages")
		}
		this.socket.emit("message", message)
	}

	destroy(): void {
		if (this.socket) {
			this.socket.disconnect()
		}
	}

	signalDestroy(): void {
		this.write(DESTROY_SIGNAL)
	}
}
