import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RPCChannel } from "../mod.ts"
import { webSocketClientTransport, webSocketTransport } from "../ws.ts"
import { apiMethods, type API } from "./scripts/api.ts"

let wss: WebSocketServer
let url: string

beforeAll(() => {
	wss = new WebSocketServer({ port: 0 })
	const address = wss.address() as AddressInfo
	url = `ws://localhost:${address.port}`
	wss.on("connection", (socket) => {
		new RPCChannel<API, object>(webSocketTransport(socket), { expose: apiMethods })
	})
})

afterAll(() => {
	wss.close()
})

test("WebSocket RPC calls remote methods", async () => {
	const client = new RPCChannel<object, API>(webSocketClientTransport({ url }))
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
		() => new RPCChannel<object, API>(webSocketClientTransport({ url }))
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

test("WebSocket ignores malformed frames", async () => {
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

test("WebSocket unsubscribe removes native listeners", async () => {
	const server = new WebSocketServer({ port: 0 })
	const address = server.address() as AddressInfo
	const accepted = new Promise<
		Parameters<typeof webSocketTransport>[0] & { listenerCount(event: string): number }
	>((resolve) => {
		server.once("connection", (socket) => resolve(socket))
	})
	const socket = new WebSocket(`ws://localhost:${address.port}`)
	await waitForOpen(socket)
	const serverSocket = await accepted
	const transport = webSocketTransport(serverSocket)
	const unsubscribe = transport.subscribe(() => {})

	expect(serverSocket.listenerCount("message")).toBeGreaterThan(0)
	unsubscribe()
	expect(serverSocket.listenerCount("message")).toBe(0)

	socket.close()
	server.close()
})

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		socket.addEventListener("open", () => resolve(), { once: true })
	})
}
