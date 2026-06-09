import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type RabbitMQTransport = Transport<RPCMessage>

export function createRabbitMQTransport(): RabbitMQTransport {
	throw new Error("not implemented in this migration slice")
}
