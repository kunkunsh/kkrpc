import { RPCChannel } from "./mod.ts"
import { HTTPClientIO, HTTPServerIO } from "./src/adapters/http.ts"

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

// Create HTTP server
const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<API, API>(serverIO, apiMethods)

const server = Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname === "/rpc") {
			return serverIO.handleRequest(req)
		}
		return new Response("Not found", { status: 404 })
	}
})

console.log(`Server running at http://localhost:${server.port}`)

// Client demo
const clientIO = new HTTPClientIO({
	url: "http://localhost:3000/rpc"
})
const clientRPC = new RPCChannel<API, API>(clientIO, apiMethods)
const api = clientRPC.getAPI()

// Test echo
const echoResult = await api.echo("Hello RPC!")
console.log("Echo:", echoResult)

// Test math operations
const sum = await api.math.add(5, 3)
console.log("5 + 3 =", sum)

const product = await api.math.multiply(4, 6)
console.log("4 * 6 =", product)

// Test concurrent calls
const results = await Promise.all([api.math.add(10, 20), api.math.multiply(10, 20)])
console.log("Concurrent results:", results)

// stress test
// create 1000 pairs of random numbers and the truth sum
const pairs = Array(50)
	.fill(0)
	.map(() => [Math.random(), Math.random()])
const truth = pairs.map(([a, b]) => a + b)

const batchResponse = await Promise.all(pairs.map(([a, b]) => api.math.add(a, b)))
// compare batchResponse with truth
for (let i = 0; i < batchResponse.length; i++) {
	if (batchResponse[i] !== truth[i]) {
		console.log(`Mismatch at index ${i}: ${batchResponse[i]} !== ${truth[i]}`)
	}
}

server.stop()
