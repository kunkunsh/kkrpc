/**
 * Compact protocol record types used by stable RPC channels.
 *
 * Requests, responses, and callback invocations use small JSON-compatible
 * records so transports can move messages across object-mode, string, and
 * stream-based platforms without depending on class instances.
 */

/** Serialized error shape sent in failed RPC responses. */
export interface RPCError {
	/** Error name, such as `Error` or `TypeError`. */
	n: string
	/** Error message. */
	m: string
	/** Optional stack trace when available. */
	s?: string
	/** Additional enumerable error fields preserved from the thrown value. */
	[key: string]: unknown
}

/** Operation kind represented by an RPC request. */
export type RPCOperation = "call" | "get" | "set" | "new"

/** Optional out-of-band metadata carried with an RPC request. */
export interface RPCMessageMetadata {
	/** W3C trace context parent header value. */
	traceparent?: string
	/** W3C trace context state header value. */
	tracestate?: string
	/** W3C baggage header value. */
	baggage?: string
	/** Application or platform request id for log correlation. */
	requestId?: string
	/** Session id for grouping related RPC calls. */
	sessionId?: string
	/** Runtime-specific low-cardinality metadata. */
	runtime?: Record<string, string | number | boolean | null | undefined>
	/** Application-specific metadata fields. */
	[key: string]: unknown
}

/** Request record for a remote property access, function call, setter, or constructor call. */
export interface RPCRequest {
	/** Message tag for requests. */
	t: "q"
	/** Request id used to match the eventual response. */
	id: string
	/** Operation to perform at `p`. */
	op: RPCOperation
	/** Property path on the exposed API. */
	p: string[]
	/** Encoded call or constructor arguments. */
	a?: unknown[]
	/** Encoded value for setter requests. */
	v?: unknown
	/** Optional protocol-level metadata, such as trace or log correlation context. */
	meta?: RPCMessageMetadata
}

/** Response record matching one request id. */
export interface RPCResponse {
	/** Message tag for responses. */
	t: "r"
	/** Request id this response resolves or rejects. */
	id: string
	/** Successful result value. */
	v?: unknown
	/** Error payload when the request failed. */
	e?: RPCError
}

/** Callback invocation record for function arguments sent across the channel. */
export interface RPCCallback {
	/** Message tag for callback invocations. */
	t: "cb"
	/** Callback id allocated by the side that encoded the function argument. */
	id: string
	/** Encoded callback arguments. */
	a: unknown[]
}

/** Any compact message accepted by an `RPCChannel` transport. */
export type RPCMessage = RPCRequest | RPCResponse | RPCCallback
