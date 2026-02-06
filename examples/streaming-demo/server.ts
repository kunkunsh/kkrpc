/**
 * Streaming demo — WebSocket server.
 *
 * Run with: bun run server.ts
 * Then in another terminal: bun run client.ts
 */
import { WebSocketServer } from "ws"
import { RPCChannel, WebSocketServerIO, type RPCInterceptor } from "kkrpc"
import { streamingApi, type StreamingAPI } from "./api.ts"

const PORT = 3100

// Optional: log every incoming RPC call (including stream initiations)
const logger: RPCInterceptor = async (ctx, next) => {
	console.log(`  [server] → ${ctx.method}(${ctx.args.map(String).join(", ")})`)
	const result = await next()
	return result
}

const wss = new WebSocketServer({ port: PORT })

wss.on("connection", (ws) => {
	console.log("[server] Client connected")
	const io = new WebSocketServerIO(ws)
	new RPCChannel<StreamingAPI, {}>(io, {
		expose: streamingApi,
		interceptors: [logger]
	})
})

console.log(`[server] Streaming demo listening on ws://localhost:${PORT}`)
