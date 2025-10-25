import { afterAll, beforeAll, expect, test } from "bun:test"
import { createServer } from "http"
import { Server as SocketIOServer } from "socket.io"
import { RPCChannel } from "../mod.ts"
import { SocketIOClientIO, SocketIOServerIO } from "../src/adapters/socketio.ts"
import type { DestroyableIoInterface } from "../src/interface.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const PORT = 3002
let httpServer: ReturnType<typeof createServer>
let io: SocketIOServer
let serverRPC: RPCChannel<API, API>

beforeAll(() => {
	// Create HTTP server
	httpServer = createServer()
	
	// Create Socket.IO server
	io = new SocketIOServer(httpServer, {
		cors: {
			origin: "*",
			methods: ["GET", "POST"]
		}
	})

	// Handle Socket.IO connections
	io.on("connection", (socket) => {
		const serverIO = new SocketIOServerIO(socket)
		serverRPC = new RPCChannel<API, API>(serverIO, { expose: apiMethods })
	})

	// Start server
	httpServer.listen(PORT)
})

afterAll(() => {
	io?.close()
	httpServer?.close()
})

test("Socket.IO RPC", async () => {
	const clientIO = new SocketIOClientIO({
		url: `http://localhost:${PORT}`
	})

	const clientRPC = new RPCChannel<API, API, DestroyableIoInterface>(clientIO, {
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

test("Socket.IO with namespace", async () => {
	const NAMESPACE = "/test"
	
	// Create namespace
	const testNamespace = io.of(NAMESPACE)
	
	testNamespace.on("connection", (socket) => {
		const serverIO = new SocketIOServerIO(socket)
		const serverRPC = new RPCChannel<API, API>(serverIO, { expose: apiMethods })
	})

	const clientIO = new SocketIOClientIO({
		url: `http://localhost:${PORT}`,
		namespace: "test"
	})

	const clientRPC = new RPCChannel<API, API, DestroyableIoInterface>(clientIO, {
		expose: apiMethods
	})
	const api = clientRPC.getAPI()

	// Test calls through namespace
	const sum = await api.add(15, 25)
	expect(sum).toBe(40)

	const product = await api.math.grade2.multiply(7, 8)
	expect(product).toBe(56)

	clientIO.destroy()
})

test("Socket.IO concurrent connections", async () => {
	const numClients = 5
	const clients = Array.from({ length: numClients }, () => {
		const clientIO = new SocketIOClientIO({
			url: `http://localhost:${PORT}`
		})
		return {
			io: clientIO,
			rpc: new RPCChannel<{}, API, DestroyableIoInterface>(clientIO)
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

test("Socket.IO with options", async () => {
	const clientIO = new SocketIOClientIO({
		url: `http://localhost:${PORT}`,
		opts: {
			transports: ["websocket"],
			timeout: 5000
		}
	})

	const clientRPC = new RPCChannel<API, API, DestroyableIoInterface>(clientIO, {
		expose: apiMethods
	})
	const api = clientRPC.getAPI()

	// Test calls with custom options
	const sum = await api.add(100, 200)
	expect(sum).toBe(300)

	clientIO.destroy()
})