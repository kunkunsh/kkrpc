import * as amqplib from "amqplib"
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib"
import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

interface RabbitMQOptions {
	url?: string
	exchange?: string
	exchangeType?: "topic" | "direct" | "fanout"
	durable?: boolean
	sessionId?: string
	routingKeyPrefix?: string
}

/**
 * RabbitMQ implementation of IoInterface
 * Uses topic exchange with routing keys to separate kkrpc traffic from other consumers
 */
export class RabbitMQIO implements IoInterface {
	name = "rabbitmq-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private connection: ChannelModel | null = null
	private channel: Channel | null = null
	private inboundQueue: string = ""
	private sharedRoutingKey: string
	private sessionId: string
	private exchange: string
	private routingKeyPrefix: string
	private isDestroyed: boolean = false
	private connectionPromise: Promise<void>

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

	constructor(private options: RabbitMQOptions = {}) {
		this.sessionId = options.sessionId || this.generateSessionId()
		this.exchange = options.exchange || "kkrpc-exchange"
		this.routingKeyPrefix = options.routingKeyPrefix || "kkrpc"
		this.sharedRoutingKey = `${this.routingKeyPrefix}.messages`

		// Initialize connection promise
		this.connectionPromise = this.connect()
	}

	private async connect(): Promise<void> {
		try {
			// Dynamic import to avoid dependency issues for non-RabbitMQ users
			const amqplib = await import("amqplib")

			const url = this.options.url || "amqp://localhost"
			this.connection = await amqplib.connect(url)
			this.channel = await this.connection.createChannel()

			// Assert exchange
			const exchangeType = this.options.exchangeType || "topic"
			const durable = this.options.durable !== false // default to true
			if (!this.channel) {
				throw new Error("Failed to create RabbitMQ channel")
			}
			await this.channel.assertExchange(this.exchange, exchangeType, { durable })

			// Create unique inbound queue for this session
			this.inboundQueue = `kkrpc-inbound-${this.sessionId}`

			// Assert inbound queue
			await this.channel.assertQueue(this.inboundQueue, {
				durable,
				exclusive: true,
				autoDelete: true
			})

			// Bind inbound queue to receive all messages on the shared routing key
			await this.channel.bindQueue(this.inboundQueue, this.exchange, this.sharedRoutingKey)

			// Set up consumer for inbound queue
			await this.channel.consume(this.inboundQueue, (msg: ConsumeMessage | null) => {
				if (this.isDestroyed) return

				if (msg !== null) {
					const content = msg.content.toString("utf8")
					this.handleMessage(content)
					// We've already checked that msg is not null
					this.channel!.ack(msg)
				}
			})
		} catch (error) {
			console.error("RabbitMQ connection error:", error)
			throw error
		}
	}

	private handleMessage(message: string): void {
		if (this.isDestroyed) return

		if (message === "__DESTROY__") {
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

	private generateSessionId(): string {
		// Generate exactly 26 characters
		const part1 = Math.random().toString(36).substring(2, 15)
		const part2 = Math.random().toString(36).substring(2, 15)
		return (part1 + part2).padEnd(26, "0").substring(0, 26)
	}

	async read(): Promise<string | null> {
		await this.connectionPromise

		if (this.isDestroyed) {
			// Return a special value that RPCChannel will treat as termination
			throw new Error("RabbitMQ adapter has been destroyed")
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
			throw new Error("RabbitMQ adapter has been destroyed")
		}

		if (typeof message !== "string") {
			throw new Error("RabbitMQIO only supports string messages")
		}

		try {
			// Publish to shared routing key so all adapters can receive the message
			if (!this.channel) {
				throw new Error("RabbitMQ channel is not initialized")
			}

			this.channel.publish(this.exchange, this.sharedRoutingKey, Buffer.from(message), {
				persistent: this.options.durable !== false
			})
		} catch (error) {
			console.error("RabbitMQ publish error:", error)
			throw error
		}
	}

	destroy(): void {
		this.isDestroyed = true

		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		// Close channel and connection
		if (this.channel) {
			this.channel.close().catch(console.error)
			this.channel = null
		}

		if (this.connection) {
			this.connection.close().catch(console.error)
			this.connection = null
		}
	}

	async signalDestroy(): Promise<void> {
		try {
			await this.write("__DESTROY__")
		} catch (error) {
			// Ignore errors during destroy signaling
			console.debug("Error sending destroy signal:", error)
		}
	}

	/**
	 * Get the routing keys used by this adapter
	 */
	getRoutingKeys(): { inbound: string; outbound: string } {
		return {
			inbound: this.sharedRoutingKey,
			outbound: this.sharedRoutingKey
		}
	}

	/**
	 * Get the session ID for this adapter
	 */
	getSessionId(): string {
		return this.sessionId
	}

	/**
	 * Get the exchange name used by this adapter
	 */
	getExchange(): string {
		return this.exchange
	}
}
