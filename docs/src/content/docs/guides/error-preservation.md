---
title: Enhanced Error Preservation
description: Complete error object preservation across RPC boundaries
sidebar:
  order: 3
---

kkrpc provides enhanced error preservation that maintains complete error information when exceptions are thrown across RPC boundaries. This includes error names, messages, stack traces, causes, and custom properties.

## Features

- **Complete Error Preservation**: Name, message, stack trace, and custom properties
- **Error Causes**: Support for modern Error API with `{ cause }` option
- **Custom Error Classes**: Maintains inheritance and custom properties
- **Stack Traces**: Preserves original stack traces for debugging
- **Custom Properties**: Any additional properties on error objects
- **Nested Errors**: Support for error chains and complex error structures

## How It Works

Error preservation is implemented through enhanced serialization and deserialization:

1. **Error Serialization**: `serializeError()` converts Error objects to `EnhancedError` interface
2. **Property Extraction**: Iterates over all enumerable properties on the error object
3. **Transmission**: Sends the serialized error data over RPC
4. **Deserialization**: `deserializeError()` reconstructs Error objects with all properties
5. **Type Preservation**: Maintains error names and custom properties

## Basic Usage

### Simple Error Handling

```typescript
// API that throws errors
export const apiImplementation = {
	async divide(a: number, b: number) {
		if (b === 0) {
			throw new Error("Division by zero")
		}
		return a / b
	}
}

// Client side error handling
try {
	const result = await api.divide(10, 0)
} catch (error) {
	console.log(error.name) // "Error"
	console.log(error.message) // "Division by zero"
	console.log(error.stack) // Full stack trace preserved
}
```

### Custom Error Classes

```typescript
// Define custom error classes
class ValidationError extends Error {
	constructor(
		message: string,
		public field: string,
		public code: number
	) {
		super(message)
		this.name = "ValidationError"
	}
}

class DatabaseError extends Error {
	constructor(
		message: string,
		public query: string,
		public code: number,
		public retryable: boolean = false
	) {
		super(message)
		this.name = "DatabaseError"
	}
}

// API implementation with custom errors
export const apiImplementation = {
	async createUser(userData: any) {
		if (!userData.email) {
			throw new ValidationError("Email is required", "email", 400)
		}

		try {
			// Database operation
			const query = "INSERT INTO users (email) VALUES (?)"
			// ... database logic
		} catch (dbError) {
			throw new DatabaseError(
				"Failed to create user",
				query,
				500,
				true // retryable
			)
		}
	}
}

// Client side handling
try {
	await api.createUser({ name: "John" }) // Missing email
} catch (error) {
	if (error.name === "ValidationError") {
		console.log(`Validation failed for field: ${error.field}`)
		console.log(`Error code: ${error.code}`)
	} else if (error.name === "DatabaseError") {
		console.log(`Database error: ${error.message}`)
		console.log(`Failed query: ${error.query}`)
		if (error.retryable) {
			console.log("Operation can be retried")
		}
	}
}
```

## Advanced Features

### Error Causes (Modern Error API)

```typescript
// API with error causes
export const apiImplementation = {
	async processPayment(amount: number) {
		try {
			await this.validatePayment(amount)
		} catch (validationError) {
			// Chain errors with cause
			throw new Error("Payment processing failed", {
				cause: validationError
			})
		}
	},

	async validatePayment(amount: number) {
		if (amount <= 0) {
			throw new Error("Amount must be positive")
		}
		// ... more validation
	}
}

// Client side
try {
	await api.processPayment(-100)
} catch (error) {
	console.log(error.message) // "Payment processing failed"
	console.log(error.cause.message) // "Amount must be positive"

	// Walk the error chain
	let currentError = error
	while (currentError.cause) {
		console.log(`Caused by: ${currentError.cause.message}`)
		currentError = currentError.cause
	}
}
```

### Custom Error Properties

```typescript
// Network error with detailed information
class NetworkError extends Error {
	constructor(
		message: string,
		public url: string,
		public statusCode: number,
		public method: string
	) {
		super(message)
		this.name = "NetworkError"
	}
}

// API with detailed error context
export const apiImplementation = {
	async fetchUserData(userId: string) {
		const error = new NetworkError(
			"Failed to fetch user data",
			`https://api.example.com/users/${userId}`,
			404,
			"GET"
		)

		// Add custom properties
		error.timestamp = new Date().toISOString()
		error.requestId = generateRequestId()
		error.userId = userId
		error.retryCount = 3
		error.headers = {
			"Content-Type": "application/json",
			Authorization: "Bearer ***"
		}

		throw error
	}
}

// Client side
try {
	await api.fetchUserData("invalid-id")
} catch (error) {
	console.log(error.name) // "NetworkError"
	console.log(error.url) // "https://api.example.com/users/invalid-id"
	console.log(error.statusCode) // 404
	console.log(error.method) // "GET"
	console.log(error.timestamp) // ISO timestamp
	console.log(error.requestId) // Request ID
	console.log(error.userId) // "invalid-id"
	console.log(error.retryCount) // 3
	console.log(error.headers) // Headers object
}
```

### Complex Error Structures

```typescript
// Multi-level error with nested information
export const apiImplementation = {
	async processBatch(items: any[]) {
		const errors = []

		for (let i = 0; i < items.length; i++) {
			try {
				await this.processItem(items[i])
			} catch (itemError) {
				errors.push({
					index: i,
					item: items[i],
					error: itemError
				})
			}
		}

		if (errors.length > 0) {
			const batchError = new Error(`Failed to process ${errors.length} items`)
			batchError.name = "BatchProcessingError"
			batchError.failedItems = errors
			batchError.totalItems = items.length
			batchError.successCount = items.length - errors.length
			batchError.failureRate = errors.length / items.length

			throw batchError
		}
	}
}

// Client side
try {
	await api.processBatch(items)
} catch (error) {
	if (error.name === "BatchProcessingError") {
		console.log(`${error.successCount}/${error.totalItems} items processed successfully`)
		console.log(`Failure rate: ${(error.failureRate * 100).toFixed(1)}%`)

		error.failedItems.forEach(({ index, item, error: itemError }) => {
			console.log(`Item ${index} failed:`, itemError.message)
		})
	}
}
```

## Error Serialization Details

### EnhancedError Interface

```typescript
interface EnhancedError {
	name: string
	message: string
	stack?: string
	cause?: any
	[key: string]: any // Custom properties
}
```

### Serialization Process

```typescript
// Example of what happens internally
function serializeError(error: Error): EnhancedError {
	const enhanced: EnhancedError = {
		name: error.name,
		message: error.message
	}

	// Include stack trace
	if (error.stack) {
		enhanced.stack = error.stack
	}

	// Include cause (modern Error API)
	if ("cause" in error && error.cause !== undefined) {
		enhanced.cause = error.cause
	}

	// Include custom properties
	for (const key in error) {
		if (key !== "name" && key !== "message" && key !== "stack" && key !== "cause") {
			enhanced[key] = (error as any)[key]
		}
	}

	return enhanced
}
```

## Best Practices

### 1. Use Specific Error Types

```typescript
// Good: Specific error types
class ValidationError extends Error {
	/* ... */
}
class AuthenticationError extends Error {
	/* ... */
}
class DatabaseError extends Error {
	/* ... */
}

// Less ideal: Generic errors
throw new Error("Something went wrong")
```

### 2. Include Useful Context

```typescript
// Good: Rich error context
const error = new DatabaseError("Query failed", query, 500)
error.timestamp = Date.now()
error.connectionId = conn.id
error.retryAttempt = retryCount

// Less ideal: Minimal context
throw new Error("Database error")
```

### 3. Handle Error Types Appropriately

```typescript
try {
	await api.someOperation()
} catch (error) {
	switch (error.name) {
		case "ValidationError":
			// Show user-friendly validation messages
			showValidationErrors(error.field, error.message)
			break

		case "AuthenticationError":
			// Redirect to login
			redirectToLogin()
			break

		case "NetworkError":
			// Show retry option
			if (error.retryable) {
				showRetryButton()
			}
			break

		default:
			// Log unexpected errors
			console.error("Unexpected error:", error)
			showGenericErrorMessage()
	}
}
```

### 4. Error Logging and Monitoring

```typescript
// Centralized error handling
function handleRPCError(error: any, context: string) {
	// Log error with full context
	logger.error({
		message: error.message,
		name: error.name,
		stack: error.stack,
		cause: error.cause,
		context,
		timestamp: new Date().toISOString(),
		...error // Include all custom properties
	})

	// Report to monitoring service
	errorReporter.report(error, { context })
}

// Usage
try {
	await api.criticalOperation()
} catch (error) {
	handleRPCError(error, "critical-operation")
	throw error // Re-throw if needed
}
```

## Limitations

1. **Circular References**: Handled gracefully but may lose some nested data
2. **Function Properties**: Functions on error objects cannot be serialized
3. **Prototype Chain**: Only enumerable properties are preserved
4. **Large Objects**: Very large error objects may impact performance

## Error Testing

```typescript
// Test error preservation
describe("Error Preservation", () => {
	test("preserves custom error properties", async () => {
		try {
			await api.throwCustomError()
			fail("Should have thrown an error")
		} catch (error) {
			expect(error.name).toBe("CustomError")
			expect(error.code).toBe(404)
			expect(error.details).toEqual({ field: "userId" })
			expect(error.stack).toBeDefined()
		}
	})

	test("preserves error causes", async () => {
		try {
			await api.throwErrorWithCause()
		} catch (error) {
			expect(error.message).toBe("Operation failed")
			expect(error.cause).toBeDefined()
			expect(error.cause.message).toBe("Root cause")
		}
	})
})
```

Enhanced error preservation in kkrpc ensures that debugging and error handling remain effective across distributed systems, maintaining the same level of detail as local error handling.
