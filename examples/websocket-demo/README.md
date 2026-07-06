# WebSocket Demo

This demo shows how to expose a kkrpc API over a WebSocket transport using two popular server frameworks: **Hono** and **Elysia**. Both run on Bun and share the same client code.

Servers expose the same nested API with the framework-specific kkrpc helpers:

```ts
// Hono
import { upgradeWebSocket, websocket } from "hono/bun"
import { createHonoWebSocketHandler } from "kkrpc/ws/hono"

app.get(
	"/ws",
	upgradeWebSocket(() => createHonoWebSocketHandler({ expose: api }))
)
Bun.serve({ fetch: app.fetch, websocket })
```

```ts
// Elysia
import { createElysiaWebSocketHandler } from "kkrpc/ws/elysia"

new Elysia().ws("/rpc", createElysiaWebSocketHandler({ expose: api })).listen({ port: 3002 })
```

Clients use the stable core `wrap` helper with `webSocketClientTransport` from `kkrpc/ws`:

```ts
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<APINested>(webSocketClientTransport({ url: "ws://127.0.0.1:3001/ws" }))
```

## Manual Testing

### Install Dependencies

```sh
pnpm install
```

### Start One Server

Run one server in terminal 1. Each command exposes the same RPC API over a different framework:

```bash
pnpm run hono    # Hono on ws://127.0.0.1:3001/ws
pnpm run elysia  # Elysia on ws://127.0.0.1:3002/rpc
```

### Start The Client

Run the client in terminal 2. The default URL targets the Hono server:

```bash
pnpm run client        # connects to ws://127.0.0.1:3001/ws (Hono)
pnpm run client:elysia # connects to ws://127.0.0.1:3002/rpc (Elysia)
```

To target an arbitrary URL, set `KKRPC_WS_URL`:

```bash
KKRPC_WS_URL=ws://127.0.0.1:3002/rpc pnpm run client
```

### What To Verify

- The server terminal should stay running without throwing.
- The client should print successful RPC call output: `Echo:`, `5 + 3 = 8`, `4 * 6 = 24`, etc.
- Stop one server and start the other to compare frameworks against the same client.

### Troubleshooting

- Only run one server at a time if you don't change ports, but the Hono and Elysia defaults already use different ports (3001 and 3002) so you can run both simultaneously.
- The client defaults to `ws://127.0.0.1:3001/ws` (Hono) to avoid accidentally resolving `localhost` to another IPv6 dev server. Use `127.0.0.1` explicitly when pointing at a custom URL.

## Regression Test

```bash
pnpm test
```

This starts ephemeral Hono and Elysia WebSocket servers on random ports and runs the shared client flow against each one.
