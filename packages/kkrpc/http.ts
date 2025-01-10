/**
 * @module @kunkun/kkrpc/http
 * @description This module contains the HTTP adapters for kkrpc.
 */
import { HTTPClientIO, HTTPServerIO } from "./src/adapters/http"
import { RPCChannel } from "./src/channel"
import type { IoInterface } from "./src/interface"

export function createHttpClient<API extends Record<string, any>>(
	url: string
): {
	channel: RPCChannel<{}, API, IoInterface>
	api: API
} {
	const channel = new RPCChannel<{}, API>(new HTTPClientIO({ url }))
	const api = channel.getAPI()
	return { channel, api }
}

export function createHttpHandler<API extends Record<string, any>>(
	api: API
): { handleRequest: (data: string) => Promise<string> } {
	const serverIO = new HTTPServerIO()
	new RPCChannel<{}, API>(serverIO, { expose: api })
	return serverIO
}
export { RPCChannel } from "./src/channel"
export { HTTPClientIO, HTTPServerIO } from "./src/adapters/http"
