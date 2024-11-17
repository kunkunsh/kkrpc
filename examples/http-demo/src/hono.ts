import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { Hono } from "hono"
import { createHttpHandler } from "kkrpc/http"

const handler = createHttpHandler(apiImplementationNested)

const app = new Hono()

app.post("/rpc", async (c) => {
	return c.text(await handler.handleRequest(await c.req.text()))
})

export default {
	port: 3000,
	fetch: app.fetch
}
