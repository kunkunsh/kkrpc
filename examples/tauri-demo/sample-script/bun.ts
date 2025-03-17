import { BunIo, RPCChannel } from "../../../packages/kkrpc/mod.ts"
// // import { NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.js"

console.error("Starting Bun script")
const stdio = new BunIo(Bun.stdin.stream())
const rpc = new RPCChannel(stdio, { expose: apiMethods })
const api = rpc.getAPI()
