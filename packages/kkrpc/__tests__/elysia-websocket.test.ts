import { afterAll, beforeAll, expect, test } from "bun:test"
import { Elysia } from "elysia"
import { RPCChannel } from "../mod.ts"
import { createElysiaWebSocketHandler } from "../ws-elysia.ts"
import { webSocketClientTransport } from "../ws.ts"
import { apiMethods, type API } from "./scripts/api.ts"

let server: Elysia | undefined
let url: string

beforeAll(() => {
	server = new Elysia()
		.ws("/rpc", createElysiaWebSocketHandler({ expose: apiMethods }))
		.listen({ port: 0, hostname: "127.0.0.1" })
	url = `ws://127.0.0.1:${server.server?.port}/rpc`
})

afterAll(() => {
	server?.stop()
})

test("Elysia WebSocket RPC calls remote methods", async () => {
	const client = new RPCChannel<object, API>(webSocketClientTransport({ url }))
	const api = client.getAPI()

	try {
		expect(await api.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
		expect(await api.nested.deepObj.prop).toBe(true)
		await expect(api.throwCustomError()).rejects.toThrow("This is a custom error")
	} finally {
		client.destroy()
	}
})

test("Elysia WebSocket supports concurrent clients", async () => {
	const clients = Array.from(
		{ length: 5 },
		() => new RPCChannel<object, API>(webSocketClientTransport({ url }))
	)

	try {
		const results = await Promise.all(clients.map((client) => client.getAPI().subtract(50, 8)))
		expect(results).toEqual([42, 42, 42, 42, 42])
	} finally {
		for (const client of clients) client.destroy()
	}
})

test("Elysia WebSocket ignores malformed frames", async () => {
	const socket = new WebSocket(url)
	await waitForOpen(socket)
	socket.send("not json")
	socket.close()

	const client = new RPCChannel<object, API>(webSocketClientTransport({ url }))
	try {
		expect(await client.getAPI().add(1, 2)).toBe(3)
	} finally {
		client.destroy()
	}
})

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		socket.addEventListener("open", () => resolve(), { once: true })
	})
}
