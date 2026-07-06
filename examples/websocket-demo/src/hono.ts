import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { createHonoWebSocketHandler } from "kkrpc/ws/hono"

const app = new Hono()

app.get(
	"/ws",
	upgradeWebSocket(() =>
		createHonoWebSocketHandler<APINested>({
			expose: apiImplementationNested
		})
	)
)

const server = Bun.serve({
	port: 3001,
	fetch: app.fetch,
	websocket
})

console.log(`Hono WebSocket RPC server running on ws://localhost:${server.port}/ws`)
