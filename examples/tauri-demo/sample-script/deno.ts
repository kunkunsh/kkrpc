import { DenoIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.ts"

console.error("Starting Deno script")
const stdio = new DenoIo(Deno.stdin.readable, Deno.stdout.writable)
const child = new RPCChannel(stdio, { expose: apiMethods })
console.error("RPCChannel ended")
