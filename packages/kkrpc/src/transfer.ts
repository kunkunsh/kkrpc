/**
 * Utilities for marking values to be transferred across RPC boundaries.
 * Users call `transfer(value, [transferables])` to hint kkrpc that the value should
 * be moved instead of cloned when the transport supports transferable objects.
 */

export interface TransferDescriptor {
	value: unknown
	transfers: Transferable[]
	handler?: string
}

const transferCache = new WeakMap<object, TransferDescriptor>()

/**
 * Marks a value for zero-copy transfer.
 *
 * @param value The value to transfer (must be an object)
 * @param transfers The transferable objects to move to the remote context
 * @returns The same value for chaining
 */
export function transfer<T>(value: T, transfers: Transferable[]): T {
	if (typeof value !== "object" || value === null) {
		throw new Error("transfer() requires an object as the first argument")
	}

	transferCache.set(value as object, { value, transfers })
	return value
}

/**
 * Internal helper used during serialization to retrieve and remove transfer descriptors.
 * @internal
 */
export function takeTransferDescriptor(value: unknown): TransferDescriptor | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const descriptor = transferCache.get(value)
	if (descriptor) {
		transferCache.delete(value)
	}
	return descriptor
}

/**
 * Checks whether the provided value has a pending transfer descriptor.
 * @internal
 */
export function hasTransferDescriptor(value: unknown): boolean {
	return typeof value === "object" && value !== null && transferCache.has(value)
}
