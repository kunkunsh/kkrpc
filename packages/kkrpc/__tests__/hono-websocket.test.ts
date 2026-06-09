import { afterAll, beforeAll, expect, test } from "bun:test"
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { RPCChannel } from "../mod.ts"
import { createHonoWebSocketHandler } from "../ws-hono.ts"
import { webSocketClientTransport } from "../ws.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const PORT = 3002
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(() => {
	const app = new Hono()
	app.get(
		"/ws",
		upgradeWebSocket(() => createHonoWebSocketHandler({ expose: apiMethods }))
	)

	server = Bun.serve({
		port: PORT,
		fetch: app.fetch,
		websocket
	})
})

afterAll(() => {
	server?.stop()
})

test("Hono WebSocket RPC calls remote methods", async () => {
	const client = new RPCChannel<object, API>(
		webSocketClientTransport({ url: `ws://localhost:${PORT}/ws` })
	)
	const api = client.getAPI()

	try {
		expect(await api.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
		expect(await api.counter).toBe(42)
		await expect(api.throwSimpleError()).rejects.toThrow("This is a simple error")
	} finally {
		client.destroy()
	}
})

test("Hono WebSocket supports concurrent clients", async () => {
	const clients = Array.from(
		{ length: 5 },
		() =>
			new RPCChannel<object, API>(webSocketClientTransport({ url: `ws://localhost:${PORT}/ws` }))
	)

	try {
		const results = await Promise.all(clients.map((client) => client.getAPI().add(10, 20)))
		expect(results).toEqual([30, 30, 30, 30, 30])
	} finally {
		for (const client of clients) client.destroy()
	}
})
