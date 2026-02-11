---
title: WebSocket
description: Make RPC calls over WebSocket
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
import { WebSocketClientIO, WebSocketServerIO } from "kkrpc"
import { WebSocketServer } from "ws"

let serverRPC: RPCChannel<API, API>

let wss: WebSocketServer = new WebSocketServer({ port: PORT })
wss.on("connection", (ws: WebSocket) => {
	const serverIO = new WebSocketServerIO(ws)
	serverRPC = new RPCChannel<API, API>(serverIO, { expose: apiMethods })
})
```

### Client

```ts title="client.ts"
import { WebSocketClientIO, WebSocketServerIO } from "kkrpc"

const clientIO = new WebSocketClientIO({
	url: `ws://localhost:${PORT}`
})

const clientRPC = new RPCChannel<API, API, IoInterface>(clientIO, { expose: apiMethods })
const api = clientRPC.getAPI()

const sum = await api.add(5, 3)
expect(sum).toBe(8)
await api.add(10, 20, (sum) => {
	expect(sum).toBe(30)
})
```
