import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage, RPCOperation, RPCRequest, RPCResponse } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export interface HttpClientTransportOptions {
	url: string
	headers?: Record<string, string>
	fetch?: typeof fetch
}

export interface HttpHandlerOptions {
	timeout?: number
}

const RPC_OPERATIONS = new Set<RPCOperation>(["call", "get", "set", "new"])
const ARG_ENVELOPE_TAG = "__kkrpc_next_arg__"

export function httpClientTransport(options: HttpClientTransportOptions): Transport<RPCMessage> {
	const fetchImpl = options.fetch ?? fetch
	const listeners = new Set<(message: RPCMessage) => void>()

	return {
		capabilities: { objectMode: true, transfer: false },
		async send(message) {
			if (message.t !== "q") {
				throw new Error("HTTP transport only supports client request messages")
			}
			if (containsCallbackEnvelope(message.a) || containsCallbackEnvelope(message.v)) {
				throw new Error("HTTP transport does not support callback arguments")
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
		let message: RPCRequest
		try {
			const body = await request.json()
			if (!isRPCRequestMessage(body)) {
				throw new Error("invalid RPC request")
			}
			message = body
		} catch {
			return new Response("Bad request", { status: 400 })
		}

		const transport = createRequestScopedTransport(message)
		const channel = new RPCChannel<LocalAPI, object>(transport, {
			expose: api,
			timeout: options.timeout
		})
		let timeout: ReturnType<typeof setTimeout> | undefined
		const response =
			options.timeout !== undefined && options.timeout > 0
				? Promise.race([
						transport.response,
						new Promise<RPCResponse>((resolve) => {
							timeout = setTimeout(() => {
								resolve({
									t: "r",
									id: message.id,
									e: {
										n: "RPCTimeoutError",
										m: `RPC request ${message.id} timed out after ${options.timeout}ms`
									}
								})
							}, options.timeout)
						})
					])
				: transport.response

		try {
			const message = await response
			return new Response(JSON.stringify(message), {
				status: message.e?.n === "RPCTimeoutError" ? 504 : 200,
				headers: { "Content-Type": "application/json" }
			})
		} finally {
			if (timeout) clearTimeout(timeout)
			channel.destroy()
		}
	}
}

function isRPCRequestMessage(value: unknown): value is RPCRequest {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCRequest>
	return (
		message.t === "q" &&
		typeof message.id === "string" &&
		typeof message.op === "string" &&
		RPC_OPERATIONS.has(message.op as RPCOperation) &&
		Array.isArray(message.p) &&
		message.p.every((segment) => typeof segment === "string") &&
		(message.a === undefined || Array.isArray(message.a)) &&
		!containsCallbackEnvelope(message.a) &&
		!containsCallbackEnvelope(message.v)
	)
}

function containsCallbackEnvelope(value: unknown, seen = new WeakSet<object>()): boolean {
	if (typeof value !== "object" || value === null) return false
	if (seen.has(value)) return false
	seen.add(value)

	if (
		ARG_ENVELOPE_TAG in value &&
		(value as { [ARG_ENVELOPE_TAG]?: unknown })[ARG_ENVELOPE_TAG] === "callback"
	) {
		return true
	}

	if (Array.isArray(value)) {
		return value.some((item) => containsCallbackEnvelope(item, seen))
	}

	return Object.values(value).some((item) => containsCallbackEnvelope(item, seen))
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
