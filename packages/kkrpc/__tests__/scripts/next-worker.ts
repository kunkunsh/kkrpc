import { expose, transfer } from "../../mod.ts"
import { workerSelfTransport } from "../../worker.ts"

const api = {
	add: async (a: number, b: number) => a + b,
	takeBuffer: async (buffer: ArrayBuffer) => buffer.byteLength,
	createBuffer: async (size: number) => {
		const buffer = new ArrayBuffer(size)
		return transfer(buffer, [buffer])
	}
}

expose(api, workerSelfTransport())
