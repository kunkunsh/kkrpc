---
title: Advanced Features Example
description: Complete example showcasing property access and error preservation
sidebar:
  order: 4
---

This example demonstrates how to use kkrpc's advanced features including property access and enhanced error preservation in a real-world scenario.

## Complete Example: User Management System

### API Definition

```typescript
// types.ts
export interface User {
	id: string
	name: string
	email: string
	settings: {
		theme: "light" | "dark"
		notifications: {
			email: boolean
			push: boolean
			frequency: "immediate" | "daily" | "weekly"
		}
		preferences: {
			language: string
			timezone: string
		}
	}
}

export interface SystemStats {
	activeUsers: number
	totalUsers: number
	systemHealth: "healthy" | "warning" | "error"
	lastUpdate: string
}

// Custom error classes
export class ValidationError extends Error {
	constructor(
		message: string,
		public field: string,
		public code: number
	) {
		super(message)
		this.name = "ValidationError"
	}
}

export class UserNotFoundError extends Error {
	constructor(userId: string) {
		super(`User with ID ${userId} not found`)
		this.name = "UserNotFoundError"
		this.userId = userId
		this.statusCode = 404
	}
}

export class DatabaseError extends Error {
	constructor(
		message: string,
		public operation: string,
		public query?: string,
		public retryable: boolean = false
	) {
		super(message)
		this.name = "DatabaseError"
	}
}

// Main API interface
export interface UserManagementAPI {
	// Methods
	createUser(userData: Omit<User, "id">): Promise<User>
	getUserById(id: string): Promise<User>
	updateUser(id: string, updates: Partial<User>): Promise<User>
	deleteUser(id: string): Promise<boolean>
	searchUsers(query: string): Promise<User[]>

	// Properties (accessible via property access)
	currentUser: User | null
	isAuthenticated: boolean
	systemStats: SystemStats

	// Nested objects with mixed properties and methods
	settings: {
		defaultTheme: "light" | "dark"
		allowRegistration: boolean
		maxUsers: number

		// Methods
		updateDefaults(defaults: any): Promise<void>
		resetToFactoryDefaults(): Promise<void>
	}

	// Complex nested structure
	cache: {
		stats: {
			hitRate: number
			missRate: number
			totalRequests: number
		}
		clear(): Promise<void>
		warmUp(): Promise<void>
	}
}
```

### API Implementation

```typescript
// api-implementation.ts
import {
	DatabaseError,
	SystemStats,
	User,
	UserManagementAPI,
	UserNotFoundError,
	ValidationError
} from "./types"

// Mock database
const users = new Map<string, User>()
const systemSettings = {
	defaultTheme: "light" as const,
	allowRegistration: true,
	maxUsers: 1000
}

let currentUser: User | null = null
let cacheStats = {
	hitRate: 0.85,
	missRate: 0.15,
	totalRequests: 1250
}

export const userManagementAPI: UserManagementAPI = {
	// Method implementations
	async createUser(userData) {
		// Validation with detailed errors
		if (!userData.email || !userData.email.includes("@")) {
			const error = new ValidationError("Invalid email address", "email", 400)
			error.providedValue = userData.email
			error.expectedFormat = "user@domain.com"
			throw error
		}

		if (!userData.name || userData.name.length < 2) {
			const error = new ValidationError("Name must be at least 2 characters", "name", 400)
			error.providedValue = userData.name
			error.minLength = 2
			throw error
		}

		// Check system limits
		if (users.size >= systemSettings.maxUsers) {
			const error = new Error("Maximum user limit reached")
			error.name = "SystemLimitError"
			error.currentCount = users.size
			error.maxAllowed = systemSettings.maxUsers
			throw error
		}

		try {
			const user: User = {
				id: `user_${Date.now()}`,
				...userData,
				settings: {
					theme: systemSettings.defaultTheme,
					notifications: {
						email: true,
						push: true,
						frequency: "daily"
					},
					preferences: {
						language: "en",
						timezone: "UTC"
					},
					...userData.settings
				}
			}

			users.set(user.id, user)
			return user
		} catch (dbError) {
			const error = new DatabaseError(
				"Failed to create user in database",
				"INSERT",
				"INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
				true // retryable
			)
			error.cause = dbError
			error.timestamp = new Date().toISOString()
			throw error
		}
	},

	async getUserById(id) {
		if (!id || typeof id !== "string") {
			const error = new ValidationError("User ID is required", "id", 400)
			error.providedValue = id
			error.expectedType = "string"
			throw error
		}

		const user = users.get(id)
		if (!user) {
			const error = new UserNotFoundError(id)
			error.availableIds = Array.from(users.keys())
			error.searchSuggestions = Array.from(users.values())
				.filter((u) => u.name.toLowerCase().includes(id.toLowerCase()))
				.map((u) => ({ id: u.id, name: u.name }))
			throw error
		}

		return user
	},

	async updateUser(id, updates) {
		const user = await this.getUserById(id) // Reuse existing validation

		try {
			const updatedUser = { ...user, ...updates }
			users.set(id, updatedUser)

			// Update current user if it's the same
			if (currentUser?.id === id) {
				currentUser = updatedUser
			}

			return updatedUser
		} catch (dbError) {
			const error = new DatabaseError(
				"Failed to update user",
				"UPDATE",
				`UPDATE users SET data = ? WHERE id = '${id}'`
			)
			error.cause = dbError
			error.userId = id
			error.attemptedUpdates = updates
			throw error
		}
	},

	async deleteUser(id) {
		const user = await this.getUserById(id) // Reuse validation

		try {
			const deleted = users.delete(id)

			// Clear current user if deleted
			if (currentUser?.id === id) {
				currentUser = null
			}

			return deleted
		} catch (dbError) {
			const error = new DatabaseError(
				"Failed to delete user",
				"DELETE",
				`DELETE FROM users WHERE id = '${id}'`
			)
			error.cause = dbError
			error.userId = id
			throw error
		}
	},

	async searchUsers(query) {
		if (!query || query.length < 2) {
			const error = new ValidationError("Search query must be at least 2 characters", "query", 400)
			error.providedValue = query
			error.minLength = 2
			throw error
		}

		const results = Array.from(users.values()).filter(
			(user) =>
				user.name.toLowerCase().includes(query.toLowerCase()) ||
				user.email.toLowerCase().includes(query.toLowerCase())
		)

		return results
	},

	// Property implementations
	get currentUser() {
		return currentUser
	},

	set currentUser(user: User | null) {
		currentUser = user
	},

	get isAuthenticated() {
		return currentUser !== null
	},

	set isAuthenticated(value: boolean) {
		if (!value) {
			currentUser = null
		}
	},

	get systemStats(): SystemStats {
		return {
			activeUsers: Array.from(users.values()).filter((u) => u.id === currentUser?.id).length,
			totalUsers: users.size,
			systemHealth: users.size > systemSettings.maxUsers * 0.9 ? "warning" : "healthy",
			lastUpdate: new Date().toISOString()
		}
	},

	// Nested objects
	settings: {
		get defaultTheme() {
			return systemSettings.defaultTheme
		},

		set defaultTheme(theme: "light" | "dark") {
			systemSettings.defaultTheme = theme
		},

		get allowRegistration() {
			return systemSettings.allowRegistration
		},

		set allowRegistration(value: boolean) {
			systemSettings.allowRegistration = value
		},

		get maxUsers() {
			return systemSettings.maxUsers
		},

		set maxUsers(value: number) {
			if (value < 1) {
				const error = new ValidationError("Max users must be at least 1", "maxUsers", 400)
				error.providedValue = value
				error.minimumValue = 1
				throw error
			}
			systemSettings.maxUsers = value
		},

		async updateDefaults(defaults) {
			Object.assign(systemSettings, defaults)
		},

		async resetToFactoryDefaults() {
			systemSettings.defaultTheme = "light"
			systemSettings.allowRegistration = true
			systemSettings.maxUsers = 1000
		}
	},

	cache: {
		get stats() {
			return { ...cacheStats }
		},

		async clear() {
			cacheStats.totalRequests = 0
			cacheStats.hitRate = 0
			cacheStats.missRate = 0
		},

		async warmUp() {
			// Simulate cache warming
			cacheStats.hitRate = 0.95
			cacheStats.missRate = 0.05
			cacheStats.totalRequests += 100
		}
	}
}
```

### Client Usage Examples

```typescript
// client.ts
import { RPCChannel, WorkerParentIO } from "kkrpc"
import { DatabaseError, UserManagementAPI, UserNotFoundError, ValidationError } from "./types"

// Set up RPC connection
const worker = new Worker("./api-worker.ts", { type: "module" })
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel<{}, UserManagementAPI>(io)
const api = rpc.getAPI()

async function demonstrateFeatures() {
	try {
		// === PROPERTY ACCESS EXAMPLES ===

		console.log("=== Property Access Demo ===")

		// Read system stats
		const stats = await api.systemStats
		console.log("System Stats:", stats)

		// Check authentication status
		const isAuth = await api.isAuthenticated
		console.log("Is Authenticated:", isAuth)

		// Access nested properties
		const defaultTheme = await api.settings.defaultTheme
		const allowReg = await api.settings.allowRegistration
		const maxUsers = await api.settings.maxUsers

		console.log("Settings:", { defaultTheme, allowReg, maxUsers })

		// Modify properties
		api.settings.defaultTheme = "dark"
		api.settings.maxUsers = 500

		// Verify changes
		console.log("New default theme:", await api.settings.defaultTheme)
		console.log("New max users:", await api.settings.maxUsers)

		// Access cache stats
		const cacheStats = await api.cache.stats
		console.log("Cache Stats:", cacheStats)

		// === METHOD CALLS WITH ERROR HANDLING ===

		console.log("\\n=== Method Calls with Error Handling ===")

		// Create a user successfully
		try {
			const newUser = await api.createUser({
				name: "John Doe",
				email: "john@example.com",
				settings: {
					theme: "dark",
					notifications: {
						email: true,
						push: false,
						frequency: "weekly"
					},
					preferences: {
						language: "en",
						timezone: "PST"
					}
				}
			})

			console.log("Created user:", newUser)

			// Set as current user via property
			api.currentUser = newUser
			console.log("Current user set:", await api.currentUser)
		} catch (error) {
			console.error("Failed to create user:", error)
		}

		// === ERROR HANDLING EXAMPLES ===

		console.log("\\n=== Error Handling Examples ===")

		// Validation error example
		try {
			await api.createUser({
				name: "X", // Too short
				email: "invalid-email", // Invalid format
				settings: {
					theme: "light",
					notifications: { email: true, push: true, frequency: "daily" },
					preferences: { language: "en", timezone: "UTC" }
				}
			})
		} catch (error) {
			if (error.name === "ValidationError") {
				console.log("Validation Error Details:")
				console.log("- Field:", error.field)
				console.log("- Code:", error.code)
				console.log("- Provided Value:", error.providedValue)
				console.log("- Expected Format:", error.expectedFormat)
				console.log("- Min Length:", error.minLength)
			}
		}

		// User not found error
		try {
			await api.getUserById("nonexistent-id")
		} catch (error) {
			if (error.name === "UserNotFoundError") {
				console.log("User Not Found Error Details:")
				console.log("- User ID:", error.userId)
				console.log("- Status Code:", error.statusCode)
				console.log("- Available IDs:", error.availableIds)
				console.log("- Search Suggestions:", error.searchSuggestions)
			}
		}

		// System limit error
		try {
			// Set max users to 1 to trigger limit
			api.settings.maxUsers = 1

			// Try to create another user
			await api.createUser({
				name: "Jane Doe",
				email: "jane@example.com",
				settings: {
					theme: "light",
					notifications: { email: true, push: true, frequency: "daily" },
					preferences: { language: "en", timezone: "UTC" }
				}
			})
		} catch (error) {
			if (error.name === "SystemLimitError") {
				console.log("System Limit Error Details:")
				console.log("- Current Count:", error.currentCount)
				console.log("- Max Allowed:", error.maxAllowed)
			}
		}

		// Database error simulation
		try {
			// This would trigger a database error in a real scenario
			await api.updateUser("some-id", { name: "Updated Name" })
		} catch (error) {
			if (error.name === "DatabaseError") {
				console.log("Database Error Details:")
				console.log("- Operation:", error.operation)
				console.log("- Query:", error.query)
				console.log("- Retryable:", error.retryable)
				console.log("- Timestamp:", error.timestamp)
				console.log("- Cause:", error.cause)
			} else if (error.name === "UserNotFoundError") {
				console.log("User not found for update")
			}
		}

		// === MIXED OPERATIONS ===

		console.log("\\n=== Mixed Operations ===")

		// Search users (method call)
		try {
			const searchResults = await api.searchUsers("john")
			console.log("Search results:", searchResults)
		} catch (error) {
			if (error.name === "ValidationError") {
				console.log("Search query too short:", error.message)
			}
		}

		// Clear cache (nested method)
		await api.cache.clear()
		console.log("Cache cleared, new stats:", await api.cache.stats)

		// Warm up cache (nested method)
		await api.cache.warmUp()
		console.log("Cache warmed up, new stats:", await api.cache.stats)

		// Reset settings (nested method)
		await api.settings.resetToFactoryDefaults()
		console.log("Settings reset to defaults")
		console.log("Default theme:", await api.settings.defaultTheme)
		console.log("Max users:", await api.settings.maxUsers)

		// Property validation error
		try {
			api.settings.maxUsers = -5 // Invalid value
		} catch (error) {
			if (error.name === "ValidationError") {
				console.log("Property validation error:", error.message)
				console.log("Provided value:", error.providedValue)
				console.log("Minimum value:", error.minimumValue)
			}
		}
	} catch (error) {
		console.error("Unexpected error:", error)
		console.error("Error details:", {
			name: error.name,
			message: error.message,
			stack: error.stack,
			...error // All custom properties
		})
	}
}

// Run the demonstration
demonstrateFeatures()
```

### Worker Implementation

```typescript
// api-worker.ts
import { RPCChannel, WorkerChildIO } from "kkrpc"
import { userManagementAPI, UserManagementAPI } from "./api-implementation"

const io = new WorkerChildIO()
const rpc = new RPCChannel<UserManagementAPI, {}>(io, {
	expose: userManagementAPI
})

// Worker is now ready to handle RPC calls
console.log("User Management API Worker ready")
```

## Key Features Demonstrated

### 1. Property Access

- Simple properties: `await api.isAuthenticated`
- Nested properties: `await api.settings.defaultTheme`
- Deep nesting: `await api.cache.stats.hitRate`
- Property setters: `api.settings.maxUsers = 500`

### 2. Enhanced Error Preservation

- Custom error classes with inheritance
- Error properties and metadata preservation
- Error causes and chaining
- Detailed validation errors with context

### 3. Mixed Operations

- Combining property access with method calls
- Nested objects with both properties and methods
- Real-time property updates affecting method behavior

### 4. Type Safety

- Full TypeScript support for all operations
- IntelliSense for nested properties and methods
- Type checking for property assignments
- Error type discrimination

This example showcases how kkrpc's advanced features work together to create a seamless development experience for distributed applications while maintaining the same level of functionality as local object manipulation.
