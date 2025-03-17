import { spawn } from "node:child_process"
import { DenoIo, NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api"

// const proc = Bun.spawn(["bun", "--version"]);
// console.log(await proc.exited); // 0
// // console.log(await );
// // listen to stdout
// for await (const chunk of proc.stdout) {
// 	console.log(chunk)
// }

// const proc = Bun.spawn(["bun", "./bun.ts"])
const worker = spawn("bun", ["./bun.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const rpc = new RPCChannel<{}, typeof apiMethods>(io)
const api = rpc.getAPI()

console.log(await api.fibonacci(10))
await worker.kill()
console.log("Worker killed")
