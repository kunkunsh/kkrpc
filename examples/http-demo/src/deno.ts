import { apiImplementationNested } from "@kksh/demo-api"
import { createHttpHandler } from "kkrpc/http"

const rpcHandler = createHttpHandler(apiImplementationNested)

const handler = async (request: Request): Promise<Response> => {
	const url = new URL(request.url)

	if (url.pathname !== "/rpc") return new Response("Not found", { status: 404 })
	if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
	return rpcHandler(request)
}

const port = 3000
console.log(`Deno server running at http://localhost:${port}`)

await Deno.serve({ port }, handler).finished
