import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import { api } from "./api"

console.error("Node process starts")
const stdio = nodeStdioTransport()
const child = new RPCChannel(stdio, { expose: api })
console.error("Server is running")
