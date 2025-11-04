import { afterAll, beforeAll, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RPCChannel } from "../mod.ts"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import type { IoInterface } from "../src/interface.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const PORT = 3001
let wss: WebSocketServer
let serverRPC: RPCChannel<API, API>

beforeAll(() => {
	// Create WebSocket server
	wss = new WebSocketServer({ port: PORT })

	// Handle WebSocket connections
	wss.on("connection", (ws: WebSocket) => {
		const serverIO = new WebSocketServerIO(ws)
		serverRPC = new RPCChannel<API, API>(serverIO, { expose: apiMethods })
	})
})

afterAll(() => {
	wss.close()
})

test("WebSocket RPC", async () => {
	const clientIO = new WebSocketClientIO({
		url: `ws://localhost:${PORT}`
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
	for (let i = 0; i < 100; i++) {
		const a = Math.floor(Math.random() * 100)
		const b = Math.floor(Math.random() * 100)

		const sum = await api.add(a, b)
		expect(sum).toBe(a + b)

		const product = await api.math.grade2.multiply(a, b)
		expect(product).toBe(a * b)
	}

	clientIO.destroy()
})

// test("WebSocket error handling", async () => {
// 	const invalidPort = 54321
// 	const clientIO = new WebSocketClientIO({
// 		url: `ws://localhost:${invalidPort}`
// 	})

// 	const clientRPC = new RPCChannel<{}, API, IoInterface>(clientIO)
// 	const api = clientRPC.getAPI()
// 	expect(() => api.add(1, 2)).toThrow()
// 	clientIO.destroy()
// })

test("WebSocket concurrent connections", async () => {
	const numClients = 5
	const clients = Array.from({ length: numClients }, () => {
		const clientIO = new WebSocketClientIO({
			url: `ws://localhost:${PORT}`
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
