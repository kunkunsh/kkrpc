/** Compact protocol types used by the stable RPC channel. */

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
