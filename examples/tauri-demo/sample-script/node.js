import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import { apiMethods } from "./api.js"

console.error("Starting Nodejs script")
const stdio = nodeStdioTransport()
const child = new RPCChannel(stdio, { expose: apiMethods })
