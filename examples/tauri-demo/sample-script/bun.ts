// import { NodeIo, RPCChannel } from "../../../packages/kkrpc/mod.ts"
// // import { NodeIo, RPCChannel } from "kkrpc"
// import { apiMethods } from "./api.js"

// console.error("Starting Bun script")
// const stdio = new NodeIo(process.stdin, process.stdout)
// const rpc = new RPCChannel(stdio, { expose: apiMethods })
// const api = rpc.getAPI()

// console.error("RPCChannel ended")
// console.log(await api.fibonacci(10))
// await new Promise((resolve) => setTimeout(resolve, 10_000))

// import { BunIo, DenoIo, RPCChannel } from "kkrpc"
// import { apiMethods } from "./api.js"

// console.error("Starting Deno script")
// const stdio = new BunIo(Bun.stdin.stream())
// const child = new RPCChannel(stdio, { expose: apiMethods })
// console.error("RPCChannel ended")

for await (const chunk of Bun.stdin.stream()) {
	// chunk is Uint8Array
	// this converts it to text (assumes ASCII encoding)
	const chunkText = Buffer.from(chunk).toString()
	console.error(`Chunk: ${chunkText}`)
}
