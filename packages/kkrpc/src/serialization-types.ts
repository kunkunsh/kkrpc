/**
 * Shared wire protocol types for kkrpc serializers and channels.
 * This file has no runtime dependencies so lite entrypoints can reuse the
 * protocol shape without importing SuperJSON or full serialization helpers.
 */

export interface Message<T = unknown> {
	id: string
	method: string
	args: T
	type:
		| "request"
		| "response"
		| "callback"
		| "get"
		| "set"
		| "construct"
		| "stream-chunk"
		| "stream-end"
		| "stream-error"
		| "stream-cancel"
	callbackIds?: string[]
	version?: "json" | "superjson"
	meta?: RPCMessageMetadata
	path?: string[]
	value?: unknown
	transferSlots?: TransferSlot[]
}

/**
 * Optional out-of-band metadata carried with an RPC message.
 */
export interface RPCMessageMetadata {
	traceparent?: string
	tracestate?: string
	baggage?: string
	requestId?: string
	sessionId?: string
	runtime?: Record<string, string | number | boolean | null | undefined>
	[key: string]: unknown
}

export interface Response<T = unknown> {
	result?: T
	error?: string | EnhancedError
}

export interface EnhancedError {
	name: string
	message: string
	stack?: string
	cause?: unknown
	[key: string]: unknown
}

export interface SerializationOptions {
	version?: "json" | "superjson"
}

export const TRANSFER_SLOT_PREFIX = "__kkrpc_transfer_"

export interface TransferSlot {
	type: "raw" | "handler"
	handlerName?: string
	metadata?: unknown
	/** Random per-slot token that proves a placeholder was generated for this message. */
	token?: string
}

export interface WireEnvelope {
	version: 2
	payload: Message<unknown>
	transferSlots?: TransferSlot[]
	encoding: "object"
	__transferredValues?: unknown[]
}

export type WireV1 = string
export type WireFormat = WireV1 | WireEnvelope

export type EncodedMessage =
	| { mode: "string"; data: string }
	| { mode: "structured"; data: WireEnvelope }

export interface RPCSerializationRuntime {
	encodeMessage<T>(
		message: Message<T>,
		options: SerializationOptions,
		withTransfers: boolean,
		transferredValues?: unknown[]
	): EncodedMessage
	decodeMessage<T>(raw: WireFormat): Promise<Message<T>>
	serializeError(error: Error): EnhancedError
	deserializeError(error: EnhancedError): Error
}
