import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<APINested, APINested>(serverIO, apiImplementationNested)

const handler = async (request: Request): Promise<Response> => {
	const url = new URL(request.url)

	if (url.pathname === "/rpc" && request.method === "POST") {
		try {
			const message = await request.text()
			const response = await serverIO.handleRequest(message)

			return new Response(response, {
				headers: { "Content-Type": "application/json" }
			})
		} catch (error) {
			console.error("RPC error:", error)
			return new Response("Internal Server Error", { status: 500 })
		}
	}

	return new Response("Not found", { status: 404 })
}

const port = 3000
console.log(`Deno server running at http://localhost:${port}`)

await Deno.serve({ port }, handler).finished
