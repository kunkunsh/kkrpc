/**
 * Enhanced Error Preservation Tests
 * 
 * This test suite validates the enhanced error serialization and deserialization
 * functionality in kkrpc, ensuring that Error objects maintain their structure,
 * properties, and metadata when transmitted across RPC boundaries.
 * 
 * Features tested:
 * - Simple error serialization with name, message, and stack trace
 * - Custom error classes with additional properties (e.g., error codes)
 * - Error causes (modern Error API with { cause } option)
 * - Custom error properties (timestamps, user IDs, request IDs, etc.)
 * - Complex nested error properties and metadata
 * - Circular reference handling in error properties
 * - Error preservation across real RPC communication
 * - Stress testing with multiple error operations
 * 
 * Implementation details:
 * - `serializeError()` converts Error objects to EnhancedError interface
 * - `deserializeError()` reconstructs Error objects from serialized data
 * - Preserves error.name, error.message, error.stack, error.cause
 * - Handles custom properties by iterating over enumerable properties
 * - Uses (error as any) type assertions for custom properties
 * - Gracefully handles circular references without throwing
 * 
 * Test architecture:
 * - Unit tests for serialization/deserialization functions
 * - Integration tests with real RPC communication using workers
 * - Custom error classes for testing inheritance preservation
 * - Comprehensive error scenarios covering edge cases
 * 
 * Error types tested:
 * - Standard Error objects
 * - Custom error classes (CustomError, NetworkError)
 * - Errors with causes (nested error chains)
 * - Errors with custom metadata properties
 * - Errors with complex object properties
 * 
 * @see {@link ../src/serialization.ts} - serializeError and deserializeError functions
 * @see {@link ../src/channel.ts} - Enhanced error handling in sendError method
 * @see {@link ./scripts/api.ts} - Error throwing methods for testing
 */

import { describe, expect, test } from "bun:test"
import { serializeError, deserializeError, type EnhancedError } from "../src/serialization.ts"
import { RPCChannel, WorkerParentIO, type IoInterface } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

// Custom error classes for testing
class CustomError extends Error {
	constructor(message: string, public code: number) {
		super(message)
		this.name = 'CustomError'
	}
}

class NetworkError extends Error {
	constructor(message: string, public statusCode: number, public url: string) {
		super(message)
		this.name = 'NetworkError'
	}
}

describe("Enhanced Error Preservation Tests", () => {
	test("should serialize and deserialize simple errors", () => {
		const originalError = new Error("Test error message")
		originalError.stack = "Error: Test error message\n    at test (file.js:1:1)"
		
		const serialized = serializeError(originalError)
		const deserialized = deserializeError(serialized)
		
		expect(deserialized.name).toBe("Error")
		expect(deserialized.message).toBe("Test error message")
		expect(deserialized.stack).toBe("Error: Test error message\n    at test (file.js:1:1)")
	})
	
	test("should preserve custom error classes", () => {
		const originalError = new CustomError("Custom error occurred", 404)
		originalError.stack = "CustomError: Custom error occurred\n    at test (file.js:2:2)"
		
		const serialized = serializeError(originalError)
		const deserialized = deserializeError(serialized)
		
		expect(deserialized.name).toBe("CustomError")
		expect(deserialized.message).toBe("Custom error occurred")
		expect(deserialized.stack).toBe("CustomError: Custom error occurred\n    at test (file.js:2:2)")
		expect((deserialized as any).code).toBe(404)
	})
	
	test("should preserve error causes", () => {
		const cause = new Error("Root cause error")
		const originalError = new Error("Main error", { cause })
		
		const serialized = serializeError(originalError)
		const deserialized = deserializeError(serialized)
		
		expect(deserialized.name).toBe("Error")
		expect(deserialized.message).toBe("Main error")
		expect(deserialized.cause).toEqual(cause)
	})
	
	test("should preserve custom error properties", () => {
		const originalError = new Error("Error with custom props")
		;(originalError as any).timestamp = "2024-01-01T00:00:00Z"
		;(originalError as any).userId = "user123"
		;(originalError as any).requestId = "req-456"
		;(originalError as any).metadata = { version: "1.0", build: 123 }
		
		const serialized = serializeError(originalError)
		const deserialized = deserializeError(serialized)
		
		expect(deserialized.name).toBe("Error")
		expect(deserialized.message).toBe("Error with custom props")
		expect((deserialized as any).timestamp).toBe("2024-01-01T00:00:00Z")
		expect((deserialized as any).userId).toBe("user123")
		expect((deserialized as any).requestId).toBe("req-456")
		expect((deserialized as any).metadata).toEqual({ version: "1.0", build: 123 })
	})
	
	test("should handle errors with complex custom properties", () => {
		const originalError = new NetworkError("Network request failed", 500, "https://api.example.com")
		;(originalError as any).headers = { "Content-Type": "application/json" }
		;(originalError as any).responseData = { error: "Internal Server Error" }
		
		const serialized = serializeError(originalError)
		const deserialized = deserializeError(serialized)
		
		expect(deserialized.name).toBe("NetworkError")
		expect(deserialized.message).toBe("Network request failed")
		expect((deserialized as any).statusCode).toBe(500)
		expect((deserialized as any).url).toBe("https://api.example.com")
		expect((deserialized as any).headers).toEqual({ "Content-Type": "application/json" })
		expect((deserialized as any).responseData).toEqual({ error: "Internal Server Error" })
	})
	
	test("should handle error serialization stress test", () => {
		// Test with many errors to ensure performance
		const errors = Array(100).fill(0).map((_, idx) => {
			const error = new Error(`Error ${idx}`)
			;(error as any).index = idx
			;(error as any).data = { value: idx * 2 }
			return error
		})
		
		const serializedErrors = errors.map(serializeError)
		const deserializedErrors = serializedErrors.map(deserializeError)
		
		deserializedErrors.forEach((error, idx) => {
			expect(error.message).toBe(`Error ${idx}`)
			expect((error as any).index).toBe(idx)
			expect((error as any).data).toEqual({ value: idx * 2 })
		})
	})
	
	test("should handle circular references in error properties", () => {
		const originalError = new Error("Error with circular reference")
		const circularObj: any = { name: "circular" }
		circularObj.self = circularObj
		;(originalError as any).circular = circularObj
		
		// Should not throw when serializing
		expect(() => serializeError(originalError)).not.toThrow()
		
		// The circular reference should be handled gracefully
		const serialized = serializeError(originalError)
		expect(serialized.name).toBe("Error")
		expect(serialized.message).toBe("Error with circular reference")
		// The circular property might be simplified or omitted
	})
})

describe("Error Preservation Across RPC Boundaries", () => {
	const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, { type: "module" })
	const io = new WorkerParentIO(worker)
	const rpc = new RPCChannel<API, API, IoInterface>(io, { expose: apiMethods })
	const api = rpc.getAPI()
	
	test("should preserve simple error across RPC boundaries", async () => {
		try {
			await api.throwSimpleError()
			expect(true).toBe(false) // Should not reach here
		} catch (error: any) {
			expect(error.name).toBe("Error")
			expect(error.message).toBe("This is a simple error")
		}
	})
	
	test("should preserve custom error across RPC boundaries", async () => {
		try {
			await api.throwCustomError()
			expect(true).toBe(false) // Should not reach here
		} catch (error: any) {
			expect(error.name).toBe("CustomError")
			expect(error.message).toBe("This is a custom error")
			expect(error.code).toBe(404)
		}
	})
	
	test("should preserve error with cause across RPC boundaries", async () => {
		try {
			await api.throwErrorWithCause()
			expect(true).toBe(false) // Should not reach here
		} catch (error: any) {
			expect(error.name).toBe("Error")
			expect(error.message).toBe("This error has a cause")
			expect(error.cause).toBeDefined()
			expect(error.cause.message).toBe("Root cause")
		}
	})
	
	test("should preserve error with custom properties across RPC boundaries", async () => {
		try {
			await api.throwErrorWithProperties()
			expect(true).toBe(false) // Should not reach here
		} catch (error: any) {
			expect(error.name).toBe("Error")
			expect(error.message).toBe("This error has custom properties")
			expect(error.timestamp).toBeDefined()
			expect(error.userId).toBe("user123")
			expect(error.requestId).toBe("req-456")
		}
	})
	
	test("cleanup", () => {
		io.destroy()
	})
})