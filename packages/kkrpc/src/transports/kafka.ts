import type {
	Admin,
	Consumer,
	ConsumerConfig,
	KafkaConfig,
	Producer,
	ProducerConfig
} from "kafkajs"
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
}

export type KafkaTransport = Transport<RPCMessage>

export function handleKafkaBusMessage(
	raw: string,
	localPeerId: string,
	listeners: Set<(message: RPCMessage) => void>
): void {
	const envelope = parseBusEnvelope(raw)
	if (!envelope) return
	if (!shouldDeliverBusEnvelope(envelope, { localPeerId })) return
	try {
		listeners.forEach((listener) => listener(envelope.message))
	} catch (error) {
		console.error("Kafka transport delivery error:", error)
	}
}

export function kafkaTransport(options: KafkaTransportOptions): KafkaTransport {
	const topic = options.topic || "kkrpc-topic"
	const listeners = new Set<(message: RPCMessage) => void>()
	let producer: Producer | undefined
	let consumer: Consumer | undefined
	let connectionPromise: Promise<void> | undefined
	let closed = false

	async function ensureTopic(kafka: { admin(): Admin }): Promise<void> {
		let admin: Admin | undefined
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
			const { Kafka, logLevel } = await import("kafkajs")
			const kafka = new Kafka({
				clientId: options.clientId || `kkrpc-client-${options.localPeerId}`,
				brokers: options.brokers || ["localhost:9092"],
				ssl: options.ssl,
				sasl: options.sasl,
				retry: options.retry,
				logLevel: logLevel.ERROR
			})
			const nextProducer = kafka.producer(options.producerConfig)
			const nextConsumer = kafka.consumer({
				groupId: options.groupId || `kkrpc-group-${topic}-${options.localPeerId}`,
				...options.consumerConfig
			})
			await nextProducer.connect()
			await nextConsumer.connect()
			if (closed) {
				await nextConsumer.disconnect().catch(() => {})
				await nextProducer.disconnect().catch(() => {})
				return
			}
			producer = nextProducer
			consumer = nextConsumer
			await ensureTopic(kafka)
			if (closed) return
			await consumer.subscribe({ topic, fromBeginning: options.fromBeginning || false })
			if (closed) return
			await consumer.run({
				eachMessage: async ({ message }) => {
					if (closed) return
					const value = message.value?.toString("utf8")
					if (!value) return
					handleKafkaBusMessage(value, options.localPeerId, listeners)
				}
			})
		})()
		return connectionPromise
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
