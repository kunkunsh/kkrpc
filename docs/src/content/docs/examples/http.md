---
title: HTTP
description: Make RPC calls over HTTP like calling local functions (similar to tRPC)
---

I will be using [Hono](https://hono.dev/) for server because of its simplicity,
but you can use `kkRPC` with any JS/TS HTTP server (e.g. Express, Fastify, http, `Bun.serve`, `Deno.serve`).

## API Definitions

`api.ts` is where all the API definitions and implementations are (you can separate type and implementation into different files).

To add a new API method, just add a new method to the `API` type and implement it in the `api` object. Then you can call it directly in `client.ts`
No need to touch `server.ts`.

```ts title="api.ts"
export type API = {
	echo: (message: string) => Promise<string>
	add: (a: number, b: number) => Promise<number>
}

export const api: API = {
	echo: (message) => {
		return Promise.resolve(message)
	},
	add: (a, b) => {
		return Promise.resolve(a + b)
	}
}
```

## Server Setup

`server.ts` only needs to be setup once (no need to touch it later to add more API methods), and contain only one post route (`/rpc`).

```ts title="server.ts"
import { Hono } from "hono"
import { createHttpHandler } from "kkrpc/http"
import { api } from "./api.ts"

const handler = createHttpHandler(api)

const app = new Hono()

app.post("/rpc", async (c) => {
	return handler(c.req.raw)
})

export default {
	port: 3000,
	fetch: app.fetch
}
```

`bun server.ts` to start the server.

## Client

`client.ts` is how you use `kkRPC` to make RPC calls to the server.

Making an http RPC call is as simple as calling the methods defined in `api.ts`.

```ts title="client.ts"
import { wrap } from "kkrpc"
import { httpClientTransport } from "kkrpc/http"
import type { API } from "./api.ts"

const api = wrap<API>(httpClientTransport({ url: "http://localhost:3000/rpc" }))

const echo = await api.echo("hello")
console.log("echo", echo)

const sum = await api.add(2, 3)
console.log("Sum: ", sum)
```

`bun client.ts` to test the API.

:::danger
`kkrpc/http` is unary request/response. It does not support features that require follow-up bidirectional traffic.

This means

- You can't expose functions from client side and call them on server side.
- When you call a method on server from client, you can't add a callback function for async response.
- You can't stream async iterables over the HTTP transport.
- You can't use `kkrpc/remote-refs` handles over the HTTP transport.
- You can't send or return raw function values; HTTP APIs must stay JSON/value oriented.

This is because the others `stdio`, `websocket`, `iframe` `MessageChannel`, `WebWorker` `postMessage`
are all based on event-driven communication, while `http` is request-response based.

They are in nature bidirectional (both sides can actively push message to each other), but `http` is not. Keep HTTP APIs value-only, or move callbacks, streams, and remote handles to a bidirectional transport. Structurally valid RPC requests that contain unsupported callback, stream, or remote-reference envelopes receive a normal RPC error response explaining the unsupported feature.
:::
