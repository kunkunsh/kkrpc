import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { Elysia } from "elysia"
import { RPCChannel } from "../mod"
import { ElysiaWebSocketClientIO, ElysiaWebSocketServerIO } from "../src/adapters/elysia-websocket"

describe("Elysia WebSocket Simple Test", () => {
	let server: any
	let port: number

	beforeAll(async () => {
		const ports = [28201, 28211, 28221, 28231]
		let lastError: unknown = null

		for (const candidate of ports) {
			try {
				port = candidate
				server = new Elysia()
					.ws("/rpc", {
						open(ws) {
							const io = new ElysiaWebSocketServerIO(ws)
							const rpc = new RPCChannel(io, {
								expose: {
									greet: (name: string) => `Hello, ${name}!`,
									add: (a: number, b: number) => a + b
								}
							})
						},
						message(ws, message) {
							ElysiaWebSocketServerIO.feedMessage(ws, message)
						}
					})
					.listen({ port: candidate, hostname: "127.0.0.1" })
				// Give server time to start
				await new Promise((resolve) => setTimeout(resolve, 100))
				return
			} catch (error) {
				lastError = error
				if (!(error as any)?.code || (error as any).code !== "EADDRINUSE") {
					throw error
				}
			}
		}

		throw lastError ?? new Error("Unable to find available port for Elysia WebSocket simple tests")
	})

	afterAll(async () => {
		if (server) {
			server.stop()
		}
	})

	it("should create server and client IO instances", () => {
		const mockWs = {
			send: () => {},
			close: () => {},
			readyState: 1,
			onmessage: () => {},
			onerror: () => {}
		}

		const serverIO = new ElysiaWebSocketServerIO(mockWs)
		expect(serverIO.name).toBe("elysia-websocket-server")

		const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
		expect(clientIO.name).toBe("elysia-websocket-client")
		clientIO.destroy()
	})

	it("should handle basic server IO operations", async () => {
		const messages: string[] = []
		const mockWs = {
			send: (message: string) => messages.push(message),
			close: () => {},
			readyState: 1,
			onmessage: null as any,
			onerror: () => {}
		}

		const io = new ElysiaWebSocketServerIO(mockWs)

		// Test write
		await io.write("test message")
		expect(messages).toContain("test message")

		// Test read with queued message
		const readPromise = io.read()
		setTimeout(() => {
			if (mockWs.onmessage) {
				mockWs.onmessage({ data: "queued message" })
			}
		}, 10)

		const result = await readPromise
		expect(result?.trim()).toBe("queued message")
	})

	it("should handle basic client IO operations", async () => {
		const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)

		// Test that the client has the right name
		expect(clientIO.name).toBe("elysia-websocket-client")

		// Test destruction
		clientIO.destroy()
	})
})
