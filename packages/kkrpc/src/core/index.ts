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

export function wrap<RemoteAPI extends object = object>(
	transport: Transport<RPCMessage>,
	options: Omit<RPCChannelOptions<object>, "expose"> = {}
): RemoteAPI {
	const channel = new RPCChannel<object, RemoteAPI>(transport, options)
	const api = channel.getAPI()
	channels.set(api, channel as RPCChannel<object, object>)
	return api
}

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

export function dispose(api: object): void {
	const channel = channels.get(api)
	if (!channel) return
	channels.delete(api)
	channel.destroy()
}
