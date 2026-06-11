/**
 * Published `kkrpc/nats` entry for NATS-backed transports.
 *
 * Import this entry in Node.js or compatible runtimes that have the NATS client
 * installed and need kkrpc over a shared subject.
 * @module
 */
export {
	natsTransport,
	type NatsConnectionLike,
	type NatsMessageLike,
	type NatsSubscriptionLike,
	type NatsTransport,
	type NatsTransportOptions
} from "../transports/nats.ts"
