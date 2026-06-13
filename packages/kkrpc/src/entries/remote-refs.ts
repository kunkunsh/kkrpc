/**
 * Remote-reference enabled RPC entry.
 *
 * Use this entry when values marked with `proxy(value)` should cross the RPC
 * boundary by reference. Marked functions and objects may appear at the top
 * level or nested inside plain arrays/objects.
 *
 * ```ts
 * import { proxy, wrap } from "kkrpc/remote-refs"
 *
 * await remote.run({ onProgress: proxy((value) => console.log(value)) })
 * ```
 * @module
 */

import {
	RemoteReferenceRPCChannel,
	type RemoteReferenceRPCChannelOptions
} from "../core/remote-ref-channel.ts"
import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export { RemoteReferenceRPCChannel, RemoteReferenceRPCChannel as RPCChannel }
export type { RemoteReferenceRPCChannelOptions, RemoteReferenceRPCChannelOptions as RPCChannelOptions }
export {
	RPCEncodeError,
	RPCRemoteReferenceReleasedError,
	isRemoteRefEnvelope,
	isRemoteProxy,
	proxy,
	releaseProxy
} from "../core/remote-ref.ts"
export type { RemoteRefEnvelope, RemoteRefKind } from "../core/remote-ref.ts"
export { transfer } from "../core/transfer.ts"
export type {
	RPCError,
	RPCMessage,
	RPCMessageMetadata,
	RPCOperation,
	RPCRequest,
	RPCResponse
} from "../core/protocol.ts"
export type { Transport, TransportCapabilities } from "../core/transport.ts"

export interface ExposedController<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
> {
	channel: RemoteReferenceRPCChannel<LocalAPI, RemoteAPI>
	dispose(): void
}

const channels = new WeakMap<object, RemoteReferenceRPCChannel<object, object>>()

export function wrap<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<RemoteReferenceRPCChannelOptions<object>, "expose"> = {}
): RemoteAPI {
	const channel = new RemoteReferenceRPCChannel<object, RemoteAPI>(transport, options)
	const api = channel.getAPI()
	channels.set(api, channel as RemoteReferenceRPCChannel<object, object>)
	return api
}

export function expose<LocalAPI extends object, RemoteAPI extends object = object>(
	api: LocalAPI,
	transport: Transport<RPCMessage>,
	options: Omit<RemoteReferenceRPCChannelOptions<LocalAPI>, "expose"> = {}
): ExposedController<LocalAPI, RemoteAPI> {
	const channel = new RemoteReferenceRPCChannel<LocalAPI, RemoteAPI>(transport, {
		...options,
		expose: api
	})
	return {
		channel,
		dispose: () => channel.destroy()
	}
}

export function dispose(api: object): void {
	const channel = channels.get(api)
	if (!channel) return
	channels.delete(api)
	channel.destroy()
}
