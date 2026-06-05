/**
 * Browser-lite RPCChannel facade.
 * This wrapper preserves the public `new RPCChannel(...)` API while using the
 * JSON-only serialization runtime so SuperJSON stays out of lite bundles.
 */
export {
	isRPCTimeoutError,
	RPCTimeoutError,
	type RPCChannelOptions
} from "./channel-core.ts"
import { RPCChannelCore, type RPCChannelOptions } from "./channel-core.ts"
import type { IoInterface } from "./interface.ts"
import { jsonSerializationRuntime } from "./serialization-json.ts"

export class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> extends RPCChannelCore<LocalAPI, RemoteAPI, Io> {
	constructor(io: Io, options?: RPCChannelOptions<LocalAPI>) {
		if (options?.serialization?.version === "superjson") {
			throw new Error(
				'SuperJSON serialization is not available in kkrpc/browser-lite. Use kkrpc/browser or configure both endpoints with serialization.version = "json".'
			)
		}
		super(io, options, jsonSerializationRuntime)
	}
}
