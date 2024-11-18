import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<APINested, APINested>(serverIO, {
	expose: apiImplementationNested
})

Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname === "/rpc") {
			const res = await serverIO.handleRequest(await req.text())
			return new Response(res, { headers: { "Content-Type": "application/json" } })
		}
		return new Response("Not found", { status: 404 })
	}
})
