import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { Hono } from "hono"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<APINested, APINested>(serverIO, apiImplementationNested)

const app = new Hono()

app.post("/rpc", async (c) => {
	return c.text(await serverIO.handleRequest(await c.req.text()))
})

export default {
	port: 3000,
	fetch: app.fetch
}
