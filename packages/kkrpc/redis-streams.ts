import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type RedisStreamsTransport = Transport<RPCMessage>

export function createRedisStreamsTransport(): RedisStreamsTransport {
	throw new Error("not implemented in this migration slice")
}
