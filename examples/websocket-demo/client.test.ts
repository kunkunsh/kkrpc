import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Elysia } from "elysia"
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { createElysiaWebSocketHandler } from "kkrpc/ws/elysia"
import { createHonoWebSocketHandler } from "kkrpc/ws/hono"
import { runWsDemoClient } from "./client"

let honoServer: ReturnType<typeof Bun.serve> | undefined
let honoUrl: string
let elysiaApp: ReturnType<typeof Elysia.prototype.listen> | undefined
let elysiaUrl: string

beforeAll(() => {
	const honoApp = new Hono()
	honoApp.get(
		"/ws",
		upgradeWebSocket(() =>
			createHonoWebSocketHandler<APINested>({ expose: apiImplementationNested })
		)
	)
	honoServer = Bun.serve({
		port: 0,
		fetch: honoApp.fetch,
		websocket
	})
	honoUrl = `ws://127.0.0.1:${honoServer.port}/ws`

	elysiaApp = new Elysia()
		.ws("/rpc", createElysiaWebSocketHandler<APINested>({ expose: apiImplementationNested }))
		.listen({ port: 0, hostname: "127.0.0.1" })
	const elysiaPort = elysiaApp.server?.port
	if (elysiaPort === undefined) throw new Error("Elysia test server did not expose a port")
	elysiaUrl = `ws://127.0.0.1:${elysiaPort}/rpc`
})

afterAll(() => {
	honoServer?.stop()
	elysiaApp?.stop()
})

describe("websocket-demo client", () => {
	test("runs against a Hono WebSocket server", async () => {
		const result = await runWsDemoClient(honoUrl)
		expect(result.echoResult).toBe("Hello WebSocket RPC!")
		expect(result.sum).toBe(8)
		expect(result.product).toBe(24)
		expect(result.quotient).toBe(5)
		expect(result.concurrentResults).toEqual([30, 200])
		expect(result.allCorrect).toBe(true)
	})

	test("runs against an Elysia WebSocket server", async () => {
		const result = await runWsDemoClient(elysiaUrl)
		expect(result.echoResult).toBe("Hello WebSocket RPC!")
		expect(result.sum).toBe(8)
		expect(result.product).toBe(24)
		expect(result.quotient).toBe(5)
		expect(result.concurrentResults).toEqual([30, 200])
		expect(result.allCorrect).toBe(true)
	})
})
