import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type NatsTransport = Transport<RPCMessage>

export function createNatsTransport(): NatsTransport {
	throw new Error("not implemented in this migration slice")
}
