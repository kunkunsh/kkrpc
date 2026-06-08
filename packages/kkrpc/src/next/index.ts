/**
 * Public core API for `kkrpc/next`.
 *
 * This module exports the minimal runtime surface: `RPCChannel`, convenience
 * `wrap()`/`expose()` helpers, core protocol/transport/plugin types, and the
 * transferable marker. It deliberately does not import concrete transports,
 * codecs, validation, middleware, SuperJSON, or compatibility helpers.
 *
 * @example
 * ```ts
 * import { expose, wrap } from "kkrpc/next"
 *
 * expose({ add: (a: number, b: number) => a + b }, serverTransport)
 * const api = wrap<{ add(a: number, b: number): Promise<number> }>(clientTransport)
 * await api.add(1, 2)
 * ```
 */

import { RPCChannel } from "./channel.ts"
import type { RPCChannelOptions } from "./channel.ts"
import type { RPCMessage } from "./protocol.ts"
import type { Transport } from "./transport.ts"

export { RPCChannel }
export type { RPCChannelOptions } from "./channel.ts"
export { transfer } from "../transfer.ts"
export type { TransferDescriptor } from "../transfer.ts"
export type {
	RPCErrorContext,
	RPCHandlerContext,
	RPCPlugin,
	RPCRequestContext,
	RPCResponseContext
} from "./plugins.ts"
export type { RPCCallback, RPCError, RPCMessage, RPCOperation, RPCRequest, RPCResponse } from "./protocol.ts"
export type {
	Codec,
	CodecCapabilities,
	Platform,
	PlatformCapabilities,
	Transport,
	TransportCapabilities
} from "./transport.ts"

export interface ExposedController<LocalAPI extends object = object, RemoteAPI extends object = object> {
	channel: RPCChannel<LocalAPI, RemoteAPI>
	dispose(): void
}

const channels = new WeakMap<object, RPCChannel<object, object>>()

/**
 * Create a typed proxy for a remote API and hide the channel instance.
 *
 * The returned proxy is tracked in a WeakMap so `dispose(api)` can later destroy
 * the underlying channel.
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
 * Expose a local API on a transport.
 *
 * Returns a controller so callers can destroy the channel without keeping the
 * raw `RPCChannel` constructor in application code.
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

/** Destroy the hidden channel created by `wrap()`, if the object is tracked. */
export function dispose(api: object): void {
	const channel = channels.get(api)
	if (!channel) return
	channels.delete(api)
	channel.destroy()
}
