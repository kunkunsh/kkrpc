import { RPCChannel, transfer, WorkerChildIO } from "../../browser-mini-mod.ts"

const config = { name: "initial" }

class Widget {
	name: string

	constructor(name: string) {
		this.name = name
	}
}

const api = {
	math: {
		add: async (a: number, b: number) => a + b,
		nested: {
			multiply: async (a: number, b: number) => a * b
		}
	},
	counter: {
		value: 4,
		getValue() {
			return this.value
		}
	},
	callCallback: async (value: number, callback: (value: number) => void) => {
		callback(value + 1)
	},
	config,
	Widget,
	takeBuffer: async (buffer: ArrayBuffer) => buffer.byteLength,
	createBuffer: async (size: number) => {
		const buffer = new ArrayBuffer(size)
		return transfer(buffer, [buffer])
	},
	hang: async () => new Promise(() => {})
}

new RPCChannel<typeof api, Record<string, never>>(new WorkerChildIO(), { expose: api })
