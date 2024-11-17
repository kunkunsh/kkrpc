import { HTTPClientIO, HTTPServerIO } from "./adapters/http"
import { RPCChannel } from "./channel"
import type { IoInterface } from "./interface"

export function createHttpClient<API extends Record<string, any>>(
	url: string
): {
	channel: RPCChannel<{}, API, IoInterface>
	api: API
} {
	const channel = new RPCChannel<{}, API>(new HTTPClientIO({ url }), {})
	const api = channel.getAPI()
	return { channel, api }
}

export function createHttpHandler<API extends Record<string, any>>(
	api: API
): { handleRequest: (data: string) => Promise<string> } {
	const serverIO = new HTTPServerIO()
	new RPCChannel<{}, API>(serverIO, api)
	return serverIO
}
export { RPCChannel } from "./channel"
export { HTTPClientIO, HTTPServerIO } from "./adapters/http"
