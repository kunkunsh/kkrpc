import { afterAll, beforeAll, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RPCChannel } from "../mod.ts"
import { webSocketClientTransport, webSocketTransport } from "../ws.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const PORT = 3001
let wss: WebSocketServer

beforeAll(() => {
	wss = new WebSocketServer({ port: PORT })
	wss.on("connection", (socket) => {
		new RPCChannel<API, object>(webSocketTransport(socket), { expose: apiMethods })
	})
})

afterAll(() => {
	wss.close()
})

test("WebSocket RPC calls remote methods", async () => {
	const client = new RPCChannel<object, API>(
		webSocketClientTransport({ url: `ws://localhost:${PORT}` })
	)
	const api = client.getAPI()

	try {
		expect(await api.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
		expect(
			await Promise.all([
				api.add(10, 20),
				api.math.grade2.multiply(10, 20),
				api.add(30, 40),
				api.math.grade2.multiply(30, 40)
			])
		).toEqual([30, 200, 70, 1200])
	} finally {
		client.destroy()
	}
})

test("WebSocket supports concurrent clients", async () => {
	const clients = Array.from(
		{ length: 5 },
		() => new RPCChannel<object, API>(webSocketClientTransport({ url: `ws://localhost:${PORT}` }))
	)

	try {
		const results = await Promise.all(
			clients.flatMap((client) => {
				const api = client.getAPI()
				return [api.add(10, 20), api.math.grade2.multiply(10, 20)]
			})
		)

		for (let index = 0; index < results.length; index += 2) {
			expect(results[index]).toBe(30)
			expect(results[index + 1]).toBe(200)
		}
	} finally {
		for (const client of clients) client.destroy()
	}
})
