import { type Server } from "bun"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RPCChannel } from "../mod.ts"
import { HTTPClientIO, HTTPServerIO } from "../src/adapters/http.ts"

// Define API interface
interface API {
	echo(message: string): Promise<string>
	math: {
		add(a: number, b: number): Promise<number>
		multiply(a: number, b: number): Promise<number>
	}
}

// API implementation
const apiMethods = {
	echo: async (message: string) => message,
	math: {
		add: async (a: number, b: number) => a + b,
		multiply: async (a: number, b: number) => a * b
	}
}

describe("HTTP RPC", () => {
	let server: Server
	let serverIO: HTTPServerIO
	let serverRPC: RPCChannel<API, API>
	let clientIO: HTTPClientIO
	let api: API

	// Setup before tests
	beforeAll(() => {
		// Create server
		serverIO = new HTTPServerIO()
		serverRPC = new RPCChannel<API, API>(serverIO, apiMethods)

		server = Bun.serve({
			port: 3000,
			fetch(req) {
				const url = new URL(req.url)
				if (url.pathname === "/rpc") {
					return serverIO.handleRequest(req)
				}
				return new Response("Not found", { status: 404 })
			}
		})

		// Create client
		clientIO = new HTTPClientIO({
			url: "http://localhost:3000/rpc"
		})
		const clientRPC = new RPCChannel<API, API>(clientIO, apiMethods)
		api = clientRPC.getAPI()
	})

	// Cleanup after tests
	afterAll(() => {
		server.stop()
	})

	test("echo service", async () => {
		const message = "Hello RPC!"
		const result = await api.echo(message)
		expect(result).toBe(message)
	})

	test("math operations", async () => {
		const sum = await api.math.add(5, 3)
		expect(sum).toBe(8)

		const product = await api.math.multiply(4, 6)
		expect(product).toBe(24)
	})

	test("concurrent calls", async () => {
		const results = await Promise.all([api.math.add(10, 20), api.math.multiply(10, 20)])
		expect(results).toEqual([30, 200])
	})

	test("stress test with concurrent calls", async () => {
		// Run stress test 100 times
		for (let iteration = 0; iteration < 100; iteration++) {
			// Create 50 pairs of random numbers
			const pairs = Array(50)
				.fill(0)
				.map(() => [Math.random(), Math.random()])
			const expectedSums = pairs.map(([a, b]) => a + b)

			// Make concurrent API calls
			const actualSums = await Promise.all(pairs.map(([a, b]) => api.math.add(a, b)))

			// Compare results
			expect(actualSums).toEqual(expectedSums)
		}
	})

	test("error handling - invalid endpoint", async () => {
		const response = await fetch("http://localhost:3000/invalid")
		expect(response.status).toBe(404)
		expect(await response.text()).toBe("Not found")
	})

	test("error handling - wrong method", async () => {
		const response = await fetch("http://localhost:3000/rpc", {
			method: "GET"
		})
		expect(response.status).toBe(405)
		expect(await response.text()).toBe("Method not allowed")
	})
})
