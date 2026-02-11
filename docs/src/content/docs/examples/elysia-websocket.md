---
title: Elysia Websocket
---

The Elysia WebSocket adapter provides seamless integration between kkrpc and the [Elysia framework](https://elysiajs.com/) modern TypeScript-first web framework. This adapter enables type-safe, bidirectional RPC communication with access to rich connection metadata and ultra-fast performance powered by uWebSocket.

## Features

- **Modern Framework**: Built on Elysia's TypeScript-first design philosophy
- **Ultra-fast**: Powered by uWebSocket for maximum performance
- **Rich Metadata**: Access to connection info, query parameters, and headers
- **Type-safe**: Full TypeScript inference and autocompletion
- **Runtime Flexible**: Works across Bun, Node.js, and Deno
- **Developer Experience**: Clean API with factory functions
- **Connection Management**: Automatic lifecycle handling with proper cleanup

## Quick Start

### Installation

```bash
# npm
npm install kkrpc elysia

# pnpm
pnpm add kkrpc elysia

# bun
bun add kkrpc elysia
```

### Basic Example

#### Server Setup

```typescript
import { Elysia } from "elysia"
import { ElysiaWebSocketServerIO, RPCChannel } from "kkrpc"

const app = new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)
			const rpc = new RPCChannel(io, {
				expose: {
					greet: (name: string) => `Hello, ${name}!`,
					add: (a: number, b: number) => a + b,
					echo: (data: any) => data
				}
			})
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)

console.log("Elysia server running on port 3000")
```

#### Client Connection

```typescript
import { ElysiaWebSocketClientIO, RPCChannel } from "kkrpc"

const clientIO = new ElysiaWebSocketClientIO("ws://localhost:3000/rpc")
const clientRPC = new RPCChannel(clientIO, {
	expose: {
		// Optional: expose client methods to server
		getClientName: () => "Web Client",
		getClientVersion: () => "1.0.0"
	}
})

const api = clientRPC.getAPI()

// Use the remote API
console.log(await api.greet("World")) // "Hello, World!"
console.log(await api.add(5, 3)) // 8
console.log(await api.echo({ message: "test" })) // { message: 'test' }

clientIO.destroy()
```

## Advanced Usage

### With Rich Connection Metadata

```typescript
import { Elysia } from "elysia"
import { ElysiaWebSocketServerIO, RPCChannel } from "kkrpc"

interface EnhancedAPI {
	// Basic methods
	add(a: number, b: number): Promise<number>
	greet(name: string): Promise<string>

	// Elysia-specific methods
	getConnectionInfo(): Promise<{
		remoteAddress: string | undefined
		query: Record<string, string>
		headers: Record<string, string>
		url: URL | undefined
	}>
}

const app = new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)

			const api: EnhancedAPI = {
				add: (a, b) => a + b,
				greet: (name) => `Hello, ${name}!`,
				getConnectionInfo: async () => ({
					remoteAddress: io.getRemoteAddress(),
					query: io.getQuery(),
					headers: io.getHeaders(),
					url: io.getUrl()
				})
			}

			const rpc = new RPCChannel<EnhancedAPI, EnhancedAPI>(io, {
				expose: api
			})
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)
```

#### Client Usage with Metadata

```typescript
const clientIO = new ElysiaWebSocketClientIO("ws://localhost:3000/rpc?token=abc123&userId=456")
const clientRPC = new RPCChannel(clientIO)
const api = clientRPC.getAPI<EnhancedAPI>()

// Access connection metadata
const connInfo = await api.getConnectionInfo()
console.log("Connected from:", connInfo.remoteAddress)
console.log("Query params:", connInfo.query) // { token: 'abc123', userId: '456' }
console.log("Headers:", connInfo.headers)
console.log("Full URL:", connInfo.url?.toString())
```

### With Factory Functions

```typescript
import { createElysiaWebSocketClientIO, createElysiaWebSocketIO } from "kkrpc"

const app = new Elysia().ws("/rpc", {
	open(ws) {
		const io = createElysiaWebSocketIO(ws) // Factory function
		const rpc = new RPCChannel(io, {
			expose: apiMethods
		})
	},
	message(ws, message) {
		ElysiaWebSocketServerIO.feedMessage(ws, message)
	}
})

// Client side with factory function
const clientIO = createElysiaWebSocketClientIO("ws://localhost:3000/rpc")
```

### With Authentication and Authorization

```typescript
const app = new Elysia().ws("/rpc", {
	open(ws) {
		const io = new ElysiaWebSocketServerIO(ws)
		const headers = io.getHeaders()
		const token = headers.authorization?.replace("Bearer ", "")

		// Validate token
		if (!isValidToken(token)) {
			ws.close(1008, "Invalid token")
			return
		}

		const user = getUserFromToken(token)

		const rpc = new RPCChannel(io, {
			expose: {
				getUserData: () => user.data,
				updateUserProfile: (updates: Partial<UserData>) => {
					return updateUser(user.id, updates)
				},
				// User-specific methods
				getMyOrders: () => getOrdersByUserId(user.id),
				createOrder: (orderData: CreateOrderData) => {
					return createOrder({ ...orderData, userId: user.id })
				}
			}
		})
	},
	message(ws, message) {
		ElysiaWebSocketServerIO.feedMessage(ws, message)
	}
})
```

### With Room-based Communication

```typescript
interface RoomAPI {
	joinRoom(roomId: string): Promise<void>
	leaveRoom(roomId: string): Promise<void>
	sendMessage(roomId: string, message: string): Promise<void>
	getRoomUsers(roomId: string): Promise<string[]>
}

const rooms = new Map<string, Set<string>>()

const app = new Elysia().ws("/rpc", {
	open(ws) {
		const io = new ElysiaWebSocketServerIO(ws)
		const userId = generateUserId()

		const rpc = new RPCChannel<RoomAPI, RoomAPI>(io, {
			expose: {
				async joinRoom(roomId) {
					if (!rooms.has(roomId)) {
						rooms.set(roomId, new Set())
					}
					rooms.get(roomId)!.add(userId)
					broadcastToRoom(roomId, `User ${userId} joined`)
				},
				async leaveRoom(roomId) {
					rooms.get(roomId)?.delete(userId)
					if (rooms.get(roomId)?.size === 0) {
						rooms.delete(roomId)
					}
					broadcastToRoom(roomId, `User ${userId} left`)
				},
				async sendMessage(roomId, message) {
					if (!rooms.get(roomId)?.has(userId)) {
						throw new Error("Not in room")
					}
					broadcastToRoom(roomId, `${userId}: ${message}`)
				},
				async getRoomUsers(roomId) {
					return Array.from(rooms.get(roomId) || [])
				}
			}
		})
	},
	message(ws, message) {
		ElysiaWebSocketServerIO.feedMessage(ws, message)
	}
})
```

## Runtime Support

### Bun (Recommended)

```typescript
import { Elysia } from "elysia"

const app = new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)
			const rpc = new RPCChannel(io, { expose: apiMethods })
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)
```

### Node.js

```typescript
import { Elysia } from "elysia"

const app = new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)
			const rpc = new RPCChannel(io, { expose: apiMethods })
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)
```

### Deno

```typescript
import { Elysia } from "elysia"

const app = new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)
			const rpc = new RPCChannel(io, { expose: apiMethods })
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)
```

## API Reference

### Classes

#### `ElysiaWebSocketServerIO`

Server-side WebSocket adapter for Elysia applications.

```typescript
class ElysiaWebSocketServerIO implements IoInterface {
	constructor(ws: any)

	// Connection metadata methods
	getRemoteAddress(): string | undefined
	getUrl(): URL | undefined
	getQuery(): Record<string, string>
	getHeaders(): Record<string, string>

	// Standard IoInterface methods
	read(): Promise<string | null>
	write(message: string | IoMessage): Promise<void>
	destroy(): void
	signalDestroy(): void

	// Static helper method
	static feedMessage(ws: any, message: unknown): void
}
```

#### `ElysiaWebSocketClientIO`

Client-side WebSocket adapter for connecting to Elysia servers.

```typescript
class ElysiaWebSocketClientIO implements IoInterface {
	constructor(url: string | URL, protocols?: string | string[])

	// Standard IoInterface methods
	read(): Promise<string | null>
	write(message: string | IoMessage): Promise<void>
	destroy(): void
	signalDestroy(): void
}
```

### Factory Functions

#### `createElysiaWebSocketIO(ws: any): ElysiaWebSocketServerIO`

Creates a new Elysia WebSocket server IO instance.

```typescript
const io = createElysiaWebSocketIO(ws)
```

#### `createElysiaWebSocketClientIO(url, protocols?): ElysiaWebSocketClientIO`

Creates a new Elysia WebSocket client IO instance.

```typescript
const io = createElysiaWebSocketClientIO("ws://localhost:3000/rpc")
```

## Connection Metadata

The Elysia adapter provides rich access to WebSocket connection information:

### `getRemoteAddress()`

Returns the remote address of the connected client.

```typescript
const address = io.getRemoteAddress()
console.log("Client connected from:", address) // "127.0.0.1:12345"
```

### `getQuery()`

Returns query parameters from the WebSocket connection URL.

```typescript
const query = io.getQuery()
console.log("Token:", query.token) // From ws://host/rpc?token=abc123
console.log("User ID:", query.userId) // From ws://host/rpc?userId=456
```

### `getHeaders()`

Returns HTTP headers from the WebSocket upgrade request.

```typescript
const headers = io.getHeaders()
console.log("User-Agent:", headers["user-agent"])
console.log("Authorization:", headers.authorization)
```

### `getUrl()`

Returns the full URL of the WebSocket connection.

```typescript
const url = io.getUrl()
console.log("Full path:", url?.pathname)
console.log("Origin:", url?.origin)
```

## Error Handling

The adapter includes comprehensive error handling with preservation of error properties:

```typescript
const app = new Elysia().ws("/rpc", {
	open(ws) {
		const io = new ElysiaWebSocketServerIO(ws)
		const rpc = new RPCChannel(io, {
			expose: {
				riskyOperation: async () => {
					const error = new Error("Operation failed!")
					error.code = "OPERATION_FAILED"
					error.timestamp = new Date().toISOString()
					throw error
				}
			}
		})
	},
	message(ws, message) {
		ElysiaWebSocketServerIO.feedMessage(ws, message)
	}
})
```

#### Client Error Handling

```typescript
try {
	await api.riskyOperation()
} catch (error: any) {
	console.error("Error name:", error.name) // "Error"
	console.error("Error message:", error.message) // "Operation failed!"
	console.error("Error code:", error.code) // "OPERATION_FAILED"
	console.error("Error timestamp:", error.timestamp) // ISO timestamp
	console.error("Error stack:", error.stack) // Full stack trace
}
```

## Performance Considerations

- **Memory Management**: Automatic cleanup of event listeners and references
- **Message Processing**: Efficient handling of string, ArrayBuffer, and object messages
- **Connection Tracking**: Proper reference management for WebSocket connections
- **Error Handling**: Graceful degradation and error boundary handling

## Advanced Patterns

### Multi-Protocol Support

```typescript
const app = new Elysia().ws("/rpc", {
	open(ws) {
		const protocols = ws.protocol // Get selected subprotocol
		const io = new ElysiaWebSocketServerIO(ws)

		const api = protocols === "v2" ? v2API : v1API
		const rpc = new RPCChannel(io, { expose: api })
	},
	message(ws, message) {
		ElysiaWebSocketServerIO.feedMessage(ws, message)
	}
})

// Client connecting with specific protocol
const clientIO = new ElysiaWebSocketClientIO("ws://localhost:3000/rpc", "v2")
```

### Connection Rate Limiting

```typescript
const connectionCounts = new Map<string, number>()

const app = new Elysia().ws("/rpc", {
	open(ws) {
		const io = new ElysiaWebSocketServerIO(ws)
		const address = io.getRemoteAddress()

		if (!address) {
			ws.close(1008, "Unknown address")
			return
		}

		const count = (connectionCounts.get(address) || 0) + 1
		if (count > 10) {
			ws.close(1008, "Too many connections")
			return
		}

		connectionCounts.set(address, count)

		const rpc = new RPCChannel(io, {
			expose: {
				getConnectionCount: () => count
			}
		})

		// Cleanup on disconnect
		ws.on("close", () => {
			connectionCounts.set(address, connectionCounts.get(address)! - 1)
		})
	},
	message(ws, message) {
		ElysiaWebSocketServerIO.feedMessage(ws, message)
	}
})
```

## Learn More

- [Elysia Framework Documentation](https://elysiajs.com/)
- [Elysia WebSocket Patterns](https://elysiajs.com/patterns/websocket)
- [uWebSocket Performance Guide](https://github.com/uWebSockets/uWebSockets)
- [kkrpc Main Documentation](https://kunkunsh.github.io/kkrpc/)

## Related Examples

- [Hono WebSocket Adapter](./hono-websocket.md) - Hono framework integration
- [WebSocket Adapter](./ws.md) - Standard WebSocket implementation
- [HTTP Adapter](./http.md) - HTTP-based RPC communication
