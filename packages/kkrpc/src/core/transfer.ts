/**
 * Transfer descriptor marking and consumption helpers.
 *
 * `transfer()` marks an object with the transferables that should accompany it.
 * `RPCChannel` later consumes that descriptor while encoding a value, and only
 * forwards the transfer list when the active transport supports transfer.
 */

/** Value plus transferables recorded for one outbound RPC value. */
export interface TransferDescriptor {
	/** Value that should be encoded into the RPC message. */
	value: unknown
	/** Transferables to pass to the underlying platform send operation. */
	transfers: Transferable[]
	/** Reserved handler label for transports that need custom transfer handling. */
	handler?: string
}

const transferCache = new WeakMap<object, TransferDescriptor>()

/**
 * Mark an object to be sent with transferables on the next RPC encode pass.
 *
 * ```ts
 * const buffer = new ArrayBuffer(1024)
 * await remote.upload(transfer(buffer, [buffer]))
 * ```
 */
export function transfer<T>(value: T, transfers: Transferable[]): T {
	if (typeof value !== "object" || value === null) {
		throw new Error("transfer() requires an object as the first argument")
	}

	transferCache.set(value as object, { value, transfers })
	return value
}

/** Consume and remove the transfer descriptor attached to a value, if present. */
export function takeTransferDescriptor(value: unknown): TransferDescriptor | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const descriptor = transferCache.get(value)
	if (descriptor) {
		transferCache.delete(value)
	}
	return descriptor
}

/** Check whether a value currently has a transfer descriptor. */
export function hasTransferDescriptor(value: unknown): boolean {
	return typeof value === "object" && value !== null && transferCache.has(value)
}
