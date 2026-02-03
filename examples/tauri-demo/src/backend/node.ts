import { NodeIo, RPCChannel } from "kkrpc"
import { api } from "./api"

console.error("Node process starts")
const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, { expose: api })
console.error("Server is running")
