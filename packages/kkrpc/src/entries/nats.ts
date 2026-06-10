/**
 * Published `kkrpc/nats` entry for NATS-backed transports.
 *
 * Import this entry in Node.js or compatible runtimes that have the NATS client
 * installed and need kkrpc over a shared subject.
 */
export {
	natsTransport,
	type NatsTransport,
	type NatsTransportOptions
} from "../transports/nats.ts"
