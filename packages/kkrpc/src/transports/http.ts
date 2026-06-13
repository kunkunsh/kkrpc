/**
 * Unary HTTP transport and handler for stable kkrpc.
 *
 * HTTP maps each RPC request to one POST request and one JSON response. It is
 * useful for simple web APIs, but it cannot support remote references or
 * server-initiated calls because the server has no persistent channel back to
 * the client.
 *
 * ```ts
 * import { wrap } from "kkrpc"
 * import { httpClientTransport } from "kkrpc/http"
 *
 * const api = wrap<RemoteAPI>(httpClientTransport({ url: "http://localhost:3000/rpc" }))
 * ```
 */

import { RPCChannel } from "../core/channel.ts"
import type { RPCMessage, RPCOperation, RPCRequest, RPCResponse } from "../core/protocol.ts"
import { isRemoteRefEnvelope } from "../core/remote-ref.ts"
import type { Transport } from "../core/transport.ts"

/** Options for the client-side unary HTTP transport. */
export interface HttpClientTransportOptions {
	/** Absolute or relative endpoint URL that accepts RPC POST requests. */
	url: string
	/** Headers merged with the default JSON content type. */
	headers?: Record<string, string>
	/** Fetch implementation to use; defaults to global `fetch`. */
	fetch?: typeof fetch
}

/** Options for `createHttpHandler()`. */
export interface HttpHandlerOptions {
	/** Request-scoped RPC timeout in milliseconds. */
	timeout?: number
}

const RPC_OPERATIONS = new Set<RPCOperation>(["call", "get", "set", "new"])
const ARG_ENVELOPE_TAG = "__kkrpc_next_arg__"
const STREAM_REF_TAG = "__kkrpc_next_stream__"

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
	)
}

/**
 * Create a client transport backed by `fetch()` POST requests.
 *
 * The transport is unary and request-only: it sends compact RPC request messages
 * and forwards the HTTP response back to the channel. It supports neither
 * callbacks nor transferables, and there is no persistent connection to close.
 */
export function httpClientTransport(options: HttpClientTransportOptions): Transport<RPCMessage> {
	const fetchImpl = options.fetch ?? fetch
	const listeners = new Set<(message: RPCMessage) => void>()

	return {
		capabilities: { objectMode: true, transfer: false, remoteRefs: false },
		async send(message) {
			if (message.t !== "q") {
				throw new Error("HTTP transport only supports client request messages")
			}
			assertHttpEnvelopeSupported(message.a)
			assertHttpEnvelopeSupported(message.v)
			const response = await fetchImpl(options.url, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...options.headers },
				body: JSON.stringify(message)
			})
			const reply = await readRPCResponse(response)
			if (reply) {
				for (const listener of listeners) listener(reply)
				return
			}
			if (!response.ok) throw new Error(`HTTP error ${response.status}`)
			throw new Error("Invalid RPC response")
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		}
	}
}

async function readRPCResponse(response: Response): Promise<RPCResponse | undefined> {
	try {
		const body = await response.json()
		return isRPCResponseMessage(body) ? body : undefined
	} catch {
		return undefined
	}
}

function isRPCResponseMessage(value: unknown): value is RPCResponse {
	if (typeof value !== "object" || value === null) return false
	const message = value as Partial<RPCResponse>
	return message.t === "r" && typeof message.id === "string"
}

/**
 * Create a Fetch API handler that exposes a local API over unary HTTP.
 *
 * The handler validates that the request body is a compact RPC request and
 * rejects remote reference envelopes because HTTP has no reverse channel for
 * invoking retained values. A request-scoped channel is destroyed after each response.
 */
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
			const unsupportedRemoteRefs =
				findUnsupportedRemoteRefEnvelope(body.a) ?? findUnsupportedRemoteRefEnvelope(body.v)
			if (unsupportedRemoteRefs) {
				return new Response(
					JSON.stringify({
						t: "r",
						id: body.id,
						e: { n: "Error", m: unsupportedRemoteRefs }
					} satisfies RPCResponse),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				)
			}
			const unsupportedHttp = findUnsupportedHttpEnvelope(body.a) ?? findUnsupportedHttpEnvelope(body.v)
			if (unsupportedHttp) {
				return new Response(
					JSON.stringify({
						t: "r",
						id: body.id,
						e: { n: "Error", m: unsupportedHttp }
					} satisfies RPCResponse),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				)
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
		(message.a === undefined || Array.isArray(message.a))
	)
}

function assertHttpEnvelopeSupported(value: unknown): void {
	const unsupported = findUnsupportedHttpEnvelope(value)
	if (!unsupported) return
	throw new Error(unsupported)
}

function findUnsupportedRemoteRefEnvelope(
	value: unknown,
	seen = new WeakSet<object>()
): string | undefined {
	if (typeof value !== "object" || value === null) return undefined
	if (seen.has(value)) return undefined
	seen.add(value)

	if (isRemoteRefEnvelope(value)) {
		return "HTTP transport does not support remote references"
	}
	if (isAsyncIterable(value)) {
		return "HTTP transport does not support async iterable streams"
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const unsupported = findUnsupportedRemoteRefEnvelope(item, seen)
			if (unsupported) return unsupported
		}
		return undefined
	}

	for (const item of Object.values(value)) {
		const unsupported = findUnsupportedRemoteRefEnvelope(item, seen)
		if (unsupported) return unsupported
	}
	return undefined
}

// HTTP only accepts one-shot exchanges; these envelopes require follow-up bidirectional traffic.
function findUnsupportedHttpEnvelope(
	value: unknown,
	seen = new WeakSet<object>()
): string | undefined {
	if (typeof value === "function") return "HTTP transport does not support function values"
	if (typeof value !== "object" || value === null) return undefined
	if (seen.has(value)) return undefined
	seen.add(value)

	if (isRemoteRefEnvelope(value)) {
		return "HTTP transport does not support remote references"
	}
	if (isAsyncIterable(value)) {
		return "HTTP transport does not support async iterable streams"
	}
	if (
		STREAM_REF_TAG in value &&
		(value as { [STREAM_REF_TAG]?: unknown })[STREAM_REF_TAG] === "async-iterable"
	) {
		return "HTTP transport does not support async iterable streams"
	}
	if (
		ARG_ENVELOPE_TAG in value &&
		(value as { [ARG_ENVELOPE_TAG]?: unknown })[ARG_ENVELOPE_TAG] === "callback"
	) {
		return "HTTP transport does not support callback arguments"
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const unsupported = findUnsupportedHttpEnvelope(item, seen)
			if (unsupported) return unsupported
		}
		return undefined
	}

	for (const item of Object.values(value)) {
		const unsupported = findUnsupportedHttpEnvelope(item, seen)
		if (unsupported) return unsupported
	}
	return undefined
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
		capabilities: { objectMode: true, transfer: false, remoteRefs: false },
		send(message) {
			if (message.t !== "r") {
				throw new Error("HTTP handler transport only supports response messages")
			}
			const unsupported =
				findUnsupportedHttpEnvelope(message.v) ?? findUnsupportedHttpEnvelope(message.e)
			if (unsupported) {
				resolveOnce({
					t: "r",
					id: message.id,
					e: {
						n: "Error",
						m: unsupported
					}
				})
				return
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
