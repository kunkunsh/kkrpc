import { afterAll, beforeAll, expect, test } from "bun:test"
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { RPCChannel, WebSocketClientIO, createHonoWebSocketHandler } from "../mod.ts"
import type { IoInterface } from "../src/interface.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const PORT = 3002
let server: ReturnType<typeof Bun.serve> | null = null

beforeAll(() => {
	// Create Hono app with WebSocket support
	const app = new Hono()

	app.get("/ws", upgradeWebSocket(() => {
		return createHonoWebSocketHandler<API>({
			expose: apiMethods
		})
	}))

	// Start server
	server = Bun.serve({
		port: PORT,
		fetch: app.fetch,
		websocket
	})
})

afterAll(() => {
	if (server) {
		server.stop()
	}
})

test("Hono WebSocket RPC", async () => {
	const clientIO = new WebSocketClientIO({
		url: `ws://localhost:${PORT}/ws`
	})

	const clientRPC = new RPCChannel<API, API, IoInterface>(clientIO, {
		expose: apiMethods
	})
	const api = clientRPC.getAPI()

	// Test individual calls
	const sum = await api.add(5, 3)
	expect(sum).toBe(8)

	const product = await api.math.grade2.multiply(4, 6)
	expect(product).toBe(24)

	// Test concurrent calls
	const results = await Promise.all([
		api.add(10, 20),
		api.math.grade2.multiply(10, 20),
		api.add(30, 40),
		api.math.grade2.multiply(30, 40)
	])

	expect(results).toEqual([30, 200, 70, 1200])

	// Test multiple random calls
	for (let i = 0; i < 50; i++) {
		const a = Math.floor(Math.random() * 100)
		const b = Math.floor(Math.random() * 100)

		const sum = await api.add(a, b)
		expect(sum).toBe(a + b)

		const product = await api.math.grade2.multiply(a, b)
		expect(product).toBe(a * b)
	}

	clientIO.destroy()
})

test("Hono WebSocket concurrent connections", async () => {
	const numClients = 5
	const clients = Array.from({ length: numClients }, () => {
		const clientIO = new WebSocketClientIO({
			url: `ws://localhost:${PORT}/ws`
		})
		return {
			io: clientIO,
			rpc: new RPCChannel<{}, API, IoInterface>(clientIO)
		}
	})

	try {
		// Test concurrent calls from multiple clients
		const results = await Promise.all(
			clients.flatMap(({ rpc }) => {
				const api = rpc.getAPI()
				return [api.add(10, 20), api.math.grade2.multiply(10, 20)]
			})
		)

		// Verify results
		for (let i = 0; i < results.length; i += 2) {
			expect(results[i]).toBe(30) // add result
			expect(results[i + 1]).toBe(200) // multiply result
		}
	} finally {
		// Cleanup
		clients.forEach(({ io }) => io.destroy())
	}
})

test("Hono WebSocket property access", async () => {
	const clientIO = new WebSocketClientIO({
		url: `ws://localhost:${PORT}/ws`
	})

	const clientRPC = new RPCChannel<{}, API, IoInterface>(clientIO)
	const api = clientRPC.getAPI()

	// Test property access
	const counter = await api.counter
	expect(counter).toBe(42)

	const nestedValue = await api.nested.value
	expect(nestedValue).toBe("hello world")

	const deepProp = await api.nested.deepObj.prop
	expect(deepProp).toBe(true)

	clientIO.destroy()
})

test("Hono WebSocket error handling", async () => {
	const clientIO = new WebSocketClientIO({
		url: `ws://localhost:${PORT}/ws`
	})

	const clientRPC = new RPCChannel<{}, API, IoInterface>(clientIO)
	const api = clientRPC.getAPI()

	// Test error throwing
	await expect(api.throwSimpleError()).rejects.toThrow("This is a simple error")

	await expect(api.throwCustomError()).rejects.toThrow("This is a custom error")

	clientIO.destroy()
})
