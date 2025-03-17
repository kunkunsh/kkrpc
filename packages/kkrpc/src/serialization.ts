import superjson from "superjson"

/**
 * This file contains the serialization and deserialization functions for the RPC protocol.
 */
export interface Message<T = any> {
	id: string
	method: string
	args: T
	type: "request" | "response" | "callback" // Add "callback" type
	callbackIds?: string[] // Add callbackIds field
}

export interface Response<T = any> {
	result?: T
	error?: string
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
 * Serialize a message with superjson (supports all data types supported by superjson)
 * @param message - The message to serialize, an object of any shape
 * @returns The serialized message
 */
export function serializeMessage<T>(message: Message<T>): string {
	return superjson.stringify(message) + "\n"
}

/**
 * Deserialize a message with superjson (supports all data types supported by superjson)
 * @param message - The serialized message
 * @returns The deserialized message
 */
export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			const parsed = superjson.parse<Message<T>>(message)
			resolve(parsed)
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}

/**
 * Serialize a response with JSON (only supports primitive types)
 * @param response - The response to serialize, an object of primitive types
 * @returns The serialized response
 */
export function serializeResponse<T>(response: Response<T>): string {
	return superjson.stringify(response) + "\n"
}

/**
 * Deserialize a response with superjson (supports all data types supported by superjson)
 * @param response - The serialized response
 * @returns The deserialized response
 */
export function deserializeResponse<T>(response: string): Promise<Response<T>> {
	return new Promise((resolve, reject) => {
		try {
			const parsed = superjson.parse<Response<T>>(response)
			resolve(parsed)
		} catch (error) {
			console.error("failed to parse response", response)
			reject(error)
		}
	})
}
