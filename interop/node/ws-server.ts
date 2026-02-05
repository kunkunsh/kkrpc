import { WebSocketServer } from "ws"
import { RPCChannel, WebSocketServerIO } from "../../packages/kkrpc/mod.ts"

const port = Number(process.env.PORT || 8789)

const api = {
	math: {
		add(a: number, b: number) {
			return a + b
		}
	},
	echo<T>(value: T) {
		return value
	},
	withCallback(value: string, cb: (payload: string) => void) {
		cb(`callback:${value}`)
		return "callback-sent"
	}
}

const wss = new WebSocketServer({ port })

wss.on("connection", (ws) => {
	const io = new WebSocketServerIO(ws as unknown as WebSocket)
	new RPCChannel(io, {
		expose: api,
		serialization: { version: "json" }
	})
})

console.log(`[kkrpc] ws server listening on ${port}`)
