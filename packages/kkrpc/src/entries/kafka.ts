/**
 * Published `kkrpc/kafka` entry for Kafka-backed transports.
 *
 * Import this entry in Node.js or compatible runtimes that have `kafkajs`
 * installed and need kkrpc over a shared Kafka topic.
 */
export {
	kafkaTransport,
	type KafkaTransport,
	type KafkaTransportOptions
} from "../transports/kafka.ts"
