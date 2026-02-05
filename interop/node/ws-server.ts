import { WebSocketServer } from "ws"
import { RPCChannel, WebSocketServerIO } from "../../packages/kkrpc/mod.ts"

const port = Number(process.env.PORT || 0)

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
	},
	counter: 42,
	settings: {
		theme: "light",
		notifications: {
			enabled: true
		}
	}
}

const wss = new WebSocketServer({ port })

wss.on("connection", (ws) => {
	const io = new WebSocketServerIO(ws as unknown as WebSocket)
	const rpc = new RPCChannel(io, {
		expose: api,
		serialization: { version: "json" }
	})

	ws.on("close", () => {
		rpc.destroy?.()
	})
})

const actualPort = (wss.address() as { port: number }).port
console.log(`[kkrpc] ws server listening on ${actualPort}`)

process.on("SIGTERM", () => {
	wss.close()
	process.exit(0)
})
process.on("SIGINT", () => {
	wss.close()
	process.exit(0)
})
