import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage, RPCResponse } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface HttpClientTransportOptions {
	url: string
	headers?: Record<string, string>
	fetch?: typeof fetch
}

export interface HttpHandlerOptions {
	timeout?: number
}

export function httpClientTransport(options: HttpClientTransportOptions): Transport<RPCMessage> {
	const fetchImpl = options.fetch ?? fetch
	const listeners = new Set<(message: RPCMessage) => void>()

	return {
		capabilities: { objectMode: true, transfer: false },
		async send(message) {
			if (message.t !== "q") {
				throw new Error("HTTP transport only supports client request messages")
			}
			const response = await fetchImpl(options.url, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...options.headers },
				body: JSON.stringify(message)
			})
			if (!response.ok) throw new Error(`HTTP error ${response.status}`)
			const reply = (await response.json()) as RPCMessage
			for (const listener of listeners) listener(reply)
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		}
	}
}

export function createHttpHandler<LocalAPI extends object>(
	api: LocalAPI,
	options: HttpHandlerOptions = {}
): (request: Request) => Promise<Response> {
	return async (request) => {
		let message: RPCMessage
		try {
			message = (await request.json()) as RPCMessage
			if (message.t !== "q" || typeof message.id !== "string") {
				throw new Error("invalid RPC request")
			}
		} catch {
			return new Response("Bad request", { status: 400 })
		}

		const transport = createRequestScopedTransport(message)
		const channel = new RPCChannel<LocalAPI, object>(transport, {
			expose: api,
			timeout: options.timeout
		})

		try {
			const response = await transport.response
			return new Response(JSON.stringify(response), {
				headers: { "Content-Type": "application/json" }
			})
		} finally {
			channel.destroy()
		}
	}
}

function createRequestScopedTransport(request: RPCMessage): Transport<RPCMessage> & {
	response: Promise<RPCResponse>
} {
	const listeners = new Set<(message: RPCMessage) => void>()
	let closed = false
	let settled = false
	let resolveResponse: (message: RPCResponse) => void
	let rejectResponse: (error: Error) => void
	const response = new Promise<RPCResponse>((resolve, reject) => {
		resolveResponse = resolve
		rejectResponse = reject
	})

	function rejectOnce(error: Error): void {
		if (settled) return
		settled = true
		rejectResponse(error)
	}

	function resolveOnce(message: RPCResponse): void {
		if (settled) return
		settled = true
		resolveResponse(message)
	}

	return {
		response,
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			if (message.t !== "r") {
				throw new Error("HTTP handler transport only supports response messages")
			}
			resolveOnce(message)
		},
		subscribe(listener) {
			if (closed) return () => {}
			listeners.add(listener)
			queueMicrotask(() => {
				if (!closed && listeners.has(listener)) listener(request)
			})
			return () => {
				listeners.delete(listener)
			}
		},
		close() {
			closed = true
			listeners.clear()
			rejectOnce(new Error("HTTP request transport closed before response"))
		}
	}
}
