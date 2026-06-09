import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type ElectronTransport = Transport<RPCMessage>

export function createElectronTransport(): ElectronTransport {
	throw new Error("not implemented in this migration slice")
}
