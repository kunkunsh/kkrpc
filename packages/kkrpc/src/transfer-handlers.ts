/**
 * Transfer handler system for custom serialization logic.
 * Native transferable types (ArrayBuffer, MessagePort, etc.) are handled by the browser/runtime
 * and do not require custom handlers.
 */

export interface TransferHandler<T = any, S = any> {
	canHandle(value: unknown): value is T
	serialize(value: T): [S, Transferable[]]
	deserialize(value: S): T
}

export const transferHandlers = new Map<string, TransferHandler>()

/**
 * Registers a custom transfer handler for non-standard transferable types.
 * @param name Unique name used to reference the handler during serialization.
 * @param handler Handler implementation responsible for serializing and deserializing the value.
 */
export function registerTransferHandler<T, S>(name: string, handler: TransferHandler<T, S>): void {
	transferHandlers.set(name, handler as TransferHandler)
}
