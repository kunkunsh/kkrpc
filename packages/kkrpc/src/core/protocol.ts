/**
 * Compact protocol record types used by stable RPC channels.
 *
 * Requests and responses use small JSON-compatible
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
export type RPCOperation = "call" | "get" | "set" | "new" | "ref"

/** Operation kind represented by a remote async iterator control message. */
export type RPCStreamOperation = "pull" | "return" | "throw"

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

/** Callback invocation record for legacy top-level callback arguments. */
export interface RPCCallback {
	/** Message tag for callback invocations. */
	t: "cb"
	/** Callback id allocated by the side that owns the callback function. */
	id: string
	/** Encoded callback arguments. */
	a: unknown[]
}

/**
 * Callback release record.
 *
 * Sent by the side that decoded callback facades to tell the owner it no longer
 * holds those facades, so the owner can drop the matching entries from its
 * callback registry. Releases are best-effort and fire-and-forget: a peer that
 * does not understand this message simply ignores it, and a late invocation of a
 * released callback is dropped rather than delivered.
 */
export interface RPCCallbackRelease {
	/** Message tag for callback releases. */
	t: "cbr"
	/** Callback ids the sender no longer holds facades for. */
	ids: string[]
}

/** Control record for pulling or closing a remote async iterator. */
export interface RPCStreamRequest {
	/** Message tag for async iterator control messages. */
	t: "sq"
	/** Control id. `return` and `throw` controls receive an acknowledgement with this id. */
	id: string
	/** Stream id allocated by the side that owns the local async iterator. */
	sid: string
	/** Stream operation to perform. */
	op: RPCStreamOperation
	/** Number of chunks the producer may send for a `pull` control. */
	n?: number
	/** Encoded value passed to `return()` or `throw()`. */
	v?: unknown
}

/** Stream data or control acknowledgement record. */
export interface RPCStreamResponse {
	/** Message tag for async iterator data and acknowledgements. */
	t: "sr"
	/** Data message id, or the matching control id for `return` / `throw` acknowledgements. */
	id: string
	/** Stream id this response belongs to. */
	sid: string
	/** Whether the iterator is done. */
	d?: boolean
	/** Encoded yielded or returned value. */
	v?: unknown
	/** Error payload when the iterator operation failed. */
	e?: RPCError
}

/** Any compact message accepted by an `RPCChannel` transport. */
export type RPCMessage =
	| RPCRequest
	| RPCResponse
	| RPCCallback
	| RPCCallbackRelease
	| RPCStreamRequest
	| RPCStreamResponse
