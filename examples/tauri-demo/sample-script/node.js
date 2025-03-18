import { NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.js"

console.error("Starting Nodejs script")
const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, { expose: apiMethods })
