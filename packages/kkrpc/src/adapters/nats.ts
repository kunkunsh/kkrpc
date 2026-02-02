import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

interface NatsIOOptions {
	/**
	 * NATS server URLs
	 */
	servers?: string | string[]
	/**
	 * Subject for all RPC traffic (default: kkrpc.messages)
	 */
	subject?: string
	/**
	 * Queue group name for load balancing (optional)
	 * If provided, all subscribers with same queue group will share messages
	 */
	queueGroup?: string
	/**
	 * Session ID for unique identification
	 */
	sessionId?: string
	/**
	 * Connection timeout in milliseconds
	 */
	timeout?: number
}

/**
 * NATS implementation of IoInterface
 *
 * Uses NATS publish/subscribe pattern with subjects for message routing.
 * All adapters share the same subject for bidirectional RPC communication.
 */
export class NatsIO implements IoInterface {
	name = "nats-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private nc: any = null
	private sub: any = null
	private subject: string
	private queueGroup: string | undefined
	private sessionId: string
	private isDestroyed: boolean = false
	private connectionPromise: Promise<void>

	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

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

	constructor(private options: NatsIOOptions = {}) {
		this.sessionId = options.sessionId || this.generateSessionId()
		this.subject = options.subject || "kkrpc.messages"
		this.queueGroup = options.queueGroup

		this.connectionPromise = this.connect()
	}

	private async connect(): Promise<void> {
		try {
			const { connect } = await import("@nats-io/transport-node")

			const servers = this.options.servers || "nats://localhost:4222"

			this.nc = await connect({
				servers: Array.isArray(servers) ? servers : [servers],
				timeout: this.options.timeout || 10000,
				reconnectTimeWait: 1000
			})

			// Create subscription
			this.sub = this.nc.subscribe(this.subject, {
				queue: this.queueGroup
			})

			// Start consuming messages
			this.startConsuming()
		} catch (error) {
			console.error("NATS connection error:", error)
			throw error
		}
	}

	private async startConsuming(): Promise<void> {
		if (this.isDestroyed || !this.sub) return

		try {
			for await (const msg of this.sub) {
				if (this.isDestroyed) break

				const content = msg.string()
				this.handleMessage(content)

				// Acknowledge the message
				msg.respond() // NATS auto-acks by default, but respond() is safe
			}
		} catch (error) {
			if (this.isDestroyed) return
			console.error("NATS consume error:", error)
		}
	}

	private handleMessage(message: string): void {
		if (this.isDestroyed) return

		if (message === "__DESTROY__") {
			this.destroy()
			return
		}

		if (this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(message))
		} else if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	private generateSessionId(): string {
		const part1 = Math.random().toString(36).substring(2, 15)
		const part2 = Math.random().toString(36).substring(2, 15)
		return (part1 + part2).padEnd(26, "0").substring(0, 26)
	}

	async read(): Promise<string | IoMessage | null> {
		await this.connectionPromise

		if (this.isDestroyed) {
			throw new Error("NATS adapter has been destroyed")
		}

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		await this.connectionPromise

		if (this.isDestroyed) {
			throw new Error("NATS adapter has been destroyed")
		}

		if (typeof message !== "string") {
			throw new Error("NatsIO only supports string messages")
		}

		if (!this.nc) {
			throw new Error("NATS connection is not initialized")
		}

		try {
			this.nc.publish(this.subject, message)
		} catch (error) {
			console.error("NATS publish error:", error)
			throw error
		}
	}

	destroy(): void {
		this.isDestroyed = true

		// Resolve pending Promise to prevent hanging
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		// Close subscription
		if (this.sub) {
			this.sub.unsubscribe()
			this.sub = null
		}

		// Close connection
		if (this.nc) {
			this.nc.close().catch(console.error)
			this.nc = null
		}
	}

	async signalDestroy(): Promise<void> {
		try {
			await this.write("__DESTROY__")
		} catch (error) {
			console.debug("NATS destroy signal failed:", error)
		}
	}

	/**
	 * Get the subject name used by this adapter
	 */
	getSubject(): string {
		return this.subject
	}

	/**
	 * Get the queue group name used by this adapter
	 */
	getQueueGroup(): string | undefined {
		return this.queueGroup
	}

	/**
	 * Get the session ID for this adapter
	 */
	getSessionId(): string {
		return this.sessionId
	}

	/**
	 * Check if connection is active
	 */
	isConnected(): boolean {
		return this.nc !== null && !this.isDestroyed
	}
}
