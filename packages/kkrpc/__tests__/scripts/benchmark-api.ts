import { NodeIo, RPCChannel } from "../../mod.ts"

const benchmarkAPI = {
	echo: async (message: string) => message,
	add: async (a: number, b: number) => a + b,
	batchAdd: async (pairs: Array<[number, number]>) => pairs.map(([a, b]) => a + b),
	noop: async () => undefined,
	ping: async () => Date.now()
}

const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, { expose: benchmarkAPI })
