import type { Transport } from "./src/core/transport.ts"
import type { RPCMessage } from "./src/core/protocol.ts"

export type ChromeExtensionTransport = Transport<RPCMessage>

export function createChromeExtensionTransport(): ChromeExtensionTransport {
	throw new Error("not implemented in this migration slice")
}
