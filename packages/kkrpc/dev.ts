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
async function runClientDemo() {
    const clientIO = new HTTPClientIO({
        url: "http://localhost:3000/rpc"
    })
    const clientRPC = new RPCChannel<API, API>(clientIO, apiMethods)
    const api = clientRPC.getAPI()

    try {
        // Test echo
        const echoResult = await api.echo("Hello RPC!")
        console.log("Echo:", echoResult)

        // Test math operations
        const sum = await api.math.add(5, 3)
        console.log("5 + 3 =", sum)

        const product = await api.math.multiply(4, 6)
        console.log("4 * 6 =", product)

        // Test concurrent calls
        const results = await Promise.all([
            api.math.add(10, 20),
            api.math.multiply(10, 20)
        ])
        console.log("Concurrent results:", results)

    } catch (error) {
        console.error("Error:", error)
    } finally {
        clientIO.destroy()
    }
}

// Run the demo after a short delay to ensure server is ready
setTimeout(runClientDemo, 100)
