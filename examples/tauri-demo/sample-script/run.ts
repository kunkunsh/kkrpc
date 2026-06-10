import { spawn } from "node:child_process"
import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import { apiMethods } from "./api"

const worker = spawn("bun", ["./bun.ts"])
const io = nodeStdioTransport({ readable: worker.stdout, writable: worker.stdin })
const rpc = new RPCChannel<{}, typeof apiMethods>(io)
const api = rpc.getAPI()

console.log(await api.fibonacci(10))
await worker.kill()
console.log("Worker killed")
