import { WebSocketServer } from "ws"
import { expose } from "../../packages/kkrpc/src/entries/mod.ts"
import { webSocketTransport } from "../../packages/kkrpc/src/entries/ws.ts"

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
	const controller = expose(api, webSocketTransport(ws))

	ws.on("close", () => {
		controller.dispose()
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
