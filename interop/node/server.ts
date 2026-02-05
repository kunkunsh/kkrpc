import { NodeIo, RPCChannel } from "../../packages/kkrpc/mod.ts"

const io = new NodeIo(process.stdin, process.stdout)
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

const rpc = new RPCChannel(io, {
	expose: api,
	serialization: { version: "json" }
})

process.on("SIGTERM", () => {
	rpc.destroy?.()
	process.exit(0)
})
process.on("SIGINT", () => {
	rpc.destroy?.()
	process.exit(0)
})
