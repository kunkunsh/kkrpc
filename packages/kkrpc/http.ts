import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type HttpTransport = Transport<RPCMessage>

export function createHttpClientTransport(): HttpTransport {
	throw new Error("not implemented in this migration slice")
}

export function createHttpHandler(): never {
	throw new Error("not implemented in this migration slice")
}
