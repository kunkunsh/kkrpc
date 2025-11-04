---
title: Property Access
description: Remote property getters and setters with kkrpc
sidebar:
  order: 2
---

kkrpc supports direct property access and mutation across RPC boundaries using JavaScript Proxy objects. This enables you to read and write remote object properties as if they were local, with full TypeScript support.

## Features

- **Property Getters**: Access remote properties with `await api.property`
- **Property Setters**: Set remote properties with `api.property = value`
- **Nested Properties**: Deep property access with dot notation `api.nested.deep.property`
- **Type Safety**: Full TypeScript inference and IDE autocompletion
- **Async/Await Support**: Seamless integration with async/await syntax

## How It Works

Property access is implemented using JavaScript Proxy objects with custom get and set traps:

1. **Property Access**: When you access a property like `api.counter`, a proxy returns another proxy
2. **Await Trigger**: Using `await api.counter` triggers the proxy's "then" handler
3. **RPC Message**: This sends a "get" type message to the remote endpoint
4. **Property Setting**: Direct assignment like `api.counter = 42` triggers the proxy's set trap
5. **Remote Execution**: The remote endpoint handles get/set operations on the actual object

## Basic Usage

### API Definition

```typescript
// Define your API interface with properties
export interface API {
	// Methods
	add(a: number, b: number): Promise<number>

	// Simple properties
	counter: number
	status: string

	// Nested objects
	config: {
		theme: string
		language: string
		notifications: {
			enabled: boolean
			sound: boolean
		}
	}

	// Mixed properties and methods
	database: {
		connectionCount: number
		connect(): Promise<void>
		query(sql: string): Promise<any[]>
	}
}

// Implementation
export const apiImplementation: API = {
	add: async (a, b) => a + b,

	counter: 0,
	status: "ready",

	config: {
		theme: "light",
		language: "en",
		notifications: {
			enabled: true,
			sound: false
		}
	},

	database: {
		connectionCount: 0,
		connect: async () => {
			// Connection logic
		},
		query: async (sql) => {
			// Query logic
			return []
		}
	}
}
```

### Property Access Examples

```typescript
const api = rpc.getAPI<API>()

// Property getters (always use await for remote properties)
const currentCount = await api.counter
const theme = await api.config.theme
const notificationsEnabled = await api.config.notifications.enabled
const dbConnections = await api.database.connectionCount

console.log(currentCount) // 0
console.log(theme) // "light"
console.log(notificationsEnabled) // true
console.log(dbConnections) // 0

// Property setters (direct assignment)
api.counter = 42
api.config.theme = "dark"
api.config.notifications.sound = true
api.database.connectionCount = 5

// Verify changes
console.log(await api.counter) // 42
console.log(await api.config.theme) // "dark"
console.log(await api.config.notifications.sound) // true
console.log(await api.database.connectionCount) // 5
```

### Mixing Properties and Methods

```typescript
// Call methods normally
const sum = await api.add(10, 20)
await api.database.connect()
const results = await api.database.query("SELECT * FROM users")

// Access properties with await
const status = await api.status
const connectionCount = await api.database.connectionCount

// Set properties directly
api.status = "connected"
api.database.connectionCount = 10
```

## Advanced Usage

### Dynamic Property Updates

```typescript
// Increment counter remotely
const current = await api.counter
api.counter = current + 1

// Toggle boolean properties
const enabled = await api.config.notifications.enabled
api.config.notifications.enabled = !enabled

// Update nested objects
const config = await api.config
api.config = {
	...config,
	theme: config.theme === "light" ? "dark" : "light"
}
```

### Property Validation

```typescript
// You can add validation in your API implementation
export const apiImplementation: API = {
	_counter: 0,

	get counter() {
		return this._counter
	},

	set counter(value: number) {
		if (typeof value !== "number" || value < 0) {
			throw new Error("Counter must be a non-negative number")
		}
		this._counter = value
	}
}

// Client side error handling
try {
	api.counter = -5 // This will throw an error
} catch (error) {
	console.error("Invalid counter value:", error.message)
}
```

### Reactive Property Updates

```typescript
// API with property change notifications
export const apiImplementation = {
	_config: { theme: "light", language: "en" },
	_listeners: new Set<(config: any) => void>(),

	get config() {
		return this._config
	},

	set config(newConfig) {
		this._config = { ...newConfig }
		// Notify all listeners
		this._listeners.forEach((listener) => listener(this._config))
	},

	onConfigChange(callback: (config: any) => void) {
		this._listeners.add(callback)
	},

	offConfigChange(callback: (config: any) => void) {
		this._listeners.delete(callback)
	}
}

// Client side
api.onConfigChange((newConfig) => {
	console.log("Config changed:", newConfig)
})

api.config = { theme: "dark", language: "es" } // Triggers notification
```

## Type Safety

kkrpc provides full TypeScript support for property access:

```typescript
interface UserAPI {
	currentUser: {
		id: number
		name: string
		preferences: {
			theme: "light" | "dark"
			notifications: boolean
		}
	}
}

const api = rpc.getAPI<UserAPI>()

// TypeScript knows the exact types
const userId: number = await api.currentUser.id
const theme: "light" | "dark" = await api.currentUser.preferences.theme

// TypeScript prevents invalid assignments
api.currentUser.preferences.theme = "invalid" // ❌ TypeScript error
api.currentUser.preferences.theme = "dark" // ✅ Valid
```

## Performance Considerations

1. **Batching**: Each property access results in a separate RPC call
2. **Caching**: Consider caching frequently accessed properties locally
3. **Grouping**: Access multiple related properties in a single method call when possible

```typescript
// Less efficient: Multiple RPC calls
const name = await api.user.name
const email = await api.user.email
const age = await api.user.age

// More efficient: Single RPC call
const getUserInfo = async () => {
	return {
		name: this.user.name,
		email: this.user.email,
		age: this.user.age
	}
}

const userInfo = await api.getUserInfo()
```

## Best Practices

1. **Always use await**: Property getters require `await` for remote access
2. **Minimize round trips**: Group related property accesses when possible
3. **Handle errors**: Wrap property access in try-catch blocks
4. **Use TypeScript**: Leverage type safety for better development experience
5. **Validate inputs**: Add validation logic in property setters
6. **Document behavior**: Clearly document which properties trigger side effects

## Limitations

1. **Serialization**: Properties must be JSON-serializable (or superjson-serializable)
2. **No Getters/Setters**: JavaScript getters/setters on the API object are not directly supported
3. **Performance**: Each property access is a network call
4. **Atomic Operations**: Multiple property updates are not atomic across RPC boundaries

## Error Handling

```typescript
try {
	const value = await api.someProperty
} catch (error) {
	if (error.name === "PropertyNotFoundError") {
		console.log("Property does not exist")
	} else if (error.name === "ValidationError") {
		console.log("Invalid property value")
	} else {
		console.log("Network or other error:", error.message)
	}
}
```

Property access in kkrpc provides a natural and intuitive way to work with remote objects while maintaining type safety and performance considerations.
