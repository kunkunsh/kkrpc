import { apiImplementationNested } from "@kksh/demo-api"
import { createHttpHandler } from "kkrpc/http"

const handler = createHttpHandler(apiImplementationNested)

Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname !== "/rpc") return new Response("Not found", { status: 404 })
		if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
		return handler(req)
	}
})
