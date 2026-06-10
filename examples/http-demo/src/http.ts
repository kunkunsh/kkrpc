import { createServer } from "node:http"
import { apiImplementationNested } from "@kksh/demo-api"
import { createHttpHandler } from "kkrpc/http"

const handler = createHttpHandler(apiImplementationNested)

const server = createServer(async (req, res) => {
	// Handle RPC endpoint
	if (req.url === "/rpc" && req.method === "POST") {
		try {
			const chunks: Buffer[] = []
			for await (const chunk of req) {
				chunks.push(Buffer.from(chunk))
			}
			const response = await handler(
				new Request("http://127.0.0.1/rpc", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: Buffer.concat(chunks).toString("utf-8")
				})
			)

			res.writeHead(response.status, { "Content-Type": "application/json" })
			res.end(await response.text())
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
