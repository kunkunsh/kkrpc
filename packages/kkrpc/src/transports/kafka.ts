import type { ConsumerConfig, KafkaConfig, ProducerConfig } from "kafkajs"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, parseBusEnvelope, shouldDeliverBusEnvelope } from "./bus-envelope.ts"

export interface KafkaTransportOptions {
	brokers?: string[]
	clientId?: string
	topic?: string
	groupId?: string
	fromBeginning?: boolean
	producerConfig?: ProducerConfig
	consumerConfig?: ConsumerConfig
	ssl?: KafkaConfig["ssl"]
	sasl?: KafkaConfig["sasl"]
	retry?: KafkaConfig["retry"]
	numPartitions?: number
	replicationFactor?: number
	localPeerId: string
	remotePeerId?: string
	/** @internal Test seam for setup-race coverage. */
	__client?: KafkaClientLike
}

export type KafkaTransport = Transport<RPCMessage>

interface KafkaProducerLike {
	connect(): Promise<void>
	disconnect(): Promise<void>
	send(record: { topic: string; messages: Array<{ value: string }> }): Promise<unknown>
}

interface KafkaMessageLike {
	value?: { toString(encoding?: BufferEncoding): string } | null
}

interface KafkaConsumerLike {
	connect(): Promise<void>
	disconnect(): Promise<void>
	subscribe(options: { topic: string; fromBeginning: boolean }): Promise<void>
	run(options: {
		eachMessage(args: { message: KafkaMessageLike }): Promise<void> | void
	}): Promise<void>
}

interface KafkaAdminLike {
	connect(): Promise<void>
	disconnect(): Promise<void>
	listTopics(): Promise<string[]>
	createTopics(options: {
		topics: Array<{ topic: string; numPartitions: number; replicationFactor: number }>
		waitForLeaders: boolean
	}): Promise<unknown>
}

interface KafkaClientLike {
	producer(config?: ProducerConfig): KafkaProducerLike
	consumer(config: ConsumerConfig): KafkaConsumerLike
	admin(): KafkaAdminLike
}

export function handleKafkaBusMessage(
	raw: string,
	localPeerId: string,
	listeners: Set<(message: RPCMessage) => void>
): void {
	const envelope = parseBusEnvelope(raw)
	if (!envelope) return
	if (!shouldDeliverBusEnvelope(envelope, { localPeerId })) return
	listeners.forEach((listener) => listener(envelope.message))
}

export function kafkaTransport(options: KafkaTransportOptions): KafkaTransport {
	const topic = options.topic || "kkrpc-topic"
	const listeners = new Set<(message: RPCMessage) => void>()
	let producer: KafkaProducerLike | undefined
	let consumer: KafkaConsumerLike | undefined
	let connectionPromise: Promise<void> | undefined
	let closed = false

	async function ensureTopic(kafka: KafkaClientLike): Promise<void> {
		let admin: KafkaAdminLike | undefined
		try {
			admin = kafka.admin()
			await admin.connect()
			const topics = await admin.listTopics()
			if (!topics.includes(topic)) {
				await admin.createTopics({
					topics: [
						{
							topic,
							numPartitions: options.numPartitions || 3,
							replicationFactor: options.replicationFactor || 1
						}
					],
					waitForLeaders: true
				})
			}
		} catch (error) {
			if (
				!(error instanceof Error && error.message.includes("Topic with this name already exists"))
			) {
				throw error
			}
		} finally {
			if (admin) await admin.disconnect()
		}
	}

	async function connect(): Promise<void> {
		if (connectionPromise) return connectionPromise
		connectionPromise = (async () => {
			const kafka = options.__client ?? (await createKafkaClient())
			const nextProducer = kafka.producer(options.producerConfig)
			producer = nextProducer

			const cleanup = async () => {
				await consumer?.disconnect().catch(() => {})
				await nextProducer.disconnect().catch(() => {})
				if (producer === nextProducer) producer = undefined
				consumer = undefined
			}

			try {
				if (closed) {
					await cleanup()
					return
				}
				await nextProducer.connect()
				if (closed) {
					await cleanup()
					return
				}

				const nextConsumer = kafka.consumer({
					groupId: options.groupId || `kkrpc-group-${topic}-${options.localPeerId}`,
					...options.consumerConfig
				})
				consumer = nextConsumer
				if (closed) {
					await cleanup()
					return
				}
				await nextConsumer.connect()
				if (closed) {
					await cleanup()
					return
				}

				await ensureTopic(kafka)
				if (closed) {
					await cleanup()
					return
				}
				await nextConsumer.subscribe({ topic, fromBeginning: options.fromBeginning || false })
				if (closed) {
					await cleanup()
					return
				}
				await nextConsumer.run({
					eachMessage: async ({ message }) => {
						if (closed) return
						const value = message.value?.toString("utf8")
						if (!value) return
						handleKafkaBusMessage(value, options.localPeerId, listeners)
					}
				})
			} catch (error) {
				await cleanup()
				throw error
			}
		})()
		return connectionPromise
	}

	async function createKafkaClient(): Promise<KafkaClientLike> {
		const { Kafka, logLevel } = await import("kafkajs")
		return new Kafka({
			clientId: options.clientId || `kkrpc-client-${options.localPeerId}`,
			brokers: options.brokers || ["localhost:9092"],
			ssl: options.ssl,
			sasl: options.sasl,
			retry: options.retry,
			logLevel: logLevel.ERROR
		}) as KafkaClientLike
	}

	return {
		capabilities: {
			objectMode: true,
			transfer: false,
			broadcast: options.remotePeerId === undefined
		},
		async send(message) {
			if (closed) throw new Error("Kafka transport has been closed")
			await connect()
			if (!producer) throw new Error("Kafka producer is not initialized")
			const envelope = createBusEnvelope(message, {
				transportId: "kafka",
				from: options.localPeerId,
				to: options.remotePeerId
			})
			await producer.send({ topic, messages: [{ value: JSON.stringify(envelope) }] })
		},
		subscribe(listener) {
			listeners.add(listener)
			void connect()
			return () => listeners.delete(listener)
		},
		close() {
			closed = true
			listeners.clear()
			if (consumer) void consumer.disconnect().catch(() => {})
			if (producer) void producer.disconnect().catch(() => {})
			consumer = undefined
			producer = undefined
		}
	}
}
