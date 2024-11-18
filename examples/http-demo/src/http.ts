import { createServer } from "node:http"
import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<APINested, APINested>(serverIO, {
	expose: apiImplementationNested
})

const server = createServer(async (req, res) => {
	// Handle RPC endpoint
	if (req.url === "/rpc" && req.method === "POST") {
		try {
			// Read request body
			const chunks: Buffer[] = []
			for await (const chunk of req) {
				chunks.push(Buffer.from(chunk))
			}
			const message = Buffer.concat(chunks).toString("utf-8")

			// Process RPC request
			const response = await serverIO.handleRequest(message)

			// Send response
			res.end(response)
		} catch (error) {
			console.error("RPC error:", error)
			res.writeHead(500)
			res.end("Internal Server Error")
		}
		return
	}

	// Handle 404
	res.writeHead(404)
	res.end("Not found")
})

const port = 3000
server.listen(port, () => {
	console.log(`HTTP server running at http://localhost:${port}`)
})

export default server
