/** Utilities for marking values to be transferred across RPC boundaries. */

export interface TransferDescriptor {
	value: unknown
	transfers: Transferable[]
	handler?: string
}

const transferCache = new WeakMap<object, TransferDescriptor>()

export function transfer<T>(value: T, transfers: Transferable[]): T {
	if (typeof value !== "object" || value === null) {
		throw new Error("transfer() requires an object as the first argument")
	}

	transferCache.set(value as object, { value, transfers })
	return value
}

export function takeTransferDescriptor(value: unknown): TransferDescriptor | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const descriptor = transferCache.get(value)
	if (descriptor) {
		transferCache.delete(value)
	}
	return descriptor
}

export function hasTransferDescriptor(value: unknown): boolean {
	return typeof value === "object" && value !== null && transferCache.has(value)
}
