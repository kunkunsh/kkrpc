import { spawn } from "node:child_process"
import { DenoIo, NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api"

const worker = spawn("bun", ["./bun.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const rpc = new RPCChannel<{}, typeof apiMethods>(io)
const api = rpc.getAPI()

console.log(await api.fibonacci(10))
await worker.kill()
console.log("Worker killed")
