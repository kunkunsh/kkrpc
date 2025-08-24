import superjson from "superjson"

/**
 * This file contains the serialization and deserialization functions for the RPC protocol.
 */
export interface Message<T = any> {
	id: string
	method: string
	args: T
	type: "request" | "response" | "callback" | "get" | "set" | "construct" // Extended message types
	callbackIds?: string[] // Add callbackIds field
	version?: "json" | "superjson" // Add version field for backward compatibility
	path?: string[] // Property path for get/set operations
	value?: any // Value for set operations
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
 * Serialize a message with superjson (supports all data types supported by superjson)
 * @param message - The message to serialize, an object of any shape
 * @param options - Serialization options, default to use superjson
 * @returns The serialized message
 */
export function serializeMessage<T>(
	message: Message<T>,
	options: SerializationOptions = {}
): string {
	const version = options.version || "superjson"
	const msgWithVersion = { ...message, version }
	return version === "json"
		? JSON.stringify(msgWithVersion, replacer) + "\n"
		: superjson.stringify(msgWithVersion) + "\n"
}

/**
 * Deserialize a message with superjson (supports all data types supported by superjson)
 * @param message - The serialized message
 * @returns The deserialized message
 */
export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			// Check if the message starts with a superjson marker
			if (message.startsWith('{"json":')) {
				const parsed = superjson.parse<Message<T>>(message)
				resolve(parsed)
			} else {
				// Assume it's regular JSON for backward compatibility
				const parsed = JSON.parse(message, reviver) as Message<T>
				resolve(parsed)
			}
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}
