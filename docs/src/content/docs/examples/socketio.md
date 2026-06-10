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
	add: async (a, b, callback) => {
		callback?.(a + b)
		return a + b
	}
}
```

### Server

```ts title="server.ts"
import { createServer } from "node:http"
import { expose } from "kkrpc"
import { socketIoTransport } from "kkrpc/socketio"
import { Server } from "socket.io"
import { apiMethods } from "./api"

const httpServer = createServer()
const io = new Server(httpServer, { cors: { origin: "*" } })

io.on("connection", (socket) => {
	expose(apiMethods, socketIoTransport(socket))
})

httpServer.listen(3001)
```

### Client

```ts title="client.ts"
import { wrap } from "kkrpc"
import { socketIoTransport } from "kkrpc/socketio"
import { io } from "socket.io-client"
import type { API } from "./api"

const socket = io("http://localhost:3001")
const api = wrap<API>(socketIoTransport(socket))

console.log(await api.add(5, 3))
```
