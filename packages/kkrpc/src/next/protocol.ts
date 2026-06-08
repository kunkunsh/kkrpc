/**
 * Compact protocol types used by the vNext RPC channel.
 *
 * This file is intentionally type-only: it defines the message shapes that
 * travel through `Transport<RPCMessage>` without importing transports, codecs,
 * plugins, validation, or any runtime-specific code. The short property names
 * keep JSON/string codecs small while still preserving enough structure for
 * calls, property access, constructors, callbacks, and serialized errors.
 *
 * @example
 * ```ts
 * import type { RPCMessage } from "kkrpc/next"
 *
 * const request: RPCMessage = {
 * 	t: "q",
 * 	id: "1",
 * 	op: "call",
 * 	p: ["math", "add"],
 * 	a: [1, 2]
 * }
 * ```
 */

export interface RPCError {
	n: string
	m: string
	s?: string
	[key: string]: unknown
}

export type RPCOperation = "call" | "get" | "set" | "new"

export interface RPCRequest {
	t: "q"
	id: string
	op: RPCOperation
	p: string[]
	a?: unknown[]
	v?: unknown
}

export interface RPCResponse {
	t: "r"
	id: string
	v?: unknown
	e?: RPCError
}

export interface RPCCallback {
	t: "cb"
	id: string
	a: unknown[]
}

export type RPCMessage = RPCRequest | RPCResponse | RPCCallback
