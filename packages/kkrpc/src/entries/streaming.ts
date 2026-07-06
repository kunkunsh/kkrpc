/**
 * Async-iterable streaming RPC entry.
 *
 * Import from this entry when RPC methods need to return or receive
 * `AsyncIterable` values with pull-based backpressure.
 *
 * ```ts
 * import { wrap } from "kkrpc/streaming"
 *
 * for await (const value of remote.numbers(10)) console.log(value)
 * ```
 * @module
 */

import type { RPCChannelOptions } from "../core/channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import { StreamingRPCChannel } from "../core/streaming-channel.ts"
import type { Transport } from "../core/transport.ts"

export { StreamingRPCChannel, StreamingRPCChannel as RPCChannel }
export type { RPCChannelOptions }
export { transfer } from "../core/transfer.ts"
export type {
	RPCError,
	RPCMessage,
	RPCMessageMetadata,
	RPCOperation,
	RPCRequest,
	RPCResponse,
	RPCStreamOperation,
	RPCStreamRequest,
	RPCStreamResponse
} from "../core/protocol.ts"
export type { Transport, TransportCapabilities } from "../core/transport.ts"

export interface ExposedController<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
> {
	channel: StreamingRPCChannel<LocalAPI, RemoteAPI>
	dispose(): void
}

const channels = new WeakMap<object, StreamingRPCChannel<object, object>>()

export function wrap<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<object>, "expose"> = {}
): RemoteAPI {
	const channel = new StreamingRPCChannel<object, RemoteAPI>(transport, options)
	const api = channel.getAPI()
	channels.set(api, channel as StreamingRPCChannel<object, object>)
	return api
}

export function expose<LocalAPI extends object, RemoteAPI extends object = object>(
	api: LocalAPI,
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<LocalAPI>, "expose"> = {}
): ExposedController<LocalAPI, RemoteAPI> {
	const channel = new StreamingRPCChannel<LocalAPI, RemoteAPI>(transport, {
		...options,
		expose: api
	})
	return { channel, dispose: () => channel.destroy() }
}

export function dispose(api: object): void {
	const channel = channels.get(api)
	if (!channel) return
	channels.delete(api)
	channel.destroy()
}
