import type {
	IoCapabilities,
	IoInterface,
	IoMessage
} from "../interface.ts"
import {
	type Admin,
	type Consumer,
	type ConsumerConfig,
	type Kafka as KafkaClient,
	type KafkaConfig,
	type Producer,
	type ProducerConfig
} from "kafkajs"

interface KafkaAdapterOptions {
	/**
	 * Kafka broker addresses
	 */
	brokers?: string[]
	/**
	 * Client identifier, 默认自动拼 session
	 */
	clientId?: string
	/**
	 * Topic name for all RPC traffic
	 */
	topic?: string
	/**
	 * Optional custom group id. 默认每个 session 一个 group，确保广播 fan-out
	 */
	groupId?: string
	/**
	 * When true, consumer will read from beginning
	 */
	fromBeginning?: boolean
	/**
	 * Custom producer configuration
	 */
	producerConfig?: ProducerConfig
	/**
	 * Custom consumer configuration
	 */
	consumerConfig?: ConsumerConfig
	/**
	 * Kafka ssl config passthrough
	 */
	ssl?: KafkaConfig["ssl"]
	/**
	 * Kafka sasl config passthrough
	 */
	sasl?: KafkaConfig["sasl"]
	/**
	 * Number of partitions when auto-creating topic
	 */
	numPartitions?: number
	/**
	 * Replication factor when auto-creating topic
	 */
	replicationFactor?: number
	/**
	 * 限制消息队列大小，防止积压
	 */
	maxQueueSize?: number
	/**
	 * Override session id
	 */
	sessionId?: string
	/**
	 * Optional retry config for Kafka client
	 */
	retry?: KafkaConfig["retry"]
}

/**
 * Kafka implementation of IoInterface
 *
 * - 使用 Kafka topic 作为广播通道，默认每个 session 独立 consumer group
 * - 只支持 string payload，保持和核心 channel 序列化逻辑一致
 */
export class KafkaIO implements IoInterface {
	name = "kafka-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private producer: Producer | null = null
	private consumer: Consumer | null = null
	private kafka: KafkaClient | null = null
	private topic: string
	private groupId: string
	private sessionId: string
	private isDestroyed = false
	private connectionPromise: Promise<void>
	private consumerRunPromise: Promise<void> | null = null
	private maxQueueSize: number

	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private options: KafkaAdapterOptions = {}) {
		this.sessionId = options.sessionId || this.generateSessionId()
		this.topic = options.topic || "kkrpc-topic"
		this.groupId = options.groupId || `kkrpc-group-${this.sessionId}`
		this.maxQueueSize = options.maxQueueSize || 1000

		this.connectionPromise = this.connect()
	}

	private async connect(): Promise<void> {
		try {
			const { Kafka, logLevel } = await import("kafkajs")

			const kafkaConfig: KafkaConfig = {
				clientId: this.options.clientId || `kkrpc-client-${this.sessionId}`,
				brokers: this.options.brokers || ["localhost:9092"],
				ssl: this.options.ssl,
				sasl: this.options.sasl,
				retry: this.options.retry,
				logLevel: logLevel.ERROR
			}

			this.kafka = new Kafka(kafkaConfig)
			this.producer = this.kafka.producer(this.options.producerConfig)
			this.consumer = this.kafka.consumer({
				groupId: this.groupId,
				...this.options.consumerConfig
			})

			await this.producer.connect()
			await this.consumer.connect()
			await this.ensureTopicExists()

			await this.consumer.subscribe({
				topic: this.topic,
				fromBeginning: this.options.fromBeginning || false
			})

			this.consumerRunPromise = this.consumer.run({
				eachMessage: async ({ message }) => {
					if (this.isDestroyed) return

					const value = message.value?.toString("utf8")
					if (!value) return

					this.handleMessage(value)
				}
			})
		} catch (error) {
			console.error("Kafka connection error:", error)
			throw error
		}
	}

	private async ensureTopicExists(): Promise<void> {
		if (!this.kafka) return

		let admin: Admin | null = null
		try {
			admin = this.kafka.admin()
			await admin.connect()

			const topics = await admin.listTopics()
			if (!topics.includes(this.topic)) {
				await admin.createTopics({
					topics: [
						{
							topic: this.topic,
							numPartitions: this.options.numPartitions || 3,
							replicationFactor: this.options.replicationFactor || 1
						}
					],
					waitForLeaders: true
				})
			}
		} catch (error: any) {
			if (error?.message?.includes("Topic with this name already exists")) {
				return
			}
			console.error("Kafka ensureTopic error:", error)
			throw error
		} finally {
			if (admin) {
				admin.disconnect().catch(console.error)
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
			return
		}

		if (this.messageQueue.length >= this.maxQueueSize) {
			console.warn(
				`KafkaIO queue full (${this.maxQueueSize} messages), dropping oldest message to protect memory.`
			)
			this.messageQueue.shift()
		}

		this.messageQueue.push(message)
	}

	private generateSessionId(): string {
		const part1 = Math.random().toString(36).substring(2, 15)
		const part2 = Math.random().toString(36).substring(2, 15)
		return (part1 + part2).padEnd(26, "0").substring(0, 26)
	}

	async read(): Promise<string | IoMessage | null> {
		await this.connectionPromise

		if (this.isDestroyed) {
			throw new Error("Kafka adapter has been destroyed")
		}

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise(resolve => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		await this.connectionPromise

		if (this.isDestroyed) {
			throw new Error("Kafka adapter has been destroyed")
		}

		if (typeof message !== "string") {
			throw new Error("KafkaIO only supports string messages")
		}

		if (!this.producer) {
			throw new Error("Kafka producer is not initialized")
		}

		try {
			await this.producer.send({
				topic: this.topic,
				messages: [{ value: message }]
			})
		} catch (error) {
			console.error("Kafka publish error:", error)
			throw error
		}
	}

	destroy(): void {
		this.isDestroyed = true

		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		if (this.consumerRunPromise) {
			this.consumer
				?.stop()
				.catch(console.error)
		}

		if (this.consumer) {
			this.consumer.disconnect().catch(console.error)
			this.consumer = null
		}

		if (this.producer) {
			this.producer.disconnect().catch(console.error)
			this.producer = null
		}
	}

	async signalDestroy(): Promise<void> {
		try {
			await this.write("__DESTROY__")
		} catch (error) {
			console.debug("Kafka destroy signal failed:", error)
		}
	}

	getTopic(): string {
		return this.topic
	}

	getGroupId(): string {
		return this.groupId
	}

	getSessionId(): string {
		return this.sessionId
	}
}
