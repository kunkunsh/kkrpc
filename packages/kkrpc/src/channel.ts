/**
 * Full kkrpc RPCChannel facade.
 * This entry keeps existing behavior by using the SuperJSON-enabled
 * serialization runtime.
 */
export {
	isRPCTimeoutError,
	RPCTimeoutError,
	type RPCChannelOptions
} from "./channel-core.ts"
import { RPCChannelCore, type RPCChannelOptions } from "./channel-core.ts"
import type { IoInterface } from "./interface.ts"
import { fullSerializationRuntime } from "./serialization-full.ts"

export class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> extends RPCChannelCore<LocalAPI, RemoteAPI, Io> {
	constructor(io: Io, options?: RPCChannelOptions<LocalAPI>) {
		super(io, options, fullSerializationRuntime)
	}
}
