import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type KafkaTransport = Transport<RPCMessage>

export function createKafkaTransport(): KafkaTransport {
	throw new Error("not implemented in this migration slice")
}
