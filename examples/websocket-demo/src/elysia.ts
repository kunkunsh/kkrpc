import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import { Elysia } from "elysia"
import { createElysiaWebSocketHandler } from "kkrpc/ws/elysia"

const app = new Elysia().ws(
	"/rpc",
	createElysiaWebSocketHandler<APINested>({ expose: apiImplementationNested })
)

app.listen({ port: 3002, hostname: "127.0.0.1" })

console.log("Elysia WebSocket RPC server running on ws://127.0.0.1:3002/rpc")
