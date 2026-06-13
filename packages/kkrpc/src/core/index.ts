/**
 * Convenience API for stable RPC channels.
 *
 * `wrap()` creates a typed client proxy, `expose()` publishes a local API, and
 * `dispose()` tears down proxies created by `wrap()`. A weak disposal map keeps
 * proxy lifetime tied to the underlying `RPCChannel` without exposing channel
 * internals in the common client-only flow.
 */

import { RPCChannel } from "./channel.ts"
import type { RPCChannelOptions } from "./channel.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export { RPCChannel }
export type { RPCChannelOptions } from "./channel.ts"
export { transfer } from "./transfer.ts"
export type { TransferDescriptor } from "./transfer.ts"
export type {
	RPCErrorContext,
	RPCHandlerContext,
	RPCPlugin,
	RPCRequestContext,
	RPCResponseContext
} from "./plugins.ts"
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
} from "./protocol.ts"
export type {
	Codec,
	CodecCapabilities,
	Platform,
	PlatformCapabilities,
	Transport,
	TransportCapabilities
} from "./transport.ts"

/** Controller returned by `expose()` for managing a locally exposed API. */
export interface ExposedController<
	LocalAPI extends object = object,
	RemoteAPI extends object = object
> {
	/** The underlying channel, useful when both exposing and calling a remote API. */
	channel: RPCChannel<LocalAPI, RemoteAPI>
	/** Destroy the underlying channel and release pending requests/callback refs. */
	dispose(): void
}

const channels = new WeakMap<object, RPCChannel<object, object>>()

/**
 * Create a typed proxy for a remote API exposed on the other side of a transport.
 *
 * Use this for the common client-only case. The returned proxy is registered for
 * disposal, so `dispose(proxy)` tears down the underlying channel.
 *
 * ```ts
 * import { wrap } from "kkrpc"
 * import { webSocketClientTransport } from "kkrpc/ws"
 *
 * const api = wrap<RemoteAPI>(webSocketClientTransport({ url: "ws://localhost:3000" }))
 * console.log(await api.ping())
 * ```
 */
export function wrap<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<object>, "expose"> = {}
): RemoteAPI {
	const channel = new RPCChannel<object, RemoteAPI>(transport, options)
	const api = channel.getAPI()
	channels.set(api, channel as RPCChannel<object, object>)
	return api
}

/**
 * Expose a local API object on a transport.
 *
 * The returned controller can also access the remote side through `channel.getAPI()`
 * when the connection is bidirectional.
 */
export function expose<LocalAPI extends object, RemoteAPI extends object = object>(
	api: LocalAPI,
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<LocalAPI>, "expose"> = {}
): ExposedController<LocalAPI, RemoteAPI> {
	const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { ...options, expose: api })
	return {
		channel,
		dispose: () => channel.destroy()
	}
}

/** Destroy the channel associated with a proxy returned by `wrap()`. */
export function dispose(api: object): void {
	const channel = channels.get(api)
	if (!channel) return
	channels.delete(api)
	channel.destroy()
}
