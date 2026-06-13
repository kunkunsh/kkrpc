/**
 * Shared remote-reference markers and lifecycle helpers.
 *
 * This module is intentionally separate from the default core channel so the
 * default `kkrpc` entry can stay small. The opt-in `kkrpc/remote-refs` entry
 * imports these helpers to implement Comlink-style explicit references.
 * @module
 */

/** Wire-visible marker used to identify a remote-reference envelope. */
export const REMOTE_REF_TAG = "__kkrpc_ref__" as const

/** Remote references can target callable values or object handles. */
export type RemoteRefKind = "function" | "object"

/** Compact by-reference handle sent over the RPC wire. */
export interface RemoteRefEnvelope {
	readonly [REMOTE_REF_TAG]: true
	readonly id: string
	readonly kind: RemoteRefKind
	readonly p?: string[]
}

/** Channel-owned metadata attached to decoded remote proxy objects/functions. */
export interface RemoteProxyRecord {
	id: string
	kind: RemoteRefKind
	path?: string[]
	released: boolean
	release(): Promise<void>
	markReleased(): void
}

/** Raised when a value cannot be encoded into the current RPC channel mode. */
export class RPCEncodeError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "RPCEncodeError"
	}
}

/** Raised when callers use a proxy after the owner has released it. */
export class RPCRemoteReferenceReleasedError extends Error {
	constructor(refId: string) {
		super(`RPC remote reference ${refId} has been released`)
		this.name = "RPCRemoteReferenceReleasedError"
	}
}

const explicitProxyTargets = new WeakSet<object>()
const remoteProxyRegistry = new WeakMap<object, RemoteProxyRecord>()

/**
 * Mark an object or function to cross `kkrpc/remote-refs` by reference.
 *
 * The marker is persistent and non-enumerable because it is stored in a
 * `WeakSet`, not on the object itself. Plain unmarked functions nested inside
 * data are not proxied by the explicit remote-ref entry.
 */
export function proxy<T extends object>(value: T): T {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) {
		throw new TypeError("proxy() requires an object or function value")
	}
	explicitProxyTargets.add(value)
	return value
}

/** Return whether a local value has been marked with `proxy(value)`. */
export function isExplicitProxyTarget(value: unknown): value is object {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		explicitProxyTargets.has(value)
	)
}

/** Attach channel release metadata to a decoded remote proxy. */
export function registerRemoteProxy(value: object, record: RemoteProxyRecord): void {
	remoteProxyRegistry.set(value, record)
}

/** Look up release metadata for a decoded remote proxy, if any. */
export function getRemoteProxyRecord(value: unknown): RemoteProxyRecord | undefined {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined
	return remoteProxyRegistry.get(value)
}

/** Return whether a value is a proxy decoded from a remote-reference envelope. */
export function isRemoteProxy(value: unknown): boolean {
	return getRemoteProxyRecord(value) !== undefined
}

/**
 * Release a decoded remote proxy.
 *
 * Releasing is idempotent and safe for non-proxy values. When the value is a
 * real remote proxy, this sends a release request to the owning channel and then
 * marks the local proxy as unusable.
 */
export async function releaseProxy(value: unknown): Promise<void> {
	const record = getRemoteProxyRecord(value)
	if (!record || record.released) return
	await record.release()
	record.markReleased()
}

/** Type guard for remote-reference envelopes found in decoded RPC values. */
export function isRemoteRefEnvelope(value: unknown): value is RemoteRefEnvelope {
	if (typeof value !== "object" || value === null) return false
	const record = value as Partial<RemoteRefEnvelope>
	return (
		record[REMOTE_REF_TAG] === true &&
		typeof record.id === "string" &&
		(record.kind === "function" || record.kind === "object") &&
		(record.p === undefined ||
			(Array.isArray(record.p) && record.p.every((segment) => typeof segment === "string")))
	)
}
