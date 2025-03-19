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
import { apiImplementationNested, type APINested } from "./api.ts"

const handler = createHttpHandler(apiImplementationNested)

const app = new Hono()

app.post("/rpc", async (c) => {
	return c.text(await handler.handleRequest(await c.req.text()))
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
import { createHttpClient } from "kkrpc/http"
import { api, type API } from "./api.ts"

const { api } = createHttpClient<API>("http://localhost:3000/rpc")

const echo = await api.echo("hello")
console.log("echo", echo)

const sum = await api.add(2, 3)
console.log("Sum: ", sum)
```

`bun client.ts` to test the API.

:::danger
`http` adapter is the only adapter that doesn't support bidirectional RPC calls and callbacks.

This means

- You can't expose functions from client side and call them on server side.
- When you call a method on server from client, you can't add a callback function for async response.

This is because the others `stdio`, `websocket`, `iframe` `MessageChannel`, `WebWorker` `postMessage`
are all based on event-driven communication, while `http` is request-response based.

They are in nature bidirectional (both sides can actively push message to each other), but `http` is not, there is no easy way to actively push message from server to client (long polling is an option, but not efficient, I may consider adding long polling support in the future).
:::
