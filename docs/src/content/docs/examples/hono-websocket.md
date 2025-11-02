---
title: Hono Websocket
---

The Hono WebSocket adapter provides seamless integration between kkrpc and the [Hono framework](https://hono.dev/) high-performance WebSocket implementation. This adapter enables type-safe, bidirectional RPC communication in Hono applications with minimal setup.

## Features

- **High Performance**: Built on Hono's ultra-fast WebSocket implementation powered by uWebSocket
- **Cross-runtime**: Works across Bun, Deno, Node.js, and Cloudflare Workers
- **Type-safe**: Full TypeScript support with Hono integration
- **Bidirectional**: Both client and server can expose APIs
- **Framework Integration**: Seamless integration with Hono's middleware ecosystem
- **Connection Management**: Automatic connection lifecycle handling

## Quick Start

### Installation

```bash
# npm
npm install kkrpc hono

# pnpm
pnpm add kkrpc hono

# bun
bun add kkrpc hono
```

### Basic Example

#### Server Setup

```typescript
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import { createHonoWebSocketHandler } from 'kkrpc'
import { apiMethods, type API } from './api'

const app = new Hono()

// Define your API
const api = {
  greet: (name: string) => `Hello, ${name}!`,
  add: (a: number, b: number) => a + b,
  math: {
    multiply: (a: number, b: number) => a * b
  }
}

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: api
  })
}))

// Start server
const server = Bun.serve({
  port: 3000,
  fetch: app.fetch,
  websocket
})

console.log(`Server running on port ${server.port}`)
```

#### Client Connection

```typescript
import { WebSocketClientIO, RPCChannel } from 'kkrpc'

const clientIO = new WebSocketClientIO({
  url: 'ws://localhost:3000/ws'
})

const clientRPC = new RPCChannel(clientIO, {
  expose: {
    // Optional: expose client methods to server
    getClientInfo: () => ({ type: 'web-client', version: '1.0.0' })
  }
})

const api = clientRPC.getAPI<typeof api>()

// Use the remote API
console.log(await api.greet('World')) // "Hello, World!"
console.log(await api.add(5, 3)) // 8
console.log(await api.math.multiply(4, 6)) // 24

clientIO.destroy()
```

## Advanced Usage

### With Custom API Types

```typescript
import { createHonoWebSocketHandler } from 'kkrpc'

interface ServerAPI {
  getUsers(): Promise<User[]>
  createUser(userData: Omit<User, 'id'>): Promise<User>
  updateUser(id: string, updates: Partial<User>): Promise<User>
}

interface ClientAPI {
  onUserUpdate: (user: User) => void
  onUserDelete: (userId: string) => void
}

const serverAPI: ServerAPI = {
  async getUsers() {
    return await db.users.findMany()
  },
  async createUser(userData) {
    const user = await db.users.create({ data: userData })
    return user
  },
  async updateUser(id, updates) {
    return await db.users.update({ where: { id }, data: updates })
  }
}

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler<ServerAPI>({
    expose: serverAPI
  })
}))
```

### With Middleware

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

// Add middleware
app.use('*', cors())
app.use('*', logger())

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: apiMethods
  })
}))
```

### With Serialization Options

```typescript
import { createHonoWebSocketHandler } from 'kkrpc'

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: apiMethods,
    serialization: {
      version: 'superjson' // Enhanced serialization with Date, Map, Set support
    }
  })
}))
```

## Runtime Support

### Bun (Recommended)

```typescript
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'

const app = new Hono()

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: apiMethods
  })
}))

const server = Bun.serve({
  port: 3000,
  fetch: app.fetch,
  websocket
})
```

### Deno

```typescript
import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/deno'

const app = new Hono()

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: apiMethods
  })
}))

Deno.serve({ port: 3000, fetch: app.fetch })
```

### Node.js

```typescript
import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/node'
import { createServer } from 'http'

const app = new Hono()

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: apiMethods
  })
}))

const server = createServer(app.fetch)
server.listen(3000)
```

### Cloudflare Workers

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: apiMethods
  })
}))

export default app
```

## API Reference

### `createHonoWebSocketHandler<API>(options)`

Creates a Hono WebSocket handler that integrates kkrpc with Hono's upgradeWebSocket.

**Parameters:**
- `options.expose: API` - The API implementation to expose on the server
- `options.serialization?: { version: "json" | "superjson" }` - Optional serialization options

**Returns:**
Object with WebSocket lifecycle handlers:
- `onOpen(event: Event, ws: any): void`
- `onMessage(event: MessageEvent, ws: any): void`
- `onClose(): void`
- `onError?(event: Event, ws: any): void`

### Client Types

The adapter uses standard WebSocket client adapters:

- `WebSocketClientIO` for connecting to Hono WebSocket servers
- `RPCChannel` for bidirectional communication

## Error Handling

The adapter includes built-in error handling and connection management:

```typescript
app.get('/ws', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: {
      riskyOperation: async () => {
        throw new Error("Something went wrong!")
      }
    }
  })
}))

// Client side error handling
try {
  await api.riskyOperation()
} catch (error) {
  console.error('Server error:', error.message)
  // Error is fully preserved across the WebSocket boundary
}
```

## Performance Considerations

- **Memory Management**: The adapter automatically manages WebSocket connection lifecycle
- **Message Processing**: Messages are efficiently processed without blocking the event loop
- **Connection Pooling**: Supports multiple concurrent WebSocket connections
- **Binary Data**: Supports binary message transmission for performance-critical applications

## Examples

### Real-time Chat

```typescript
interface ChatAPI {
  sendMessage(message: string, room: string): Promise<void>
  getMessages(room: string): Promise<Message[]>
  joinRoom(room: string): Promise<void>
  leaveRoom(room: string): Promise<void>
}

app.get('/chat/:room', upgradeWebSocket((ctx) => {
  const room = ctx.param.room

  return createHonoWebSocketHandler<ChatAPI>({
    expose: {
      async sendMessage(message, targetRoom) {
        if (targetRoom !== room) throw new Error("Access denied")
        await broadcastToRoom(room, message)
      },
      async getMessages(targetRoom) {
        if (targetRoom !== room) throw new Error("Access denied")
        return await getRoomMessages(room)
      },
      async joinRoom(targetRoom) {
        if (targetRoom !== room) throw new Error("Access denied")
        await addUserToRoom(ctx.req.header('authorization'), room)
      },
      async leaveRoom(targetRoom) {
        if (targetRoom !== room) throw new Error("Access denied")
        await removeUserFromRoom(ctx.req.header('authorization'), room)
      }
    }
  })
}))
```

### API Proxy

```typescript
app.get('/api', upgradeWebSocket(() => {
  return createHonoWebSocketHandler({
    expose: {
      async getUsers() {
        const response = await fetch('https://jsonplaceholder.typicode.com/users')
        return response.json()
      },
      async getPosts() {
        const response = await fetch('https://jsonplaceholder.typicode.com/posts')
        return response.json()
      }
    }
  })
}))
```

## Learn More

- [Hono Framework Documentation](https://hono.dev/)
- [Hono WebSocket Guide](https://hono.dev/docs/helpers/websocket)
- [uWebSocket Performance Details](https://github.com/uWebSockets/uWebSockets)
- [kkrpc Main Documentation](https://kunkunsh.github.io/kkrpc/)

## Related Examples

- [HTTP Adapter](./http.md) - HTTP-based RPC communication
- [WebSocket Adapter](./ws.md) - Standard WebSocket implementation
- [Socket.IO Adapter](./socketio.md) - Enhanced WebSocket with rooms/namespaces