import IORedis from "ioredis"
import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"

interface RedisStreamsOptions {
	url?: string
	stream?: string
	consumerGroup?: string
	consumerName?: string
	blockTimeout?: number
	maxLen?: number
	sessionId?: string
	/**
	 * 最大队列大小，防止消息积压导致内存问题
	 * 默认 1000 条消息
	 */
	maxQueueSize?: number
	/**
	 * 使用 consumer group 模式 (XREADGROUP) 而非简单的 pub/sub (XREAD)
	 * - false (默认): pub/sub 模式，所有 consumer 都能收到所有消息
	 * - true: 负载均衡模式，每条消息只会被一个 consumer 处理
	 */
	useConsumerGroup?: boolean
}

/**
 * Redis Streams implementation of IoInterface
 *
 * 支持两种消息消费模式:
 * 1. Pub/Sub 模式 (默认): 使用 XREAD，所有 consumer 都能收到所有消息
 * 2. Consumer Group 模式: 使用 XREADGROUP，每条消息只被一个 consumer 处理 (负载均衡)
 *
 * 内存管理:
 * - 支持最大队列大小限制 (maxQueueSize)，防止消息积压导致内存问题
 * - 队列满时自动丢弃最老的消息并记录警告
 *
 * 配置验证:
 * - 构造时验证所有配置选项的类型和范围
 * - 无效配置会立即抛出异常
 */
export class RedisStreamsIO implements IoInterface {
	name = "redis-streams-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private publisher: any = null
	private subscriber: any = null
	private stream: string
	private consumerGroup: string
	private consumerName: string
	private blockTimeout: number
	private maxLen: number | null
	private sessionId: string
	private isDestroyed: boolean = false
	private connectionPromise: Promise<void>
	private isListening: boolean = false
	private lastId: string = "$"
	private maxQueueSize: number
	private useConsumerGroup: boolean

	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private options: RedisStreamsOptions = {}) {
		// 配置验证
		this.validateOptions(options)

		this.sessionId = options.sessionId || this.generateSessionId()
		this.stream = options.stream || "kkrpc-stream"
		this.consumerGroup = options.consumerGroup || "kkrpc-group"
		this.consumerName = options.consumerName || `consumer-${this.sessionId}`
		this.blockTimeout = options.blockTimeout || 5000
		this.maxLen = options.maxLen || null
		this.maxQueueSize = options.maxQueueSize || 1000
		this.useConsumerGroup = options.useConsumerGroup || false

		// Initialize connection promise
		this.connectionPromise = this.connect()
	}

	private validateOptions(options: RedisStreamsOptions): void {
		if (
			options.blockTimeout !== undefined &&
			(options.blockTimeout < 0 || !Number.isInteger(options.blockTimeout))
		) {
			throw new Error("blockTimeout must be a non-negative integer")
		}

		if (
			options.maxLen !== undefined &&
			(options.maxLen <= 0 || !Number.isInteger(options.maxLen))
		) {
			throw new Error("maxLen must be a positive integer")
		}

		if (
			options.maxQueueSize !== undefined &&
			(options.maxQueueSize <= 0 || !Number.isInteger(options.maxQueueSize))
		) {
			throw new Error("maxQueueSize must be a positive integer")
		}

		if (options.url !== undefined && typeof options.url !== "string") {
			throw new Error("url must be a string")
		}

		if (options.stream !== undefined && typeof options.stream !== "string") {
			throw new Error("stream must be a string")
		}

		if (options.consumerGroup !== undefined && typeof options.consumerGroup !== "string") {
			throw new Error("consumerGroup must be a string")
		}

		if (options.consumerName !== undefined && typeof options.consumerName !== "string") {
			throw new Error("consumerName must be a string")
		}
	}

	private async connect(): Promise<void> {
		try {
			// Dynamic import to avoid dependency issues for non-Redis users
			const { default: IORedis } = await import("ioredis")

			const url = this.options.url || "redis://localhost:6379"

			// Create separate connections for publishing and subscribing
			this.publisher = new IORedis(url)
			this.subscriber = new IORedis(url)

			// Set up error handling
			this.publisher.on("error", (error: Error) => {
				console.error("Redis publisher error:", error)
			})

			this.subscriber.on("error", (error: Error) => {
				console.error("Redis subscriber error:", error)
			})

			// Test connections
			await this.publisher.ping()
			await this.subscriber.ping()

			// Create consumer group if using consumer group mode
			if (this.useConsumerGroup) {
				try {
					await this.subscriber.xgroup("CREATE", this.stream, this.consumerGroup, "0", "MKSTREAM")
				} catch (error: any) {
					// Ignore error if group already exists
					if (!error.message.includes("BUSYGROUP")) {
						throw error
					}
				}
			}

			// Start listening for messages
			this.startListening()
		} catch (error) {
			console.error("Redis Streams connection error:", error)
			throw error
		}
	}

	private async startListening(): Promise<void> {
		if (this.isDestroyed || this.isListening) return

		this.isListening = true
		this.listenForMessages()
	}

	private async listenForMessages(): Promise<void> {
		while (!this.isDestroyed && this.isListening) {
			try {
				if (this.useConsumerGroup) {
					// Use XREADGROUP for load balancing (每条消息只被一个 consumer 处理)
					const results = await this.subscriber.xreadgroup(
						"GROUP",
						this.consumerGroup,
						this.consumerName,
						"BLOCK",
						this.blockTimeout,
						"STREAMS",
						this.stream,
						">"
					)

					if (results && results.length > 0) {
						const [, messages] = results[0]

						for (const [messageId, fields] of messages) {
							// Extract message data from fields array
							let messageData = ""
							for (let i = 0; i < fields.length; i += 2) {
								if (fields[i] === "data") {
									messageData = fields[i + 1]
									break
								}
							}

							if (messageData) {
								this.handleMessage(messageData)

								// Acknowledge the message (XACK)
								if (this.subscriber && !this.isDestroyed) {
									try {
										await this.subscriber.xack(this.stream, this.consumerGroup, messageId)
									} catch (ackError) {
										console.error("Error acknowledging message:", ackError)
									}
								}
							}
						}
					}
				} else {
					// Use simple XREAD to read all messages from the stream
					// This ensures all adapters receive all messages (pub/sub pattern)
					const results = await this.subscriber.xread(
						"BLOCK",
						this.blockTimeout,
						"STREAMS",
						this.stream,
						this.lastId
					)

					if (results && results.length > 0) {
						const [, messages] = results[0]

						for (const [messageId, fields] of messages) {
							// Extract message data from fields array
							let messageData = ""
							for (let i = 0; i < fields.length; i += 2) {
								if (fields[i] === "data") {
									messageData = fields[i + 1]
									break
								}
							}

							if (messageData) {
								// 记录 lastId，避免 race condition 丢消息
								this.lastId = messageId
								this.handleMessage(messageData)
							}
						}
					}
				}
			} catch (error) {
				if (this.isDestroyed) break
				console.error("Error reading from Redis Streams:", error)
				// Wait a bit before retrying
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
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
			// 检查队列大小，防止内存溢出
			if (this.messageQueue.length >= this.maxQueueSize) {
				console.warn(
					`Message queue full (${this.maxQueueSize} messages), dropping oldest message. ` +
						`Consider increasing maxQueueSize or processing messages faster.`
				)
				this.messageQueue.shift() // 丢弃最老的消息
			}
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
			throw new Error("Redis Streams adapter has been destroyed")
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
			throw new Error("Redis Streams adapter has been destroyed")
		}

		if (typeof message !== "string") {
			throw new Error("RedisStreamsIO only supports string messages")
		}

		try {
			// Use XADD to add message to stream
			if (this.maxLen) {
				// With MAXLEN, we need to use a different format
				await this.publisher.xadd(
					this.stream,
					"*",
					"MAXLEN",
					"~",
					this.maxLen.toString(),
					"data",
					message
				)
			} else {
				// Simple XADD without length limit
				await this.publisher.xadd(this.stream, "*", "data", message)
			}
		} catch (error) {
			console.error("Redis Streams publish error:", error)
			throw error
		}
	}

	destroy(): void {
		this.isDestroyed = true
		this.isListening = false

		// 解决 pending Promise，防止 listen loop 永久挂起
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		// Close Redis connections
		if (this.publisher) {
			this.publisher.quit().catch(console.error)
			this.publisher = null
		}

		if (this.subscriber) {
			this.subscriber.quit().catch(console.error)
			this.subscriber = null
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
	 * Get the stream name used by this adapter
	 */
	getStream(): string {
		return this.stream
	}

	/**
	 * Get the consumer group name used by this adapter
	 */
	getConsumerGroup(): string {
		return this.consumerGroup
	}

	/**
	 * Get the consumer name used by this adapter
	 */
	getConsumerName(): string {
		return this.consumerName
	}

	/**
	 * Get the session ID for this adapter
	 */
	getSessionId(): string {
		return this.sessionId
	}

	/**
	 * Get stream information (length, groups, etc.)
	 */
	async getStreamInfo(): Promise<{
		length: number
		groups: number
		lastEntry: string | null
	}> {
		await this.connectionPromise

		if (!this.publisher) {
			throw new Error("Redis connection not established")
		}

		try {
			const info = await this.publisher.xinfo("stream", this.stream)

			// Parse the info correctly - Redis returns an array of key-value pairs
			let length = 0
			let groups = 0
			let lastEntry = null

			if (Array.isArray(info)) {
				for (let i = 0; i < info.length; i += 2) {
					const key = info[i]
					const value = info[i + 1]

					switch (key) {
						case "length":
							length = parseInt(value) || 0
							break
						case "groups":
							groups = parseInt(value) || 0
							break
						case "last-generated-id":
							lastEntry = value
							break
					}
				}
			} else if (typeof info === "object") {
				// Handle object format if Redis returns it that way
				length = parseInt(info.length) || 0
				groups = parseInt(info.groups) || 0
				lastEntry = info["last-generated-id"] || null
			}

			return { length, groups, lastEntry }
		} catch (error) {
			console.error("Error getting stream info:", error)
			return {
				length: 0,
				groups: 0,
				lastEntry: null
			}
		}
	}

	/**
	 * Trim the stream to keep only the last N entries
	 */
	async trimStream(maxLen: number): Promise<void> {
		await this.connectionPromise

		if (!this.publisher) {
			throw new Error("Redis connection not established")
		}

		try {
			await this.publisher.xtrim(this.stream, "MAXLEN", "~", maxLen)
		} catch (error) {
			console.error("Error trimming stream:", error)
			throw error
		}
	}

	/**
	 * Get all entries in the stream (for debugging purposes)
	 */
	async getAllEntries(): Promise<Array<[string, string[]]>> {
		await this.connectionPromise

		if (!this.publisher) {
			throw new Error("Redis connection not established")
		}

		try {
			return await this.publisher.xrange(this.stream, "-", "+")
		} catch (error) {
			console.error("Error getting stream entries:", error)
			return []
		}
	}
}
