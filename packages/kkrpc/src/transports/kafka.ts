/**
 * Kafka topic transport for stable kkrpc.
 *
 * Kafka is a broadcast-capable message bus, so this transport wraps RPC messages
 * in bus envelopes and filters self-delivery or messages targeted at other
 * peers. It supports callback arguments through normal RPC messages, but Kafka
 * payloads do not carry transferables.
 */

import type { ConsumerConfig, KafkaConfig, ProducerConfig } from "kafkajs"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"
import { createBusEnvelope, parseBusEnvelope, shouldDeliverBusEnvelope } from "./bus-envelope.ts"

/** Options for connecting a kkrpc transport to a Kafka topic. */
export interface KafkaTransportOptions {
	/** Kafka broker addresses passed to the KafkaJS client. */
	brokers?: string[]
	/** KafkaJS client id. Defaults to a kkrpc id derived from `localPeerId`. */
	clientId?: string
	/** Topic used to exchange kkrpc bus envelopes. */
	topic?: string
	/** Consumer group id used by the receiving side. */
	groupId?: string
	/** Whether the consumer should read from the beginning when subscribing. */
	fromBeginning?: boolean
	/** Extra KafkaJS producer options. */
	producerConfig?: Record<string, unknown>
	/** Extra KafkaJS consumer options. */
	consumerConfig?: Record<string, unknown>
	/** KafkaJS SSL configuration. */
	ssl?: boolean | Record<string, unknown>
	/** KafkaJS SASL authentication configuration. */
	sasl?: Record<string, unknown>
	/** KafkaJS retry configuration. */
	retry?: Record<string, unknown>
	/** Number of partitions to request when creating the topic. */
	numPartitions?: number
	/** Replication factor to request when creating the topic. */
	replicationFactor?: number
	/** Stable id for this endpoint; used to filter self-delivered messages. */
	localPeerId: string
	/** Optional target endpoint id for point-to-point delivery. */
	remotePeerId?: string
	/** Optional Kafka client factory override used by tests and custom integrations. */
	__client?: KafkaClientLike
}

/** Message-level Kafka transport type. */
export type KafkaTransport = Transport<RPCMessage>

/** Minimal producer shape used by the Kafka transport. */
export interface KafkaProducerLike {
	/** Connect the producer before publishing records. */
	connect(): Promise<void>
	/** Disconnect the producer and release network resources. */
	disconnect(): Promise<void>
	/** Send one or more records to a Kafka topic. */
	send(record: { topic: string; messages: Array<{ value: string }> }): Promise<unknown>
}

/** Minimal Kafka message shape consumed by the transport. */
export interface KafkaMessageLike {
	/** Encoded message payload. */
	value?: { toString(encoding?: BufferEncoding): string } | null
}

/** Minimal consumer shape used by the Kafka transport. */
export interface KafkaConsumerLike {
	/** Connect the consumer before subscribing. */
	connect(): Promise<void>
	/** Disconnect the consumer and release network resources. */
	disconnect(): Promise<void>
	/** Subscribe the consumer to one topic. */
	subscribe(options: { topic: string; fromBeginning: boolean }): Promise<void>
	/** Start consuming messages from the subscription. */
	run(options: {
		eachMessage(args: { message: KafkaMessageLike }): Promise<void> | void
	}): Promise<void>
}

/** Minimal admin shape used to ensure the Kafka topic exists. */
export interface KafkaAdminLike {
	/** Connect the admin client before topic operations. */
	connect(): Promise<void>
	/** Disconnect the admin client. */
	disconnect(): Promise<void>
	/** List existing topic names. */
	listTopics(): Promise<string[]>
	/** Create topics when they do not already exist. */
	createTopics(options: {
		topics: Array<{ topic: string; numPartitions: number; replicationFactor: number }>
		waitForLeaders: boolean
	}): Promise<unknown>
}

/** Minimal Kafka client factory shape accepted by the transport. */
export interface KafkaClientLike {
	/** Create a producer instance. */
	producer(config?: unknown): KafkaProducerLike
	/** Create a consumer instance. */
	consumer(config: unknown): KafkaConsumerLike
	/** Create an admin client instance. */
	admin(): KafkaAdminLike
}

/** Parse, filter, and deliver one Kafka bus envelope payload. */
export function handleKafkaBusMessage(
	raw: string,
	localPeerId: string,
	listeners: Set<(message: RPCMessage) => void>
): void {
	const envelope = parseBusEnvelope(raw)
	if (!envelope) return
	// Ignore self-delivered records and records explicitly addressed to another peer.
	if (!shouldDeliverBusEnvelope(envelope, { localPeerId })) return
	listeners.forEach((listener) => listener(envelope.message))
}

/**
 * Create a Kafka-backed kkrpc transport.
 *
 * The transport lazily connects producer and consumer resources on first send or
 * subscription, ensures the topic exists, and disconnects best-effort on close.
 * It is bidirectional through the shared topic, callback-capable, and marks
 * itself as broadcast when no `remotePeerId` target is configured.
 */
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
			const nextProducer = kafka.producer(options.producerConfig as ProducerConfig | undefined)
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
				} as ConsumerConfig)
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
			ssl: options.ssl as KafkaConfig["ssl"],
			sasl: options.sasl as KafkaConfig["sasl"],
			retry: options.retry as KafkaConfig["retry"],
			logLevel: logLevel.ERROR
		}) as unknown as KafkaClientLike
	}

	return {
		capabilities: {
			objectMode: true,
			transfer: false,
			remoteRefs: true,
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
