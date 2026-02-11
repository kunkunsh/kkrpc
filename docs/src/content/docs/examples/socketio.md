---
title: Socket.IO
description: Make RPC calls over Socket.IO
---

### API Definition

```ts title="api.ts"
export type API = {
	add: (a: number, b: number, callback?: (sum: number) => void) => Promise<number>
}

export const apiMethods: API = {
	add: (a, b, callback) => {
		callback?.(a + b)
		return Promise.resolve(a + b)
	}
}
```

### Server

```ts title="server.ts"
import { createServer } from "http"
import { RPCChannel } from "kkrpc"
import { SocketIOClientIO, SocketIOServerIO } from "kkrpc/socketio"
import { Server as SocketIOServer } from "socket.io"

const httpServer = createServer()
const io = new SocketIOServer(httpServer, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"]
	}
})

let serverRPC: RPCChannel<API, API>

io.on("connection", (socket) => {
	const serverIO = new SocketIOServerIO(socket)
	serverRPC = new RPCChannel<API, API>(serverIO, { expose: apiMethods })
})

const PORT = 3001
httpServer.listen(PORT, () => {
	console.log(`Socket.IO server running on port ${PORT}`)
})
```

### Client

```ts title="client.ts"
import { RPCChannel, type IoInterface } from "kkrpc"
import { SocketIOClientIO } from "kkrpc/socketio"

const clientIO = new SocketIOClientIO({
	url: `http://localhost:${PORT}`
})

const clientRPC = new RPCChannel<API, API, IoInterface>(clientIO, { expose: apiMethods })
const api = clientRPC.getAPI()

const sum = await api.add(5, 3)
expect(sum).toBe(8)

await api.add(10, 20, (sum) => {
	expect(sum).toBe(30)
})
```

### With Namespace

```ts title="client-with-namespace.ts"
import { RPCChannel, type IoInterface } from "kkrpc"
import { SocketIOClientIO } from "kkrpc/socketio"

const clientIO = new SocketIOClientIO({
	url: `http://localhost:${PORT}`,
	namespace: "rpc",
	opts: {
		transports: ["websocket"]
	}
})

const clientRPC = new RPCChannel<API, API, IoInterface>(clientIO, { expose: apiMethods })
const api = clientRPC.getAPI()

const sum = await api.add(5, 3)
expect(sum).toBe(8)
```

### Server with Namespace

```ts title="server-with-namespace.ts"
import { createServer } from "http"
import { RPCChannel } from "kkrpc"
import { SocketIOClientIO, SocketIOServerIO } from "kkrpc/socketio"
import { Server as SocketIOServer } from "socket.io"

const httpServer = createServer()
const io = new SocketIOServer(httpServer, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"]
	}
})

const rpcNamespace = io.of("/rpc")

rpcNamespace.on("connection", (socket) => {
	const serverIO = new SocketIOServerIO(socket)
	const serverRPC = new RPCChannel<API, API>(serverIO, { expose: apiMethods })
})

const PORT = 3001
httpServer.listen(PORT, () => {
	console.log(`Socket.IO server with namespace running on port ${PORT}`)
})
```

**Socket.IO Features:**

- **Real-time communication**: Built on top of WebSocket with fallback support
- **Namespace support**: Organize connections into different namespaces
- **Room support**: Broadcast to specific groups of clients
- **Automatic reconnection**: Handles connection drops and reconnection
- **Binary support**: Efficiently handle binary data
- **Cross-browser compatibility**: Works across all modern browsers
