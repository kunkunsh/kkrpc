import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type SocketTransport = Transport<RPCMessage>

export function createSocketTransport(): SocketTransport {
	throw new Error("not implemented in this migration slice")
}
