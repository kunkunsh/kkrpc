import { expose } from "../../packages/kkrpc/mod.ts"
import { nodeStdioTransport } from "../../packages/kkrpc/stdio.ts"

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

const controller = expose(api, nodeStdioTransport())

process.on("SIGTERM", () => {
	controller.dispose()
	process.exit(0)
})
process.on("SIGINT", () => {
	controller.dispose()
	process.exit(0)
})
