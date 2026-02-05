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
	}
}

new RPCChannel(io, {
	expose: api,
	serialization: { version: "json" }
})
