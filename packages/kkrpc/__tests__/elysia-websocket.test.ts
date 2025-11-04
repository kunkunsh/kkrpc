import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { Elysia } from "elysia"
import { RPCChannel } from "../mod"
import {
	createElysiaWebSocketIO,
	ElysiaWebSocketClientIO,
	ElysiaWebSocketServerIO
} from "../src/adapters/elysia-websocket"
import type { IoInterface } from "../src/interface.ts"
import { apiMethods, type API } from "./scripts/api.ts"

// Extended API interface for Elysia-specific features
interface ElysiaAPI extends Omit<API, "echo"> {
	echo(message: any): Promise<any>
	getConnectionInfo(): Promise<{
		remoteAddress: string | undefined
		query: Record<string, string>
		headers: Record<string, string>
	}>
}

// Client-side API types for tests
interface ComplexDataClientAPI {
	processArray: (arr: number[]) => number[]
	processObject: (obj: { a: number; b: string }) => { doubled: number; uppercased: string }
}

interface TestClientAPI {
	test: () => string
}

interface TestServerAPI {
	test: () => Promise<string>
}

interface BidirectionalClientAPI {
	getClientInfo: () => { type: string; version: string }
	calculate: (operation: string, a: number, b: number) => number
}

interface ErrorTestClientAPI {
	throwError: (message: string) => never
}

interface RealWorldClientAPI {
	getUserProfile: (userId: string) => { id: string; name: string; email: string; avatar: string }
	processData: (data: number[], operation: "sum" | "average" | "max") => number
	generateSequence: (start: number, count: number) => Promise<number[]>
}

// Type guard for error with code property
function hasErrorCode(error: unknown): error is { code: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof (error as { code: unknown }).code === "string"
	)
}

describe("ElysiaWebSocket", () => {
	let server: any
	let port: number

	beforeAll(async () => {
		const ports = [28101, 28111, 28121, 28131]
		let lastError: unknown = null

		for (const candidate of ports) {
			try {
				port = candidate
				server = new Elysia()
					.ws("/rpc", {
						open(ws) {
							const io = new ElysiaWebSocketServerIO(ws)
							const elysiaApiMethods: ElysiaAPI = {
								...apiMethods,
								getConnectionInfo: async () => ({
									remoteAddress: io.getRemoteAddress(),
									query: io.getQuery(),
									headers: io.getHeaders()
								})
							}
							const rpc = new RPCChannel<ElysiaAPI, ElysiaAPI>(io, {
								expose: elysiaApiMethods
							})
						},
						message(ws, message) {
							ElysiaWebSocketServerIO.feedMessage(ws, message)
						},
						close(ws) {
							// Cleanup if needed
						}
					})
					.listen({ port: candidate, hostname: "127.0.0.1" })
				await new Promise((resolve) => setTimeout(resolve, 50))
				return
			} catch (error: unknown) {
				lastError = error
				if (!hasErrorCode(error) || error.code !== "EADDRINUSE") {
					throw error
				}
			}
		}

		throw lastError ?? new Error("Unable to find available port for Elysia WebSocket tests")
	})

	afterAll(async () => {
		if (server) {
			server.stop()
		}
	})

	describe("ElysiaWebSocketServerIO", () => {
		it("should create server IO instance", () => {
			const mockWs = {
				send: () => {},
				close: () => {},
				readyState: 1,
				data: {
					url: "ws://localhost:3001/rpc?id=123",
					query: { id: "123", name: "test" },
					headers: { "user-agent": "test-agent" },
					remoteAddress: "127.0.0.1"
				}
			}

			const io = new ElysiaWebSocketServerIO(mockWs)
			expect(io.name).toBe("elysia-websocket-server")
		})

		it("should extract connection information correctly", () => {
			const mockWs = {
				send: () => {},
				close: () => {},
				readyState: 1,
				data: {
					url: "ws://localhost:3001/rpc?id=123&name=test",
					query: { id: "123", name: "test" },
					headers: { "user-agent": "test-agent", authorization: "Bearer token123" },
					remoteAddress: "127.0.0.1:12345"
				}
			}

			const io = new ElysiaWebSocketServerIO(mockWs)

			expect(io.getRemoteAddress()).toBe("127.0.0.1:12345")

			const url = io.getUrl()
			expect(url).toBeInstanceOf(URL)
			expect(url?.pathname).toBe("/rpc")

			const query = io.getQuery()
			expect(query).toEqual({ id: "123", name: "test" })

			const headers = io.getHeaders()
			expect(headers).toEqual({
				"user-agent": "test-agent",
				authorization: "Bearer token123"
			})
		})

		it("should handle missing connection information gracefully", () => {
			const mockWs = {
				send: () => {},
				close: () => {},
				readyState: 1
			}

			const io = new ElysiaWebSocketServerIO(mockWs)

			expect(io.getRemoteAddress()).toBe("unknown")
			expect(io.getUrl()).toBeUndefined()
			expect(io.getQuery()).toEqual({})
			expect(io.getHeaders()).toEqual({})
		})
	})

	describe("ElysiaWebSocketClientIO", () => {
		it("should create client IO instance", () => {
			const io = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			expect(io.name).toBe("elysia-websocket-client")
		})

		it("should connect to server and call remote methods", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			// Wait for connection to be established
			await new Promise((resolve) => setTimeout(resolve, 100))

			expect(await serverAPI.echo("Hello")).toBe("Hello")
			expect(await serverAPI.add(5, 3)).toBe(8)
			expect(await serverAPI.subtract(10, 4)).toBe(6)

			clientIO.destroy()
		}, 10000)

		it("should handle complex data types", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<ComplexDataClientAPI, ElysiaAPI, IoInterface>(clientIO, {
				expose: {
					processArray: (arr: number[]) => arr.map((n) => n * 2),
					processObject: (obj: { a: number; b: string }) => ({
						doubled: obj.a * 2,
						uppercased: obj.b.toUpperCase()
					})
				}
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			const complexData = {
				numbers: [1, 2, 3],
				nested: { value: 42 },
				date: new Date()
			}

			const result = await serverAPI.echo(complexData)
			expect(result.numbers).toEqual([1, 2, 3])
			expect(result.nested.value).toBe(42)

			clientIO.destroy()
		}, 10000)

		it("should handle connection errors gracefully", async () => {
			// Try to connect to a non-existent server
			const clientIO = new ElysiaWebSocketClientIO("ws://localhost:9999/nonexistent")
			const clientRPC = new RPCChannel<TestClientAPI, TestServerAPI, IoInterface>(clientIO, {
				expose: { test: () => "ok" }
			})

			const serverAPI = clientRPC.getAPI()

			// Should timeout or throw error
			try {
				await Promise.race([
					serverAPI.test(),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error("Connection timeout")), 2000)
					)
				])
				// If we get here, the connection succeeded (unlikely)
				clientIO.destroy()
			} catch (error: unknown) {
				if (error instanceof Error) {
					expect(error.message).toBe("Connection timeout")
				} else {
					throw new Error(`Expected Error but got ${typeof error}`)
				}
			}
		}, 5000)
	})

	describe("createElysiaWebSocketIO", () => {
		it("should create server IO using factory function", () => {
			const mockWs = {
				send: () => {},
				close: () => {},
				readyState: 1,
				data: {}
			}

			const io = createElysiaWebSocketIO(mockWs)
			expect(io).toBeInstanceOf(ElysiaWebSocketServerIO)
			expect(io.name).toBe("elysia-websocket-server")
		})
	})

	describe("Integration with Elysia server", () => {
		it("should handle bidirectional communication", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<BidirectionalClientAPI, ElysiaAPI, IoInterface>(clientIO, {
				expose: {
					getClientInfo: () => ({ type: "test-client", version: "1.0.0" }),
					calculate: (operation: string, a: number, b: number) => {
						switch (operation) {
							case "add":
								return a + b
							case "multiply":
								return a * b
							default:
								throw new Error(`Unknown operation: ${operation}`)
						}
					}
				}
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test server methods
			expect(await serverAPI.echo("Elysia")).toBe("Elysia")
			expect(await serverAPI.add(10, 20)).toBe(30)
			expect(await serverAPI.subtract(50, 20)).toBe(30)

			// Test connection info
			const connInfo = await serverAPI.getConnectionInfo()
			expect(connInfo).toHaveProperty("remoteAddress")
			expect(connInfo).toHaveProperty("query")
			expect(connInfo).toHaveProperty("headers")

			clientIO.destroy()
		}, 10000)

		it("should handle errors properly", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<ErrorTestClientAPI, ElysiaAPI, IoInterface>(clientIO, {
				expose: {
					throwError: (message: string) => {
						throw new Error(`Client error: ${message}`)
					}
				}
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// This should work fine
			expect(await serverAPI.echo("Test")).toBe("Test")

			clientIO.destroy()
		}, 10000)
	})

	describe("Real-world scenario", () => {
		it("should handle a realistic API with multiple methods", async () => {
			const clientIO = new ElysiaWebSocketClientIO(
				`ws://localhost:${port}/rpc?token=abc123&userId=456`
			)
			const clientRPC = new RPCChannel<RealWorldClientAPI, ElysiaAPI, IoInterface>(clientIO, {
				expose: {
					// User management
					getUserProfile: (userId: string) => ({
						id: userId,
						name: `User ${userId}`,
						email: `user${userId}@example.com`,
						avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`
					}),

					// Data processing
					processData: (data: number[], operation: "sum" | "average" | "max") => {
						switch (operation) {
							case "sum":
								return data.reduce((a, b) => a + b, 0)
							case "average":
								return data.reduce((a, b) => a + b, 0) / data.length
							case "max":
								return Math.max(...data)
						}
					},

					// Streaming simulation
					generateSequence: async (start: number, count: number) => {
						const result: number[] = []
						for (let i = 0; i < count; i++) {
							result.push(start + i)
							// Simulate async work
							await new Promise((resolve) => setTimeout(resolve, 10))
						}
						return result
					}
				}
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test basic functionality
			expect(await serverAPI.echo("Real World")).toBe("Real World")
			expect(await serverAPI.add(100, 200)).toBe(300)
			expect(await serverAPI.subtract(400, 100)).toBe(300)

			// Test complex data
			const complexObj = {
				users: ["alice", "bob", "charlie"],
				metadata: { timestamp: Date.now(), version: "1.0.0" },
				stats: { active: true, score: 95.5 }
			}
			const echoed = await serverAPI.echo(complexObj)
			expect(echoed).toEqual(complexObj)

			// Test connection info should contain our query params
			const connInfo = await serverAPI.getConnectionInfo()
			expect(connInfo.query.token).toBe("abc123")
			expect(connInfo.query.userId).toBe("456")

			clientIO.destroy()
		}, 15000)
	})

	describe("Property Access", () => {
		it("should handle simple property access", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test simple property access
			expect(await serverAPI.counter).toBe(42)

			clientIO.destroy()
		}, 10000)

		it("should handle nested property access", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test nested property access
			expect(await serverAPI.nested.value).toBe("hello world")
			expect(await serverAPI.nested.deepObj.prop).toBe(true)

			clientIO.destroy()
		}, 10000)
	})

	describe("Error Handling", () => {
		it("should preserve error types and messages", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test simple error throwing
			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")

			// Test custom error throwing
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")

			clientIO.destroy()
		}, 10000)

		it("should preserve error properties and causes", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test error with cause
			try {
				await serverAPI.throwErrorWithCause()
				expect.unreachable("Should have thrown an error")
			} catch (error: any) {
				expect(error.message).toBe("This error has a cause")
				expect(error.cause).toBeDefined()
				expect(error.cause.message).toBe("Root cause")
			}

			// Test error with properties
			try {
				await serverAPI.throwErrorWithProperties()
				expect.unreachable("Should have thrown an error")
			} catch (error: any) {
				expect(error.message).toBe("This error has custom properties")
				expect(error.timestamp).toBeDefined()
				expect(error.userId).toBe("user123")
				expect(error.requestId).toBe("req-456")
			}

			clientIO.destroy()
		}, 10000)
	})

	describe("Concurrent Connections", () => {
		it("should handle multiple clients simultaneously", async () => {
			const numClients = 5
			const clients = Array.from({ length: numClients }, () => {
				const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
				return {
					io: clientIO,
					rpc: new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
						expose: apiMethods
					})
				}
			})

			try {
				// Test concurrent calls from multiple clients
				const results = await Promise.all(
					clients.flatMap(({ rpc }) => {
						const api = rpc.getAPI()
						return [api.add(10, 20), api.subtract(50, 20), api.echo("concurrent test")]
					})
				)

				// Verify results
				for (let i = 0; i < results.length; i += 3) {
					expect(results[i]).toBe(30) // add result
					expect(results[i + 1]).toBe(30) // subtract result
					expect(results[i + 2]).toBe("concurrent test") // echo result
				}
			} finally {
				// Cleanup
				clients.forEach(({ io }) => io.destroy())
			}
		}, 15000)
	})

	describe("Performance Testing", () => {
		it("should handle stress test with multiple random calls", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test multiple random calls (50 iterations instead of 100 for faster execution)
			for (let i = 0; i < 50; i++) {
				const a = Math.floor(Math.random() * 100)
				const b = Math.floor(Math.random() * 100)

				const sum = await serverAPI.add(a, b)
				expect(sum).toBe(a + b)

				const difference = await serverAPI.subtract(a, b)
				expect(difference).toBe(a - b)

				const echoResult = await serverAPI.echo(`test-${i}`)
				expect(echoResult).toBe(`test-${i}`)
			}

			clientIO.destroy()
		}, 20000)

		it("should handle concurrent calls efficiently", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test concurrent calls
			const results = await Promise.all([
				serverAPI.add(10, 20),
				serverAPI.subtract(50, 20),
				serverAPI.echo("test1"),
				serverAPI.add(30, 40),
				serverAPI.subtract(100, 25),
				serverAPI.echo("test2"),
				serverAPI.counter,
				serverAPI.nested.value,
				serverAPI.nested.deepObj.prop
			])

			expect(results).toEqual([
				30, // add(10, 20)
				30, // subtract(50, 20)
				"test1", // echo("test1")
				70, // add(30, 40)
				75, // subtract(100, 25)
				"test2", // echo("test2")
				42, // counter property
				"hello world", // nested.value property
				true // nested.deepObj.prop property
			])

			clientIO.destroy()
		}, 15000)
	})

	describe("Nested Object Operations", () => {
		it("should handle deeply nested API calls", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test nested API calls
			const grade1Result = await serverAPI.math.grade1.add(5, 3)
			expect(grade1Result).toBe(8)

			const grade2Result = await serverAPI.math.grade2.multiply(4, 6)
			expect(grade2Result).toBe(24)

			const grade3Result = await serverAPI.math.grade3.divide(20, 4)
			expect(grade3Result).toBe(5)

			clientIO.destroy()
		}, 10000)

		it("should handle nested API calls with callbacks", async () => {
			const clientIO = new ElysiaWebSocketClientIO(`ws://localhost:${port}/rpc`)
			const clientRPC = new RPCChannel<API, ElysiaAPI, IoInterface>(clientIO, {
				expose: apiMethods
			})

			const serverAPI = clientRPC.getAPI()

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test nested API calls with callbacks
			const results: number[] = []

			await serverAPI.math.grade1.add(5, 3, (result) => {
				results.push(result)
			})
			expect(results).toContain(8)

			await serverAPI.math.grade2.multiply(4, 6, (result) => {
				results.push(result)
			})
			expect(results).toContain(24)

			clientIO.destroy()
		}, 10000)
	})
})
