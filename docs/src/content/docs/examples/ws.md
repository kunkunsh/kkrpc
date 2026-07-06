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
	add: async (a, b, callback) => {
		callback?.(a + b)
		return a + b
	}
}
```

### Server

```ts title="server.ts"
import { expose } from "kkrpc"
import { webSocketTransport } from "kkrpc/ws"
import { WebSocketServer } from "ws"
import { apiMethods } from "./api"

const wss = new WebSocketServer({ port: 3000 })

wss.on("connection", (ws) => {
	expose(apiMethods, webSocketTransport(ws))
})
```

### Client

```ts title="client.ts"
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { API } from "./api"

const api = wrap<API>(webSocketClientTransport("ws://localhost:3000"))

const sum = await api.add(5, 3)
await api.add(10, 20, (value) => console.log(value))
```

## Reconnecting

WebSocket connections can drop. Pass `onClose` to the channel to detect it — in-flight calls
reject immediately with `RPCTransportClosedError` instead of hanging until their timeout — and
rebuild the transport and channel to reconnect. See the
[connection lifecycle guide](/guides/connection-lifecycle/) for the full contract.

```ts title="client.ts"
import { RPCChannel } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"
import type { API } from "./api"

function connect(): RPCChannel<object, API> {
	const channel = new RPCChannel<object, API>(webSocketClientTransport("ws://localhost:3000"), {
		onClose: (reason) => {
			console.warn("connection lost:", reason)
			channel.destroy()
			setTimeout(connect, 1000) // reconnect with backoff of your choosing
		}
	})
	return channel
}

const channel = connect()
const api = channel.getAPI()
```
