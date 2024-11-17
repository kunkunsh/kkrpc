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

// Serialize a message
export function serializeMessage<T>(message: Message<T>): string {
	return JSON.stringify(message) + "\n"
}

// Deserialize a message
export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			const parsed = JSON.parse(message)
			resolve(parsed)
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}

// Serialize a response
export function serializeResponse<T>(response: Response<T>): string {
	return JSON.stringify(response) + "\n"
}

// Deserialize a response
export function deserializeResponse<T>(response: string): Promise<Response<T>> {
	return new Promise((resolve, reject) => {
		try {
			const parsed = JSON.parse(response)
			resolve(parsed)
		} catch (error) {
			console.error("failed to parse response", response)
			reject(error)
		}
	})
}
