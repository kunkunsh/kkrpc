import superjson from "superjson"
import {
	isTransferable,
	validateTransferables,
	extractTransferables,
	isTransferableSupported
} from "./transferable.ts"

/**
 * This file contains the serialization and deserialization functions for the RPC protocol.
 * Enhanced with Transferable objects support for browser environments.
 */

/**
 * Interface for transfer handlers that customize serialization of certain values.
 * Similar to Comlink's TransferHandler but adapted for kkrpc's architecture.
 *
 * @template T The input type being handled by this transfer handler
 * @template S The serialized type sent over the wire
 */
export interface TransferHandler<T, S> {
	/**
	 * Gets called for every value to determine whether this transfer handler
	 * should serialize the value, which includes checking that it is of the right
	 * type (but can perform checks beyond that as well).
	 */
	canHandle(value: unknown): value is T

	/**
	 * Gets called with the value if `canHandle()` returned `true` to produce a
	 * value that can be sent in a message, consisting of serializable values.
	 */
	serialize(value: T): S

	/**
	 * Gets called to deserialize an incoming value that was serialized in the
	 * other thread with this transfer handler (known through the name it was
	 * registered under).
	 */
	deserialize(value: S): T
}

/**
 * Global registry of transfer handlers for custom serialization.
 * Maps handler names to their implementations.
 */
export const transferHandlers = new Map<string, TransferHandler<unknown, unknown>>()

/**
 * WeakMap to store transferable objects marked for transfer.
 * Similar to Comlink's transferCache but adapted for kkrpc.
 */
const transferCache = new WeakMap<any, any[]>()

/**
 * Marks an object as transferable with specified transferables.
 * This is similar to Comlink's transfer() function.
 *
 * @param obj - The object to mark for transfer
 * @param transfers - Array of transferable objects
 * @returns The original object (marked for transfer)
 */
export function transfer<T>(obj: T, transfers: any[]): T {
	transferCache.set(obj, transfers)
	return obj
}

/**
 * Gets transferables associated with an object.
 *
 * @param obj - The object to get transferables for
 * @returns Array of transferable objects or empty array
 */
export function getTransferables(obj: any): any[] {
	return transferCache.get(obj) || []
}

/**
 * Symbol to mark objects that should be proxied.
 * Similar to Comlink's proxyMarker.
 */
export const proxyMarker = Symbol("kkrpc.proxy")

/**
 * Interface for objects marked to be proxied.
 */
export interface ProxyMarked {
	[proxyMarker]: true
}

/**
 * Marks an object as a proxy that should be transferred by reference.
 * Similar to Comlink's proxy() function.
 *
 * @param obj - The object to mark as proxy
 * @returns The object marked as proxy
 */
export function proxy<T extends object>(obj: T): T & ProxyMarked {
	return Object.assign(obj, { [proxyMarker]: true }) as any
}

export interface Message<T = any> {
	id: string
	method: string
	args: T
	type: "request" | "response" | "callback" | "get" | "set" | "construct" // Extended message types
	callbackIds?: string[] // Add callbackIds field
	version?: "json" | "superjson" // Add version field for backward compatibility
	path?: string[] // Property path for get/set operations
	value?: any // Value for set operations
	transfers?: any[] // Transferable objects
}

export interface Response<T = any> {
	result?: T
	error?: string | EnhancedError
}

export interface EnhancedError {
	name: string
	message: string
	stack?: string
	cause?: any
	[key: string]: any // Custom properties
}

export interface SerializationOptions {
	version?: "json" | "superjson"
}

/**
 * Internal transfer handler to handle objects marked to proxy.
 * Similar to Comlink's proxyTransferHandler but adapted for kkrpc.
 */
const proxyTransferHandler: TransferHandler<object, { type: "proxy"; id: string }> = {
	canHandle: (val): val is ProxyMarked =>
		typeof val === "object" && val !== null && (val as ProxyMarked)[proxyMarker],
	serialize(obj) {
		// Generate a unique ID for the proxy
		const id = `proxy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
		return { type: "proxy", id }
	},
	deserialize(data) {
		// For kkrpc, we'll return a placeholder that will be resolved by the channel
		// The actual proxy implementation will be handled by the channel
		return { __kkrpc_proxy__: true, id: data.id }
	},
}

/**
 * Internal transfer handler to handle Error objects.
 * This extends the existing error serialization with the transfer handler pattern.
 */
const errorTransferHandler: TransferHandler<Error, EnhancedError> = {
	canHandle: (val): val is Error => val instanceof Error,
	serialize(error) {
		return serializeError(error)
	},
	deserialize(enhanced) {
		return deserializeError(enhanced)
	},
}

/**
 * Internal transfer handler to handle ArrayBuffer objects.
 * This ensures ArrayBuffers are properly handled during transfer.
 */
const arrayBufferTransferHandler: TransferHandler<ArrayBuffer, { type: "ArrayBuffer"; size: number }> = {
	canHandle: (val): val is ArrayBuffer => val instanceof ArrayBuffer,
	serialize(buffer) {
		return {
			type: "ArrayBuffer",
			size: buffer.byteLength
		}
	},
	deserialize(data) {
		// Note: The actual ArrayBuffer transfer happens via postMessage transfer mechanism
		// This handler just provides metadata about the buffer
		// The real ArrayBuffer will be provided by the message transfer system
		// We need to return a placeholder that will be replaced with the actual buffer
		// during the message deserialization process
		return new ArrayBuffer(0) // Placeholder - will be replaced during transfer
	},
}

/**
 * Register built-in transfer handlers
 */
transferHandlers.set("proxy", proxyTransferHandler)
transferHandlers.set("error", errorTransferHandler)
transferHandlers.set("ArrayBuffer", arrayBufferTransferHandler)

/**
 * Converts a value to a wire format using transfer handlers.
 * Similar to Comlink's toWireValue but adapted for kkrpc.
 *
 * @param value - The value to convert
 * @returns Array containing the serialized value and transferables
 */
export function toWireValue(value: any): [any, any[]] {
	// Check transfer handlers first
	for (const [name, handler] of transferHandlers) {
		if (handler.canHandle(value)) {
			const serializedValue = handler.serialize(value)
			return [
				{
					type: "handler",
					name,
					value: serializedValue,
				},
				getTransferables(value),
			]
		}
	}
	
	// Fall back to default serialization
	return [
		{
			type: "raw",
			value,
		},
		getTransferables(value),
	]
}

/**
 * Converts a wire format value back to its original form.
 * Similar to Comlink's fromWireValue but adapted for kkrpc.
 *
 * @param value - The wire format value
 * @returns The deserialized value
 */
export function fromWireValue(value: any): any {
	switch (value.type) {
		case "handler":
			const handler = transferHandlers.get(value.name)
			if (!handler) {
				throw new Error(`Unknown transfer handler: ${value.name}`)
			}
			return handler.deserialize(value.value)
		case "raw":
			return value.value
		default:
			throw new Error(`Unknown wire value type: ${(value as any).type}`)
	}
}

function replacer(key: string, value: any) {
	if (value instanceof Uint8Array) {
		return {
			type: "Uint8Array",
			data: Array.from(value) // Convert to regular array
		}
	}
	return value
}

function reviver(key: string, value: any) {
	if (value && value.type === "Uint8Array" && Array.isArray(value.data)) {
		return new Uint8Array(value.data)
	}
	return value
}

/**
 * Serialize an Error object to an EnhancedError that can be transmitted
 * @param error - The Error object to serialize
 * @returns EnhancedError object
 */
export function serializeError(error: Error): EnhancedError {
	const enhanced: EnhancedError = {
		name: error.name,
		message: error.message
	}

	// Include stack trace if available
	if (error.stack) {
		enhanced.stack = error.stack
	}

	// Include cause if available (modern Error API)
	if ('cause' in error && error.cause !== undefined) {
		enhanced.cause = error.cause
	}

	// Include any custom properties
	for (const key in error) {
		if (key !== 'name' && key !== 'message' && key !== 'stack' && key !== 'cause') {
			enhanced[key] = (error as any)[key]
		}
	}

	return enhanced
}

/**
 * Deserialize an EnhancedError back into an Error object
 * @param enhanced - The EnhancedError to deserialize
 * @returns Error object
 */
export function deserializeError(enhanced: EnhancedError): Error {
	const error = new Error(enhanced.message)
	error.name = enhanced.name

	// Restore stack trace if available
	if (enhanced.stack) {
		error.stack = enhanced.stack
	}

	// Restore cause if available
	if (enhanced.cause !== undefined) {
		(error as any).cause = enhanced.cause
	}

	// Restore custom properties
	for (const key in enhanced) {
		if (key !== 'name' && key !== 'message' && key !== 'stack' && key !== 'cause') {
			(error as any)[key] = enhanced[key]
		}
	}

	return error
}

/**
 * Process arguments using transfer handlers before serialization.
 * @param args - Arguments to process
 * @returns Processed arguments and transferables
 */
function processArguments(args: any[]): [any[], any[]] {
	const processed = args.map(toWireValue)
	const transferables = processed.flatMap(([, transfers]) => transfers)
	const serializedArgs = processed.map(([value]) => value)
	
	// Deduplicate transferables to avoid "duplicate transferable" errors
	const uniqueTransferables = Array.from(new Set(transferables))
	
	return [serializedArgs, uniqueTransferables]
}

/**
 * Serialize a message with superjson (supports all data types supported by superjson)
 * Enhanced with transfer handler support.
 * @param message - The message to serialize, an object of any shape
 * @param options - Serialization options, default to use superjson
 * @returns Object containing the serialized message and transferables
 */
export function serializeMessage<T>(
	message: Message<T>,
	options: SerializationOptions = {}
): { data: string; transfers: any[] } {
	const version = options.version || "superjson"
	
	// Process message arguments using transfer handlers
	let processedMessage = { ...message }
	let allTransfers: any[] = []
	
	// Handle args if present
	if (message.args) {
		if (Array.isArray(message.args)) {
			const [processedArgs, transfers] = processArguments(message.args)
			processedMessage.args = processedArgs as T
			allTransfers.push(...transfers)
		} else {
			// Handle non-array args (like in get/set operations)
			const [processedValue, transfers] = toWireValue(message.args)
			processedMessage.args = processedValue as T
			allTransfers.push(...transfers)
		}
	}
	
	// Handle value if present (for set operations)
	if (message.value !== undefined) {
		const [processedValue, transfers] = toWireValue(message.value)
		processedMessage.value = processedValue
		allTransfers.push(...transfers)
	}
	
	// Handle result in response messages
	if (message.type === "response" && message.args && typeof message.args === "object") {
		const responseArgs = message.args as any
		if (responseArgs.result !== undefined) {
			const [processedResult, transfers] = toWireValue(responseArgs.result)
			responseArgs.result = processedResult
			allTransfers.push(...transfers)
		}
		if (responseArgs.error !== undefined) {
			const [processedError, transfers] = toWireValue(responseArgs.error)
			responseArgs.error = processedError
			allTransfers.push(...transfers)
		}
	}
	
	// Extract and validate transferables if in a browser environment
	if (isTransferableSupported()) {
		// Extract transferables from the entire message
		const extractedTransferables = extractTransferables(processedMessage)
		
		// Combine with existing transferables and deduplicate
		const combinedTransfers = [...allTransfers, ...extractedTransferables]
		allTransfers = Array.from(new Set(combinedTransfers))
		
		// Validate all transferables
		if (allTransfers.length > 0) {
			try {
				validateTransferables(allTransfers)
			} catch (error) {
				console.warn("Transferable validation failed:", error)
				// Filter out non-transferable objects
				allTransfers = allTransfers.filter(isTransferable)
			}
		}
	}
	
	const msgWithVersion = { ...processedMessage, version }
	const serialized = version === "json"
		? JSON.stringify(msgWithVersion, replacer) + "\n"
		: superjson.stringify(msgWithVersion) + "\n"
	
	return { data: serialized, transfers: allTransfers }
}

/**
 * Deserialize a message with superjson (supports all data types supported by superjson)
 * Enhanced with transfer handler support.
 * @param message - The serialized message
 * @returns Promise that resolves to the deserialized message
 */
export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			let parsed: Message<T>
			
			// Check if the message starts with a superjson marker
			if (message.startsWith('{"json":')) {
				parsed = superjson.parse<Message<T>>(message)
			} else {
				// Assume it's regular JSON for backward compatibility
				parsed = JSON.parse(message, reviver) as Message<T>
			}
			
			// Process deserialized values using transfer handlers
			let processedMessage = { ...parsed }
			
			// Handle args if present
			if (parsed.args) {
				if (Array.isArray(parsed.args)) {
					processedMessage.args = parsed.args.map(fromWireValue) as T
				} else {
					processedMessage.args = fromWireValue(parsed.args) as T
				}
			}
			
			// Handle value if present (for get/set operations)
			if (parsed.value !== undefined) {
				processedMessage.value = fromWireValue(parsed.value)
			}
			
			// Handle result in response messages
			if (parsed.type === "response" && parsed.args && typeof parsed.args === "object") {
				const responseArgs = parsed.args as any
				if (responseArgs.result !== undefined) {
					responseArgs.result = fromWireValue(responseArgs.result)
				}
				if (responseArgs.error !== undefined) {
					responseArgs.error = fromWireValue(responseArgs.error)
				}
			}
			
			resolve(processedMessage)
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}
