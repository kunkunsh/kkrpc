import { DenoIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.js"

const stdio = new DenoIo(Deno.stdin.readable)
const child = new RPCChannel(stdio, { expose: apiMethods })
